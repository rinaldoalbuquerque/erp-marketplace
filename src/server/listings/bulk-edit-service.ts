import "server-only";

import {
  MarketplaceApiError,
  MarketplaceAuthError,
  MarketplaceValidationError,
  type MarketplaceConnector,
  type MarketplaceId,
} from "@/connectors/types";
import {
  planBulkItem,
  reverseChange,
  type BulkChange,
  type BulkOperation,
  type BulkPlan,
} from "@/domain/listings/bulk-edit";
import { db } from "@/server/db";
import { getConnector } from "@/server/marketplaces/config";
import {
  getAccessToken,
  ReconnectRequiredError,
  type TokenDeps,
} from "@/server/marketplaces/token-service";
import type { TenantDb } from "@/server/tenant/tenant-db";

import type { Prisma } from "@/generated/prisma/client";

import { saveListing } from "./import-service";
import { listingWhere, type ListingFilters } from "./queries";

// Bulk edit (price / pause / activate) as a background batch (sync_jobs
// bulk_edit_listings, run by batch-service.ts). Safety:
// - the plan (absolute final value + previous value) is computed on the server
//   when the batch starts and stored in the job: resuming never applies twice;
// - right before sending, the listing is read at the marketplace: already at the
//   final value -> skipped; changed since the preview -> reported, not overwritten;
// - every applied change goes to listing_edits and the job keeps the list of
//   applied listings, used by "Desfazer" (a new batch with the reversed changes).

export const MAX_BULK = 500;

export type BulkSelection =
  { kind: "ids"; listingIds: string[] } | { kind: "filter"; filters: ListingFilters };

export type BulkDeps = TokenDeps & {
  connectorFor?: (marketplace: MarketplaceId) => MarketplaceConnector;
};

export type PreviewRow = {
  listingId: string;
  externalId: string;
  title: string;
  accountNickname: string;
  plan: BulkPlan;
};

const WRITES_OFF = "Alterações bloqueadas nesta conta (libere em Contas).";

async function selectListings(tdb: TenantDb, selection: BulkSelection) {
  const where: Prisma.ListingWhereInput =
    selection.kind === "ids"
      ? { id: { in: selection.listingIds.slice(0, MAX_BULK) } }
      : listingWhere(selection.filters);
  const [total, listings] = await Promise.all([
    tdb.listing.count({ where }),
    tdb.listing.findMany({
      where,
      orderBy: [{ status: "asc" }, { title: "asc" }],
      take: MAX_BULK,
      select: {
        id: true,
        externalId: true,
        title: true,
        priceCents: true,
        status: true,
        subStatus: true,
        marketplaceAccountId: true,
        account: { select: { nickname: true, allowWrites: true, status: true } },
      },
    }),
  ]);
  return { total, listings };
}

/** What the batch would do (read only, from the local copies). */
export async function previewBulkEdit(
  tdb: TenantDb,
  selection: BulkSelection,
  operation: BulkOperation,
) {
  const { total, listings } = await selectListings(tdb, selection);
  const rows: PreviewRow[] = listings.map((listing) => ({
    listingId: listing.id,
    externalId: listing.externalId,
    title: listing.title,
    accountNickname: listing.account.nickname,
    plan:
      listing.account.allowWrites && listing.account.status === "active"
        ? planBulkItem(operation, listing)
        : { action: "skip", reason: WRITES_OFF },
  }));
  return { rows, total, truncated: total > listings.length };
}

type JobParams = {
  operation: BulkOperation | { kind: "undo"; of: string };
  items: Record<string, BulkChange>;
  applied: string[];
};

export type StartBulkResult =
  { status: "started"; jobIds: string[] } | { status: "nothing_to_do" | "not_found" };

async function createJobs(
  organizationId: string,
  startedById: string | null,
  operation: JobParams["operation"],
  byAccount: Map<string, Record<string, BulkChange>>,
) {
  const jobIds: string[] = [];
  for (const [accountId, items] of byAccount) {
    const ids = Object.keys(items);
    const params: JobParams = { operation, items, applied: [] };
    const job = await db.syncJob.create({
      data: {
        organizationId,
        marketplaceAccountId: accountId,
        type: "bulk_edit_listings",
        pendingIds: ids,
        total: ids.length,
        params: params as unknown as Prisma.InputJsonValue,
        startedById,
        startedAt: new Date(),
      },
      select: { id: true },
    });
    jobIds.push(job.id);
  }
  return jobIds;
}

/** Plans again on the server (the browser only says what to select) and starts one batch per account. */
export async function startBulkEdit(
  tdb: TenantDb,
  organizationId: string,
  startedById: string | null,
  selection: BulkSelection,
  operation: BulkOperation,
): Promise<StartBulkResult> {
  const { listings } = await selectListings(tdb, selection);
  const byAccount = new Map<string, Record<string, BulkChange>>();
  for (const listing of listings) {
    if (!listing.account.allowWrites || listing.account.status !== "active") continue;
    const plan = planBulkItem(operation, listing);
    if (plan.action !== "change") continue;
    const items = byAccount.get(listing.marketplaceAccountId) ?? {};
    items[listing.id] = plan.change;
    byAccount.set(listing.marketplaceAccountId, items);
  }
  if (byAccount.size === 0) return { status: "nothing_to_do" };
  return {
    status: "started",
    jobIds: await createJobs(organizationId, startedById, operation, byAccount),
  };
}

/** "Desfazer": a new batch with the reversed changes of what a batch applied. */
export async function startUndo(
  organizationId: string,
  startedById: string | null,
  jobId: string,
): Promise<StartBulkResult> {
  const job = await db.syncJob.findFirst({
    where: { id: jobId, organizationId, type: "bulk_edit_listings" },
    select: { marketplaceAccountId: true, params: true },
  });
  if (!job) return { status: "not_found" };
  const params = job.params as unknown as JobParams;
  const items: Record<string, BulkChange> = {};
  for (const listingId of params.applied ?? []) {
    const change = params.items[listingId];
    if (change) items[listingId] = reverseChange(change);
  }
  if (Object.keys(items).length === 0) return { status: "nothing_to_do" };
  return {
    status: "started",
    jobIds: await createJobs(
      organizationId,
      startedById,
      { kind: "undo", of: jobId },
      new Map([[job.marketplaceAccountId, items]]),
    ),
  };
}

export type ItemOutcome =
  | { kind: "done" }
  | { kind: "skipped" }
  | { kind: "failed"; message: string }
  | { kind: "stop"; message: string }
  | { kind: "retry"; message: string };

const formatBrl = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Applies one planned change (called by the batch round). */
export async function applyBulkItem(
  ctx: { tdb: TenantDb; organizationId: string; userId: string | null },
  jobId: string,
  listingId: string,
  deps: BulkDeps = {},
): Promise<ItemOutcome> {
  const job = await db.syncJob.findFirst({
    where: { id: jobId, organizationId: ctx.organizationId },
    select: { params: true },
  });
  const change = (job?.params as unknown as JobParams | null)?.items[listingId];
  if (!change) return { kind: "skipped" };

  const listing = await ctx.tdb.listing.findFirst({
    where: { id: listingId },
    select: {
      externalId: true,
      marketplaceAccountId: true,
      account: { select: { marketplace: true, allowWrites: true } },
    },
  });
  if (!listing) return { kind: "failed", message: "Anúncio não encontrado no ERP." };
  if (!listing.account.allowWrites) return { kind: "stop", message: WRITES_OFF };

  const connector = (deps.connectorFor ?? getConnector)(listing.account.marketplace);
  try {
    const token = await getAccessToken(ctx.organizationId, listing.marketplaceAccountId, deps);
    const fresh = await connector.getListingForEdit(token, listing.externalId);
    const current = change.field === "price" ? fresh.listing.priceCents : fresh.listing.status;
    if (current === change.to) {
      await saveListing(
        ctx.tdb,
        ctx.organizationId,
        listing.marketplaceAccountId,
        listing.account.marketplace,
        fresh.listing,
        new Date(),
      );
      return { kind: "skipped" };
    }
    if (current !== change.from) {
      return {
        kind: "failed",
        message:
          change.field === "price"
            ? `O preço mudou desde a prévia (agora ${current === null ? "sem preço" : formatBrl(current as number)}); não foi alterado.`
            : `O status mudou desde a prévia (agora ${String(current)}); não foi alterado.`,
      };
    }

    await connector.updateListing(
      token,
      listing.externalId,
      change.field === "price" ? { priceCents: change.to } : { status: change.to },
    );
    const after = await connector.getListingForEdit(token, listing.externalId);
    await saveListing(
      ctx.tdb,
      ctx.organizationId,
      listing.marketplaceAccountId,
      listing.account.marketplace,
      after.listing,
      new Date(),
    );
    const applied =
      (change.field === "price" ? after.listing.priceCents : after.listing.status) === change.to;
    await ctx.tdb.listingEdit.create({
      data: {
        organizationId: ctx.organizationId,
        listingId,
        userId: ctx.userId,
        changes: [{ field: change.field, before: change.from, after: change.to }],
        status: applied ? "success" : "partial",
        message: applied
          ? "Edição em massa."
          : "Edição em massa: o Mercado Livre não aplicou (ex.: preço automático ativo).",
      },
    });
    if (!applied) {
      return {
        kind: "failed",
        message: "O Mercado Livre não aplicou a mudança (ex.: preço automático ativo).",
      };
    }
    // Remember it for "Desfazer".
    await db.$executeRaw`UPDATE "sync_jobs" SET "params" = jsonb_set("params", '{applied}', COALESCE("params"->'applied', '[]'::jsonb) || to_jsonb(${listingId}::text)) WHERE "id" = ${jobId}::uuid AND "organization_id" = ${ctx.organizationId}::uuid`;
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

/** Whether a finished bulk batch can be undone (it applied something and is not itself an undo). */
export async function bulkUndoInfo(organizationId: string, jobId: string) {
  const job = await db.syncJob.findFirst({
    where: { id: jobId, organizationId, type: "bulk_edit_listings" },
    select: { params: true },
  });
  const params = job?.params as unknown as JobParams | undefined;
  if (!params) return { canUndo: false, isUndo: false };
  return {
    canUndo: params.operation.kind !== "undo" && (params.applied ?? []).length > 0,
    isUndo: params.operation.kind === "undo",
  };
}
