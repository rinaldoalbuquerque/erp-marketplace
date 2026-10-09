import "server-only";

import type { MarketplaceId, MarketplaceOrder } from "@/connectors/types";
import { orderStage } from "@/domain/orders/stage";
import { decideItemStock } from "@/domain/orders/stock-rules";
import { adjustStock } from "@/server/stock/stock-service";
import { tenantDb } from "@/server/tenant/tenant-db";

import { Prisma } from "@/generated/prisma/client";

// Saves a marketplace order and applies it to ERP stock (Phase 3A).
// - Saving is idempotent (upsert by account + external id), so the same
//   notification, the catch-up search and a retry can all run it safely.
// - Each stock movement has a fixed idempotency key per order line
//   (…:sale / …:return): even two rounds at the same time move stock once.
// - Returns the SKUs whose stock changed, so the caller queues the new balance
//   to the other listings (stock sync).

export type OrderAccount = {
  id: string;
  organizationId: string;
  marketplace: MarketplaceId;
  orderStockEnabled: boolean;
  orderStockSince: Date | null;
};

export type SaveOrderResult = { orderId: string; changedSkuIds: string[] };

const stockKey = (accountId: string, orderId: string, itemId: string, variation: string) =>
  `order:${accountId}:${orderId}:${itemId}:${variation}`;

export async function saveOrder(
  account: OrderAccount,
  order: MarketplaceOrder,
  syncedAt: Date,
): Promise<SaveOrderResult> {
  const organizationId = account.organizationId;
  const tdb = tenantDb(organizationId);

  // Local copies of the sold listings (and variations, for traditional listings).
  const itemIds = [...new Set(order.items.map((item) => item.externalItemId))];
  const listings = await tdb.listing.findMany({
    where: { marketplaceAccountId: account.id, externalId: { in: itemIds } },
    select: {
      id: true,
      externalId: true,
      logisticType: true,
      variations: { select: { id: true, externalId: true } },
    },
  });
  const listingByExternal = new Map(listings.map((listing) => [listing.externalId, listing]));
  const orderKey = {
    marketplaceAccountId_externalId: {
      marketplaceAccountId: account.id,
      externalId: order.externalId,
    },
  };
  // Shipment data already synced (shipment-service.ts) wins over the listing guess.
  const existing = await tdb.order.findUnique({
    where: orderKey,
    select: {
      logisticType: true,
      shipmentStatus: true,
      shipmentSubstatus: true,
      shipmentSyncedAt: true,
    },
  });
  const logisticType =
    (existing?.shipmentSyncedAt ? existing.logisticType : null) ??
    order.items
      .map((item) => listingByExternal.get(item.externalItemId)?.logisticType)
      .find((value) => value) ??
    null;
  const stage = orderStage({
    orderStatus: order.status,
    hasShipment: order.shippingId !== null,
    logisticType,
    shipmentStatus: existing?.shipmentStatus ?? null,
    shipmentSubstatus: existing?.shipmentSubstatus ?? null,
  });

  const data = {
    marketplace: account.marketplace,
    packId: order.packId,
    status: order.status,
    tags: order.tags,
    totalCents: order.totalCents,
    currency: order.currency,
    buyerNickname: order.buyerNickname,
    shippingId: order.shippingId,
    logisticType,
    stage,
    dateCreated: order.dateCreated,
    dateClosed: order.dateClosed,
    externalUpdatedAt: order.externalUpdatedAt,
    raw: (order.raw ?? {}) as Prisma.InputJsonValue,
    syncedAt,
  };
  const saved = await tdb.order.upsert({
    where: orderKey,
    create: {
      organizationId,
      marketplaceAccountId: account.id,
      externalId: order.externalId,
      ...data,
    },
    update: data,
    select: { id: true },
  });

  const changedSkuIds = new Set<string>();
  for (const item of order.items) {
    const listing = listingByExternal.get(item.externalItemId) ?? null;
    const lineData = {
      title: item.title,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      saleFeeCents: item.saleFeeCents,
      sellerSku: item.sellerSku,
      listingId: listing?.id ?? null,
    };
    const line = await tdb.orderItem.upsert({
      where: {
        orderId_externalItemId_variationKey: {
          orderId: saved.id,
          externalItemId: item.externalItemId,
          variationKey: item.variationKey,
        },
      },
      create: {
        organizationId,
        orderId: saved.id,
        externalItemId: item.externalItemId,
        variationKey: item.variationKey,
        ...lineData,
      },
      update: lineData,
      select: { id: true, stockStatus: true, skuId: true },
    });

    // Linked SKU: whole listing (variation key "") or the local variation row.
    let skuId = line.skuId;
    if (!skuId && listing) {
      const localVariation = item.variationKey
        ? listing.variations.find((variation) => variation.externalId === item.variationKey)
        : null;
      if (!item.variationKey || localVariation) {
        const mapping = await tdb.skuListingMapping.findFirst({
          where: { listingId: listing.id, variationKey: localVariation?.id ?? "" },
          select: { skuId: true },
        });
        skuId = mapping?.skuId ?? null;
      }
    }

    const decision = decideItemStock({
      current: line.stockStatus,
      orderStatus: order.status,
      dateClosed: order.dateClosed,
      logisticType,
      account,
      hasSku: skuId !== null,
    });
    if (decision.action === "none") continue;
    if (decision.action === "mark") {
      await tdb.orderItem.updateMany({
        where: { id: line.id },
        data: { stockStatus: decision.status, stockNote: decision.note },
      });
      continue;
    }

    const key = stockKey(account.id, order.externalId, item.externalItemId, item.variationKey);
    const restore = decision.action === "restore";
    const result = await adjustStock(tdb, {
      organizationId,
      skuId: skuId!,
      type: restore ? "sale_return" : "sale",
      quantity: item.quantity,
      reason: restore ? `Venda #${order.externalId} cancelada` : `Venda #${order.externalId}`,
      idempotencyKey: `${key}:${restore ? "return" : "sale"}`,
    });
    if (result.status === "not_found") continue; // SKU removed meanwhile: try again next update
    await tdb.orderItem.updateMany({
      where: { id: line.id },
      data: { stockStatus: restore ? "restored" : "deducted", skuId, stockNote: null },
    });
    if (result.status === "applied") changedSkuIds.add(skuId!);
  }
  return { orderId: saved.id, changedSkuIds: [...changedSkuIds] };
}
