import "server-only";

import { randomUUID } from "node:crypto";

import {
  MarketplaceApiError,
  MarketplaceAuthError,
  MarketplaceValidationError,
} from "@/connectors/types";
import { MAX_PUSH_ATTEMPTS, planStockPush, retryDelayMs } from "@/domain/stock/push-rules";
import { db } from "@/server/db";
import { getConnector } from "@/server/marketplaces/config";
import { getAccessToken, ReconnectRequiredError } from "@/server/marketplaces/token-service";
import type { ImportDeps } from "@/server/listings/import-service";
import type { TenantDb } from "@/server/tenant/tenant-db";

import type { Prisma } from "@/generated/prisma/client";

// Sends ERP stock to the linked marketplace listings (Option C), as an outbox:
// - a change in the ERP upserts ONE `stock_pushes` row per listing/variation with
//   the latest wanted quantity (many changes in a row = one send);
// - a round (next/server `after`) claims due rows and sends them; network/API
//   errors are retried with a growing wait, refusals fail with the reason;
// - sending the same quantity twice is harmless (ML just keeps the value), and a
//   newer enqueue clears the claim, so an older send never marks a newer value as sent.
// Only accounts with allowWrites AND stockSyncEnabled take part.

export type StockSyncDeps = ImportDeps;

/** A claimed row nobody finished in this time can be taken by another round. */
const CLAIM_MS = 2 * 60 * 1000;

const SYNC_ACCOUNT = { allowWrites: true, stockSyncEnabled: true, status: "active" } as const;

const NOT_LINKED = "Anúncio sem SKU vinculado.";
const SYNC_OFF = "Sincronização de estoque desligada nesta conta.";
const RECONNECT = "O Mercado Livre não aceita mais a autorização. Reconecte a conta.";
const GAVE_UP = "O Mercado Livre não respondeu depois de várias tentativas.";

type MappingRow = {
  listingId: string;
  variationKey: string;
  sku: { stockOnHand: number };
  listing: { logisticType: string | null; account: { multiWarehouse: boolean } };
};

async function upsertPushes(tdb: TenantDb, organizationId: string, mappings: MappingRow[]) {
  for (const mapping of mappings) {
    const plan = planStockPush(
      {
        logisticType: mapping.listing.logisticType,
        variationKey: mapping.variationKey,
        accountMultiWarehouse: mapping.listing.account.multiWarehouse,
      },
      mapping.sku.stockOnHand,
    );
    const data =
      plan.action === "send"
        ? { desiredQuantity: plan.quantity, status: "pending" as const, skipReason: null }
        : {
            desiredQuantity: Math.max(0, mapping.sku.stockOnHand),
            status: "skipped" as const,
            skipReason: plan.reason,
          };
    const reset = {
      ...data,
      attempts: 0,
      nextAttemptAt: new Date(),
      claimToken: null,
      claimedUntil: null,
      lastError: null,
    };
    await tdb.stockPush.upsert({
      where: {
        listingId_variationKey: {
          listingId: mapping.listingId,
          variationKey: mapping.variationKey,
        },
      },
      create: {
        organizationId,
        listingId: mapping.listingId,
        variationKey: mapping.variationKey,
        ...reset,
      },
      update: reset,
    });
  }
  return mappings.length;
}

const MAPPING_SELECT = {
  listingId: true,
  variationKey: true,
  sku: { select: { stockOnHand: true } },
  listing: { select: { logisticType: true, account: { select: { multiWarehouse: true } } } },
} as const;

async function enqueueWhere(
  tdb: TenantDb,
  organizationId: string,
  where: Prisma.SkuListingMappingWhereInput,
) {
  const mappings = await tdb.skuListingMapping.findMany({
    where: { AND: [where, { listing: { account: SYNC_ACCOUNT } }] },
    select: MAPPING_SELECT,
  });
  return upsertPushes(tdb, organizationId, mappings);
}

/** Queues the current stock of these SKUs for every linked listing with sync on. */
export function enqueueForSkus(tdb: TenantDb, organizationId: string, skuIds: string[]) {
  if (skuIds.length === 0) return Promise.resolve(0);
  return enqueueWhere(tdb, organizationId, { skuId: { in: skuIds } });
}

/** Queues these listings (e.g. right after they were linked to a SKU). */
export function enqueueForListings(tdb: TenantDb, organizationId: string, listingIds: string[]) {
  if (listingIds.length === 0) return Promise.resolve(0);
  return enqueueWhere(tdb, organizationId, { listingId: { in: listingIds } });
}

/** Queues every linked listing of one account (used when sync is turned on). */
export function enqueueAllForAccount(tdb: TenantDb, organizationId: string, accountId: string) {
  return enqueueWhere(tdb, organizationId, { listing: { marketplaceAccountId: accountId } });
}

export type ProcessResult = {
  sent: number;
  skipped: number;
  failed: number;
  retrying: number;
  /** Stopped at the deadline with due rows left. */
  timedOut: boolean;
};

/** Takes one due row for this round; null when there is nothing (else) to do. */
async function claimNext(organizationId: string, now: Date) {
  for (let tries = 0; tries < 5; tries++) {
    const candidate = await db.stockPush.findFirst({
      where: {
        organizationId,
        status: "pending",
        nextAttemptAt: { lte: now },
        OR: [{ claimToken: null }, { claimedUntil: { lt: now } }],
      },
      orderBy: { nextAttemptAt: "asc" },
      select: { id: true, claimToken: true },
    });
    if (!candidate) return null;
    const token = randomUUID();
    const claimed = await db.stockPush.updateMany({
      where: { id: candidate.id, status: "pending", claimToken: candidate.claimToken },
      data: { claimToken: token, claimedUntil: new Date(now.getTime() + CLAIM_MS) },
    });
    if (claimed.count === 1) return { id: candidate.id, token };
    // Another round took it first: look again.
  }
  return null;
}

/** Updates the row only if this round still owns it (a newer enqueue wins). */
function finish(pushId: string, claimToken: string, data: Record<string, unknown>) {
  return db.stockPush.updateMany({
    where: { id: pushId, claimToken },
    data: { ...data, claimToken: null, claimedUntil: null },
  });
}

/**
 * Sends due stock updates until there are none left or `deadline` passes.
 * Safe to run in parallel: each row is claimed by one round.
 */
export async function processStockPushes(
  organizationId: string,
  deadline: Date,
  deps: StockSyncDeps = {},
): Promise<ProcessResult> {
  const now = deps.now ?? (() => new Date());
  const connectorFor = deps.connectorFor ?? getConnector;
  const result: ProcessResult = { sent: 0, skipped: 0, failed: 0, retrying: 0, timedOut: false };

  while (true) {
    if (now() >= deadline) {
      result.timedOut = true;
      return result;
    }
    const claim = await claimNext(organizationId, now());
    if (!claim) return result;

    const push = await db.stockPush.findFirstOrThrow({
      where: { id: claim.id, organizationId },
      select: {
        variationKey: true,
        attempts: true,
        listing: {
          select: {
            id: true,
            externalId: true,
            logisticType: true,
            userProductId: true,
            marketplaceAccountId: true,
            account: {
              select: {
                marketplace: true,
                status: true,
                allowWrites: true,
                stockSyncEnabled: true,
                multiWarehouse: true,
              },
            },
          },
        },
      },
    });
    const { listing } = push;
    const account = listing.account;

    if (!account.allowWrites || !account.stockSyncEnabled) {
      await finish(claim.id, claim.token, { status: "skipped", skipReason: SYNC_OFF });
      result.skipped++;
      continue;
    }

    // Always the CURRENT ERP stock (it may have changed since the row was queued).
    const mapping = await db.skuListingMapping.findFirst({
      where: { organizationId, listingId: listing.id, variationKey: push.variationKey },
      select: { sku: { select: { stockOnHand: true } } },
    });
    if (!mapping) {
      await finish(claim.id, claim.token, { status: "skipped", skipReason: NOT_LINKED });
      result.skipped++;
      continue;
    }
    const plan = planStockPush(
      {
        logisticType: listing.logisticType,
        variationKey: push.variationKey,
        accountMultiWarehouse: account.multiWarehouse,
      },
      mapping.sku.stockOnHand,
    );
    if (plan.action === "skip") {
      await finish(claim.id, claim.token, { status: "skipped", skipReason: plan.reason });
      result.skipped++;
      continue;
    }

    try {
      const token = await getAccessToken(organizationId, listing.marketplaceAccountId, deps);
      await connectorFor(account.marketplace).setListingStock(
        token,
        listing.externalId,
        plan.quantity,
      );
    } catch (error) {
      const attempts = push.attempts + 1;
      if (error instanceof MarketplaceValidationError) {
        await finish(claim.id, claim.token, {
          status: "failed",
          attempts,
          lastError: error.causes.join(" "),
        });
        result.failed++;
      } else if (error instanceof ReconnectRequiredError || error instanceof MarketplaceAuthError) {
        await finish(claim.id, claim.token, { status: "failed", attempts, lastError: RECONNECT });
        result.failed++;
      } else {
        if (!(error instanceof MarketplaceApiError)) {
          console.error("Stock push failed", {
            pushId: claim.id,
            error: error instanceof Error ? error.message : "unknown",
          });
        }
        const wait = attempts < MAX_PUSH_ATTEMPTS ? retryDelayMs(attempts) : null;
        if (wait === null) {
          await finish(claim.id, claim.token, { status: "failed", attempts, lastError: GAVE_UP });
          result.failed++;
        } else {
          await finish(claim.id, claim.token, {
            attempts,
            nextAttemptAt: new Date(now().getTime() + wait),
            lastError: "O Mercado Livre não respondeu. Nova tentativa em instantes.",
          });
          result.retrying++;
        }
      }
      continue;
    }

    const sentAt = now();
    const done = await finish(claim.id, claim.token, {
      status: "sent",
      sentQuantity: plan.quantity,
      sentAt,
      attempts: 0,
      lastError: null,
    });
    if (done.count === 0) continue; // re-queued meanwhile: the newer value goes next
    result.sent++;

    // ML keeps one stock per User Product: listings sharing it now show this value.
    const sameStock = listing.userProductId
      ? {
          marketplaceAccountId: listing.marketplaceAccountId,
          userProductId: listing.userProductId,
        }
      : { id: listing.id };
    await db.listing.updateMany({
      where: { organizationId, ...sameStock },
      data: { availableQuantity: plan.quantity },
    });
    if (listing.userProductId) {
      // Same-UP rows waiting for the same quantity need no second call.
      await db.stockPush.updateMany({
        where: {
          organizationId,
          status: "pending",
          claimToken: null,
          desiredQuantity: plan.quantity,
          variationKey: "",
          listing: sameStock,
        },
        data: { status: "sent", sentQuantity: plan.quantity, sentAt, lastError: null },
      });
    }
  }
}
