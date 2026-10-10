import "server-only";

import {
  MarketplaceApiError,
  MarketplaceAuthError,
  MarketplaceValidationError,
  type MarketplaceConnector,
  type MarketplaceId,
} from "@/connectors/types";
import { db } from "@/server/db";
import { getConnector } from "@/server/marketplaces/config";
import {
  getAccessToken,
  ReconnectRequiredError,
  type TokenDeps,
} from "@/server/marketplaces/token-service";
import type { TenantDb } from "@/server/tenant/tenant-db";

import { removeListingsFromSystem } from "./remove-service";

// "Excluir também no Mercado Livre" as a background batch (sync_jobs
// delete_listings, one job per account, run by batch-service.ts). Each listing
// is closed and deleted on the marketplace (irreversible), recorded in
// listing_edits and then removed from the ERP. Never automatic: only the
// owner/admin starts it, and only on accounts with writes allowed.

export const MAX_DELETE = 200;

export type DeleteDeps = TokenDeps & {
  connectorFor?: (marketplace: MarketplaceId) => MarketplaceConnector;
};

export type StartDeleteResult =
  | { status: "started"; jobIds: string[]; blocked: number }
  | { status: "nothing_to_do"; blocked: number };

export async function startDeleteListings(
  tdb: TenantDb,
  organizationId: string,
  startedById: string | null,
  listingIds: string[],
): Promise<StartDeleteResult> {
  const listings = await tdb.listing.findMany({
    where: { id: { in: [...new Set(listingIds)].slice(0, MAX_DELETE) }, removedAt: null },
    select: {
      id: true,
      marketplaceAccountId: true,
      account: { select: { allowWrites: true, status: true } },
    },
  });
  const byAccount = new Map<string, string[]>();
  let blocked = 0;
  for (const listing of listings) {
    if (!listing.account.allowWrites || listing.account.status !== "active") {
      blocked += 1;
      continue;
    }
    byAccount.set(listing.marketplaceAccountId, [
      ...(byAccount.get(listing.marketplaceAccountId) ?? []),
      listing.id,
    ]);
  }
  if (byAccount.size === 0) return { status: "nothing_to_do", blocked };
  const jobIds: string[] = [];
  for (const [accountId, ids] of byAccount) {
    const job = await db.syncJob.create({
      data: {
        organizationId,
        marketplaceAccountId: accountId,
        type: "delete_listings",
        pendingIds: ids,
        total: ids.length,
        startedById,
        startedAt: new Date(),
      },
      select: { id: true },
    });
    jobIds.push(job.id);
  }
  return { status: "started", jobIds, blocked };
}

type ItemOutcome =
  | { kind: "done" }
  | { kind: "skipped" }
  | { kind: "failed"; message: string }
  | { kind: "stop"; message: string }
  | { kind: "retry"; message: string };

/** Deletes one listing on the marketplace, then removes it from the ERP. */
export async function deleteListingItem(
  ctx: { tdb: TenantDb; organizationId: string; userId: string | null },
  listingId: string,
  deps: DeleteDeps = {},
): Promise<ItemOutcome> {
  const listing = await ctx.tdb.listing.findFirst({
    where: { id: listingId },
    select: {
      externalId: true,
      removedAt: true,
      marketplaceAccountId: true,
      account: { select: { marketplace: true, allowWrites: true } },
    },
  });
  // Gone or already handled (a resumed round never sends twice).
  if (!listing || listing.removedAt) return { kind: "skipped" };
  if (!listing.account.allowWrites) {
    return { kind: "stop", message: "Alterações bloqueadas nesta conta (libere em Contas)." };
  }

  const connector = (deps.connectorFor ?? getConnector)(listing.account.marketplace);
  try {
    const token = await getAccessToken(ctx.organizationId, listing.marketplaceAccountId, deps);
    const fresh = await connector.getListingForEdit(token, listing.externalId);
    await connector.deleteListing(token, listing.externalId, {
      alreadyClosed: fresh.listing.status === "closed",
    });
    await ctx.tdb.listingEdit.create({
      data: {
        organizationId: ctx.organizationId,
        listingId,
        userId: ctx.userId,
        changes: [{ field: "status", before: fresh.listing.status, after: "deleted" }],
        status: "success",
        message: "Excluído no Mercado Livre.",
      },
    });
    await removeListingsFromSystem(ctx.tdb, [listingId]);
    return { kind: "done" };
  } catch (error) {
    if (error instanceof MarketplaceValidationError) {
      return { kind: "failed", message: error.causes.join(" ") };
    }
    if (error instanceof ReconnectRequiredError || error instanceof MarketplaceAuthError) {
      return {
        kind: "stop",
        message: "O Mercado Livre não aceita mais a autorização. Reconecte a conta.",
      };
    }
    if (error instanceof MarketplaceApiError) {
      return {
        kind: "retry",
        message: "O Mercado Livre não respondeu. O lote continua de onde parou.",
      };
    }
    throw error;
  }
}
