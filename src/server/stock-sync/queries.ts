import "server-only";

import { planStockPush, type PushPlan } from "@/domain/stock/push-rules";
import type { TenantDb } from "@/server/tenant/tenant-db";

import type { StockPushStatus } from "@/generated/prisma/client";

export type PushCounts = Record<StockPushStatus, number>;

const emptyCounts = (): PushCounts => ({ pending: 0, sent: 0, skipped: 0, failed: 0 });

/** How many listings of each account are sent, queued, skipped or failed. */
export async function pushCountsByAccount(tdb: TenantDb): Promise<Map<string, PushCounts>> {
  const rows = await tdb.stockPush.findMany({
    select: { status: true, listing: { select: { marketplaceAccountId: true } } },
  });
  const counts = new Map<string, PushCounts>();
  for (const row of rows) {
    const accountId = row.listing.marketplaceAccountId;
    const current = counts.get(accountId) ?? emptyCounts();
    current[row.status]++;
    counts.set(accountId, current);
  }
  return counts;
}

export type PreviewRow = {
  listingId: string;
  externalId: string;
  title: string;
  variationKey: string;
  skuId: string;
  skuCode: string;
  marketplaceQuantity: number | null;
  erpQuantity: number;
  plan: PushPlan;
  /** Will set an active listing with stock to 0 (ML pauses it). */
  willZero: boolean;
};

/** What turning stock sync on would do to each linked listing of the account. */
export async function stockSyncPreview(tdb: TenantDb, accountId: string): Promise<PreviewRow[]> {
  const account = await tdb.marketplaceAccount.findFirst({
    where: { id: accountId },
    select: { multiWarehouse: true },
  });
  if (!account) return [];
  const mappings = await tdb.skuListingMapping.findMany({
    where: { listing: { marketplaceAccountId: accountId } },
    select: {
      variationKey: true,
      sku: { select: { id: true, code: true, stockOnHand: true } },
      variation: { select: { availableQuantity: true } },
      listing: {
        select: {
          id: true,
          externalId: true,
          title: true,
          availableQuantity: true,
          logisticType: true,
        },
      },
    },
  });
  const rows = mappings.map((mapping): PreviewRow => {
    const plan = planStockPush(
      {
        logisticType: mapping.listing.logisticType,
        variationKey: mapping.variationKey,
        accountMultiWarehouse: account.multiWarehouse,
      },
      mapping.sku.stockOnHand,
    );
    const marketplaceQuantity = mapping.variation
      ? mapping.variation.availableQuantity
      : mapping.listing.availableQuantity;
    return {
      listingId: mapping.listing.id,
      externalId: mapping.listing.externalId,
      title: mapping.listing.title,
      variationKey: mapping.variationKey,
      skuId: mapping.sku.id,
      skuCode: mapping.sku.code,
      marketplaceQuantity,
      erpQuantity: mapping.sku.stockOnHand,
      plan,
      willZero: plan.action === "send" && plan.quantity === 0 && (marketplaceQuantity ?? 0) > 0,
    };
  });
  // What needs attention first: listings that will be zeroed, then changes.
  const rank = (row: PreviewRow) =>
    row.willZero ? 0 : row.plan.action === "skip" ? 3 : changes(row) ? 1 : 2;
  return rows.sort(
    (a, b) => rank(a) - rank(b) || a.externalId.localeCompare(b.externalId, "pt-BR"),
  );
}

export function changes(row: PreviewRow) {
  return row.plan.action === "send" && row.plan.quantity !== row.marketplaceQuantity;
}

/** Linked listings of a SKU with their stock sync situation (Estoque > SKU). */
export async function skuListingsSync(tdb: TenantDb, skuId: string) {
  const mappings = await tdb.skuListingMapping.findMany({
    where: { skuId },
    orderBy: { createdAt: "asc" },
    select: {
      variationKey: true,
      listing: {
        select: {
          id: true,
          externalId: true,
          title: true,
          availableQuantity: true,
          account: { select: { nickname: true, stockSyncEnabled: true, allowWrites: true } },
          stockPushes: {
            select: {
              variationKey: true,
              status: true,
              desiredQuantity: true,
              sentQuantity: true,
              sentAt: true,
              lastError: true,
              skipReason: true,
              nextAttemptAt: true,
            },
          },
        },
      },
    },
  });
  return mappings.map((mapping) => ({
    listingId: mapping.listing.id,
    externalId: mapping.listing.externalId,
    title: mapping.listing.title,
    marketplaceQuantity: mapping.listing.availableQuantity,
    accountNickname: mapping.listing.account.nickname,
    syncOn: mapping.listing.account.stockSyncEnabled && mapping.listing.account.allowWrites,
    push:
      mapping.listing.stockPushes.find((push) => push.variationKey === mapping.variationKey) ??
      null,
  }));
}
