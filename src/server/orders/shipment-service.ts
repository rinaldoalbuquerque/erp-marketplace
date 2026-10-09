import "server-only";

import type { MarketplaceConnector, MarketplaceShipment, ShipmentSla } from "@/connectors/types";
import { DEADLINE_STAGES, OPEN_STAGES, orderStage } from "@/domain/orders/stage";
import { db } from "@/server/db";

// Keeps the shipment data of orders up to date (internal routine: unscoped
// `db`, always filtered by the account). A shipment can serve several orders
// (cart): every order pointing to it gets the same data, each with its own stage.

export type ShipmentAccount = { id: string; organizationId: string };

/** Fetches one shipment (and its deadline while it matters) and copies it onto its orders. */
export async function refreshShipment(
  account: ShipmentAccount,
  connector: MarketplaceConnector,
  accessToken: string,
  shippingId: string,
  now: Date,
): Promise<number> {
  const orders = await db.order.findMany({
    where: { organizationId: account.organizationId, marketplaceAccountId: account.id, shippingId },
    select: { id: true, status: true },
  });
  if (orders.length === 0) return 0;

  const shipment: MarketplaceShipment = await connector.getShipment(accessToken, shippingId);
  const stages = orders.map((order) =>
    orderStage({
      orderStatus: order.status,
      hasShipment: true,
      logisticType: shipment.logisticType,
      shipmentStatus: shipment.status,
      shipmentSubstatus: shipment.substatus,
    }),
  );
  // The marketplace has no deadline for cancelled / Full shipments: don't ask.
  let sla: ShipmentSla | null = null;
  if (stages.some((stage) => DEADLINE_STAGES.includes(stage))) {
    sla = await connector.getShipmentSla(accessToken, shippingId);
  }

  const common = {
    shipmentStatus: shipment.status,
    shipmentSubstatus: shipment.substatus,
    shipmentMode: shipment.mode,
    trackingNumber: shipment.trackingNumber,
    labelAvailableAt: shipment.labelAvailableAt,
    dispatchBy: sla?.expectedDate ?? null,
    slaStatus: sla?.status ?? null,
    shipmentSyncedAt: now,
    ...(shipment.logisticType ? { logisticType: shipment.logisticType } : {}),
  };
  for (const [index, order] of orders.entries()) {
    await db.order.updateMany({
      where: { id: order.id, organizationId: account.organizationId },
      data: { ...common, stage: stages[index] },
    });
  }
  return orders.length;
}

/** Orders whose shipment was never read or may have changed (oldest first). */
export async function shipmentsToRefresh(
  account: ShipmentAccount,
  { staleBefore, limit }: { staleBefore: Date; limit: number },
): Promise<string[]> {
  const rows = await db.order.findMany({
    where: {
      organizationId: account.organizationId,
      marketplaceAccountId: account.id,
      shippingId: { not: null },
      stage: { in: [...OPEN_STAGES] },
      OR: [{ shipmentSyncedAt: null }, { shipmentSyncedAt: { lt: staleBefore } }],
    },
    orderBy: [{ shipmentSyncedAt: { sort: "asc", nulls: "first" } }],
    distinct: ["shippingId"],
    take: limit,
    select: { shippingId: true },
  });
  return rows.map((row) => row.shippingId!).filter(Boolean);
}
