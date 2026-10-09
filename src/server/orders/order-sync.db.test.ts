import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MarketplaceApiError, type MarketplaceOrder } from "@/connectors/types";
import { STOCK_NOTES } from "@/domain/orders/stock-rules";
import { db } from "@/server/db";
import { encryptTokens } from "@/server/marketplaces/token-service";
import { saveOrder, type OrderAccount } from "@/server/orders/order-service";
import {
  catchUpOrders,
  processNotifications,
  recordNotification,
} from "@/server/orders/order-sync";
import { fakeConnector } from "@/test/fake-connector";

// Real database (`npm run test:db`) in a TEMPORARY organization deleted at the end.
// Mercado Livre is simulated: nothing is sent to it.

const key = randomBytes(32);
const SINCE = new Date("2026-10-09T12:00:00.000Z");
const externalUserId = `test-${randomUUID()}`;
let organizationId: string;
let accountId: string;
let skuId: string;
let account: OrderAccount;

async function createListing(externalId: string, extra: Record<string, unknown> = {}) {
  return db.listing.create({
    data: {
      organizationId,
      marketplaceAccountId: accountId,
      marketplace: "mercadolivre",
      externalId,
      title: externalId,
      status: "active",
      logisticType: "xd_drop_off",
      raw: {},
      syncedAt: new Date(),
      ...extra,
    },
  });
}

let orderCounter = 0;
function order(overrides: Partial<MarketplaceOrder> = {}): MarketplaceOrder {
  orderCounter++;
  return {
    externalId: `${Date.now()}${orderCounter}`,
    packId: null,
    status: "paid",
    tags: ["paid"],
    totalCents: 5000,
    currency: "BRL",
    buyerNickname: "COMPRADOR",
    shippingId: null,
    dateCreated: new Date("2026-10-09T13:00:00.000Z"),
    dateClosed: new Date("2026-10-09T13:00:05.000Z"),
    externalUpdatedAt: new Date("2026-10-09T13:00:05.000Z"),
    items: [
      {
        externalItemId: "MLB-A",
        variationKey: "",
        title: "Garrafa",
        quantity: 2,
        unitPriceCents: 2500,
        saleFeeCents: 300,
        sellerSku: null,
      },
    ],
    raw: {},
    ...overrides,
  };
}

const balance = async () => (await db.sku.findUniqueOrThrow({ where: { id: skuId } })).stockOnHand;
const itemsOf = (externalId: string) =>
  db.orderItem.findMany({ where: { organizationId, order: { externalId } } });

beforeAll(async () => {
  organizationId = (await db.organization.create({ data: { name: "[teste] pedidos" } })).id;
  accountId = (
    await db.marketplaceAccount.create({
      data: {
        organizationId,
        marketplace: "mercadolivre",
        externalUserId,
        nickname: "TESTE",
        orderStockEnabled: true,
        orderStockSince: SINCE,
        ...encryptTokens(
          {
            accessToken: "access",
            refreshToken: "refresh",
            expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
            scopes: null,
            externalUserId: "1",
          },
          key,
        ),
      },
    })
  ).id;
  account = {
    id: accountId,
    organizationId,
    marketplace: "mercadolivre",
    orderStockEnabled: true,
    orderStockSince: SINCE,
  };
  const productId = (await db.product.create({ data: { organizationId, name: "Garrafa" } })).id;
  skuId = (
    await db.sku.create({
      data: { organizationId, productId, code: `TESTE-${randomUUID().slice(0, 8)}` },
    })
  ).id;

  const linked = await createListing("MLB-A");
  const full = await createListing("MLB-FULL", { logisticType: "fulfillment" });
  await createListing("MLB-NOSKU");
  const traditional = await createListing("MLB-VAR");
  const variation = await db.listingVariation.create({
    data: { organizationId, listingId: traditional.id, externalId: "555", attributes: [] },
  });
  for (const listing of [linked, full]) {
    await db.skuListingMapping.create({ data: { organizationId, skuId, listingId: listing.id } });
  }
  await db.skuListingMapping.create({
    data: {
      organizationId,
      skuId,
      listingId: traditional.id,
      listingVariationId: variation.id,
      variationKey: variation.id,
    },
  });
});

afterAll(async () => {
  await db.marketplaceNotification.deleteMany({ where: { externalUserId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

beforeEach(async () => {
  await db.sku.update({ where: { id: skuId }, data: { stockOnHand: 10 } });
});

describe("orders against the database", () => {
  it("a confirmed sale lowers stock once, however many times it is saved", async () => {
    const sale = order();
    const first = await saveOrder(account, sale, new Date());
    await saveOrder(account, sale, new Date());
    expect(first.changedSkuIds).toEqual([skuId]);
    expect(await balance()).toBe(8);
    expect(await itemsOf(sale.externalId)).toMatchObject([
      { stockStatus: "deducted", skuId, quantity: 2 },
    ]);
    expect(await db.order.count({ where: { organizationId, externalId: sale.externalId } })).toBe(
      1,
    );
  });

  it("waits for payment, then deducts; a later cancellation gives stock back once", async () => {
    const pending = order({ status: "payment_in_process", dateClosed: null });
    await saveOrder(account, pending, new Date());
    expect(await balance()).toBe(10);
    expect((await itemsOf(pending.externalId))[0]?.stockStatus).toBe("waiting");

    await saveOrder(account, { ...pending, status: "paid", dateClosed: SINCE }, new Date());
    expect(await balance()).toBe(8);

    const cancelled = { ...pending, status: "cancelled", dateClosed: SINCE };
    await saveOrder(account, cancelled, new Date());
    await saveOrder(account, cancelled, new Date());
    expect(await balance()).toBe(10);
    expect((await itemsOf(pending.externalId))[0]?.stockStatus).toBe("restored");
  });

  it("Full, unlinked and pre-switch sales do not move stock", async () => {
    const full = order({ items: [{ ...order().items[0]!, externalItemId: "MLB-FULL" }] });
    const unlinked = order({ items: [{ ...order().items[0]!, externalItemId: "MLB-NOSKU" }] });
    const old = order({ dateClosed: new Date("2026-10-01T10:00:00.000Z") });
    for (const sale of [full, unlinked, old]) await saveOrder(account, sale, new Date());

    expect(await balance()).toBe(10);
    expect((await itemsOf(full.externalId))[0]).toMatchObject({
      stockStatus: "not_applicable",
      stockNote: STOCK_NOTES.full,
    });
    expect((await itemsOf(unlinked.externalId))[0]?.stockStatus).toBe("missing_sku");
    expect((await itemsOf(old.externalId))[0]?.stockNote).toBe(STOCK_NOTES.beforeSwitch);
  });

  it("finds the SKU of a traditional listing variation", async () => {
    const sale = order({
      items: [
        { ...order().items[0]!, externalItemId: "MLB-VAR", variationKey: "555", quantity: 1 },
      ],
    });
    await saveOrder(account, sale, new Date());
    expect(await balance()).toBe(9);
  });

  it("notifications: recorded once per order, fetched with our token, unknown accounts ignored", async () => {
    const sale = order();
    const resource = `/orders/${sale.externalId}`;
    await recordNotification("mercadolivre", {
      topic: "orders_v2",
      resource,
      user_id: externalUserId,
    });
    await recordNotification("mercadolivre", {
      topic: "orders_v2",
      resource,
      user_id: externalUserId,
    });
    await recordNotification("mercadolivre", {
      topic: "orders_v2",
      resource: "/orders/1",
      user_id: `${externalUserId}-other`,
    });
    const row = await db.marketplaceNotification.findFirstOrThrow({ where: { resource } });
    expect(row.version).toBe(2);

    const asked: string[] = [];
    const connector = fakeConnector({
      getOrder: async (_token, id) => {
        asked.push(id);
        return sale;
      },
    });
    const result = await processNotifications(new Date(Date.now() + 60_000), {
      key,
      connectorFor: () => connector,
    });
    expect(asked).toEqual([sale.externalId]);
    expect(result).toMatchObject({ done: 1, ignored: 1, organizations: [organizationId] });
    expect(await balance()).toBe(8);
    expect(
      (await db.marketplaceNotification.findFirstOrThrow({ where: { resource } })).status,
    ).toBe("done");
    await db.marketplaceNotification.deleteMany({
      where: { externalUserId: { startsWith: externalUserId } },
    });
  });

  it("notifications: a failing read is retried later", async () => {
    const resource = `/orders/9${Date.now()}`;
    await recordNotification("mercadolivre", {
      topic: "orders_v2",
      resource,
      user_id: externalUserId,
    });
    const connector = fakeConnector({
      getOrder: async () => {
        throw new MarketplaceApiError("down", 503);
      },
    });
    const result = await processNotifications(new Date(Date.now() + 60_000), {
      key,
      connectorFor: () => connector,
    });
    expect(result.retrying).toBe(1);
    const row = await db.marketplaceNotification.findFirstOrThrow({ where: { resource } });
    expect(row).toMatchObject({ status: "pending", tries: 1, claimedUntil: null });
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("catch-up applies changed orders and moves the cursor", async () => {
    const sale = order();
    let window: { from: Date; to: Date } | null = null;
    const connector = fakeConnector({
      searchOrdersUpdated: async (_token, userId, from, to) => {
        expect(userId).toBe(externalUserId);
        window = { from, to };
        return [sale];
      },
    });
    const now = new Date("2026-10-09T15:00:00.000Z");
    const result = await catchUpOrders(organizationId, accountId, {
      key,
      now: () => now,
      connectorFor: () => connector,
    });
    expect(result).toEqual({ status: "ok", orders: 1, stockChanged: true });
    expect(window!.to).toEqual(now);
    expect(await balance()).toBe(8);
    const saved = await db.marketplaceAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(saved.ordersSyncedAt).toEqual(now);
  });
});

describe("shipments against the database", () => {
  const shipment = (status: string, substatus: string | null) => ({
    externalId: "777",
    status,
    substatus,
    mode: "me2",
    logisticType: "xd_drop_off",
    trackingNumber: "BR1",
    labelAvailableAt: null,
    raw: {},
  });

  it("cart orders share the shipment: stage, deadline and tracking go to both", async () => {
    const first = order({ shippingId: "777", packId: "P1" });
    const second = order({ shippingId: "777", packId: "P1" });
    let current = shipment("ready_to_ship", "ready_to_print");
    const slaCalls: string[] = [];
    const connector = fakeConnector({
      getOrder: async (_token, id) => (id === first.externalId ? first : second),
      getShipment: async () => current,
      getShipmentSla: async (_token, id) => {
        slaCalls.push(id);
        return { expectedDate: new Date("2026-10-10T21:00:00.000Z"), status: "on_time" };
      },
    });
    const deps = { key, connectorFor: () => connector };
    for (const sale of [first, second]) {
      await recordNotification("mercadolivre", {
        topic: "orders_v2",
        resource: `/orders/${sale.externalId}`,
        user_id: externalUserId,
      });
    }
    await processNotifications(new Date(Date.now() + 60_000), deps);

    const rows = await db.order.findMany({ where: { organizationId, shippingId: "777" } });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        stage: "ready_to_print",
        shipmentMode: "me2",
        trackingNumber: "BR1",
        dispatchBy: new Date("2026-10-10T21:00:00.000Z"),
      });
    }

    // Shipment notification after printing: stage moves, no deadline asked once shipped.
    current = shipment("shipped", null);
    slaCalls.length = 0;
    await recordNotification("mercadolivre", {
      topic: "shipments",
      resource: "/shipments/777",
      user_id: externalUserId,
    });
    await processNotifications(new Date(Date.now() + 60_000), deps);
    const shipped = await db.order.findMany({ where: { organizationId, shippingId: "777" } });
    expect(shipped.map((row) => row.stage)).toEqual(["shipped", "shipped"]);
    expect(slaCalls).toEqual([]);
    await db.marketplaceNotification.deleteMany({ where: { externalUserId } });
  });

  it("catch-up refreshes open shipments not read recently; one bad shipment does not stop it", async () => {
    const open = order({ shippingId: "S-OPEN" });
    const broken = order({ shippingId: "S-BROKEN" });
    for (const sale of [open, broken]) await saveOrder(account, sale, new Date());
    const connector = fakeConnector({
      searchOrdersUpdated: async () => [],
      getShipment: async (_token, id) => {
        if (id === "S-BROKEN") throw new MarketplaceApiError("down", 503);
        return { ...shipment("handling", "invoice_pending"), externalId: id };
      },
      getShipmentSla: async () => null,
    });
    const result = await catchUpOrders(organizationId, accountId, {
      key,
      connectorFor: () => connector,
    });
    expect(result.status).toBe("ok");
    const refreshed = await db.order.findFirstOrThrow({
      where: { organizationId, externalId: open.externalId },
    });
    expect(refreshed.stage).toBe("invoice_pending");
  });
});
