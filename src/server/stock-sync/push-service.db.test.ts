import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  MarketplaceApiError,
  MarketplaceValidationError,
  type MarketplaceConnector,
} from "@/connectors/types";
import { SKIP_REASONS } from "@/domain/stock/push-rules";
import { db } from "@/server/db";
import { encryptTokens } from "@/server/marketplaces/token-service";
import {
  enqueueAllForAccount,
  enqueueForListings,
  enqueueForSkus,
  processStockPushes,
} from "@/server/stock-sync/push-service";
import { stockSyncPreview } from "@/server/stock-sync/queries";
import { tenantDb } from "@/server/tenant/tenant-db";
import { fakeConnector } from "@/test/fake-connector";

// Real database (`npm run test:db`) in a TEMPORARY organization deleted at the end.
// Mercado Livre is simulated: nothing is sent to it.

const key = randomBytes(32);
let organizationId: string;
let accountId: string;
let skuId: string;
const listings: Record<string, string> = {};

const tdb = () => tenantDb(organizationId);
const later = () => new Date(Date.now() + 60_000);

function simulator(fail?: (externalId: string) => Error | null) {
  const calls: { externalId: string; quantity: number }[] = [];
  const connector: MarketplaceConnector = fakeConnector({
    setListingStock: async (_token, externalId, quantity) => {
      const error = fail?.(externalId);
      if (error) throw error;
      calls.push({ externalId, quantity });
    },
  });
  return { calls, deps: { key, connectorFor: () => connector } };
}

async function createListing(externalId: string, extra: Record<string, unknown> = {}) {
  const listing = await db.listing.create({
    data: {
      organizationId,
      marketplaceAccountId: accountId,
      marketplace: "mercadolivre",
      externalId,
      title: externalId,
      status: "active",
      availableQuantity: 99,
      logisticType: "xd_drop_off",
      raw: {},
      syncedAt: new Date(),
      ...extra,
    },
  });
  listings[externalId] = listing.id;
  await db.skuListingMapping.create({
    data: { organizationId, skuId, listingId: listing.id },
  });
}

const pushOf = (externalId: string) =>
  db.stockPush.findFirst({ where: { organizationId, listingId: listings[externalId] } });

async function setStock(quantity: number) {
  await db.sku.update({ where: { id: skuId }, data: { stockOnHand: quantity } });
}

beforeAll(async () => {
  organizationId = (await db.organization.create({ data: { name: "[teste] estoque ML" } })).id;
  accountId = (
    await db.marketplaceAccount.create({
      data: {
        organizationId,
        marketplace: "mercadolivre",
        externalUserId: `test-${randomUUID()}`,
        nickname: "TESTE",
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
  const productId = (await db.product.create({ data: { organizationId, name: "Garrafa" } })).id;
  skuId = (
    await db.sku.create({
      data: { organizationId, productId, code: `TESTE-${randomUUID().slice(0, 8)}` },
    })
  ).id;
  // Two listings sharing one User Product (ML keeps one stock for both) + one Full.
  await createListing("MLB-UP-A", { userProductId: "MLBU1" });
  await createListing("MLB-UP-B", { userProductId: "MLBU1" });
  await createListing("MLB-FULL", { logisticType: "fulfillment" });
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

beforeEach(async () => {
  await db.stockPush.deleteMany({ where: { organizationId } });
  await db.marketplaceAccount.update({
    where: { id: accountId },
    data: { allowWrites: true, stockSyncEnabled: true, multiWarehouse: false },
  });
  await setStock(7);
});

describe("stock push queue against the database", () => {
  it("does not queue anything while the account switch is off", async () => {
    await db.marketplaceAccount.update({
      where: { id: accountId },
      data: { stockSyncEnabled: false },
    });
    expect(await enqueueForSkus(tdb(), organizationId, [skuId])).toBe(0);
    expect(await db.stockPush.count({ where: { organizationId } })).toBe(0);
  });

  it("sends once per User Product, skips Full and updates the local copy", async () => {
    expect(await enqueueAllForAccount(tdb(), organizationId, accountId)).toBe(3);
    expect(await pushOf("MLB-FULL")).toMatchObject({
      status: "skipped",
      skipReason: SKIP_REASONS.full,
    });

    const sim = simulator();
    const result = await processStockPushes(organizationId, later(), sim.deps);

    expect(sim.calls).toHaveLength(1);
    expect(sim.calls[0]?.quantity).toBe(7);
    expect(result).toMatchObject({ sent: 1, failed: 0, retrying: 0, timedOut: false });
    expect(await pushOf("MLB-UP-A")).toMatchObject({ status: "sent", sentQuantity: 7 });
    expect(await pushOf("MLB-UP-B")).toMatchObject({ status: "sent", sentQuantity: 7 });
    const local = await db.listing.findMany({
      where: { organizationId, userProductId: "MLBU1" },
      select: { availableQuantity: true },
    });
    expect(local.map((listing) => listing.availableQuantity)).toEqual([7, 7]);
    const full = await db.listing.findUniqueOrThrow({ where: { id: listings["MLB-FULL"] } });
    expect(full.availableQuantity).toBe(99);
  });

  it("queues only the listings asked for (e.g. a new link)", async () => {
    expect(await enqueueForListings(tdb(), organizationId, [listings["MLB-UP-B"]!])).toBe(1);
    expect(await db.stockPush.count({ where: { organizationId } })).toBe(1);
    expect(await pushOf("MLB-UP-B")).toMatchObject({ status: "pending", desiredQuantity: 7 });
  });

  it("many changes in a row become one send with the latest stock (negative = 0)", async () => {
    await enqueueForSkus(tdb(), organizationId, [skuId]);
    await setStock(3);
    await enqueueForSkus(tdb(), organizationId, [skuId]);
    await setStock(-2);
    await enqueueForSkus(tdb(), organizationId, [skuId]);

    const sim = simulator();
    await processStockPushes(organizationId, later(), sim.deps);
    expect(sim.calls.map((call) => call.quantity)).toEqual([0]);
    expect(await db.stockPush.count({ where: { organizationId } })).toBe(3);
  });

  it("network errors are retried later; refusals fail with the reason", async () => {
    await enqueueForSkus(tdb(), organizationId, [skuId]);
    const sim = simulator((externalId) =>
      externalId === "MLB-UP-A"
        ? new MarketplaceApiError("down", 503)
        : new MarketplaceValidationError(["Item pausado pelo Mercado Livre."]),
    );
    const result = await processStockPushes(organizationId, later(), sim.deps);

    expect(result).toMatchObject({ sent: 0, retrying: 1, failed: 1 });
    const retry = await pushOf("MLB-UP-A");
    expect(retry).toMatchObject({ status: "pending", attempts: 1, claimToken: null });
    expect(retry!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(await pushOf("MLB-UP-B")).toMatchObject({
      status: "failed",
      lastError: "Item pausado pelo Mercado Livre.",
    });

    // Not due yet: a new round does nothing.
    const ok = simulator();
    await processStockPushes(organizationId, later(), ok.deps);
    expect(ok.calls).toEqual([]);
  });

  it("gives up after the last attempt", async () => {
    await enqueueForSkus(tdb(), organizationId, [skuId]);
    await db.stockPush.updateMany({ where: { organizationId }, data: { attempts: 4 } });
    const sim = simulator(() => new MarketplaceApiError("down", 503));
    const result = await processStockPushes(organizationId, later(), sim.deps);
    expect(result.failed).toBe(2);
    expect(await pushOf("MLB-UP-A")).toMatchObject({ status: "failed", attempts: 5 });
  });

  it("a newer enqueue during a send keeps the row pending for the new value", async () => {
    await enqueueForSkus(tdb(), organizationId, [skuId]);
    let requeued = false;
    const connector = fakeConnector({
      setListingStock: async () => {
        if (requeued) return;
        requeued = true;
        await setStock(12);
        await enqueueForSkus(tdb(), organizationId, [skuId]); // clears the claim
      },
    });
    await processStockPushes(organizationId, later(), { key, connectorFor: () => connector });
    const rows = await db.stockPush.findMany({ where: { organizationId, status: "sent" } });
    // The stale send of 7 did not mark anything; the second round sent 12.
    expect(rows.map((row) => row.sentQuantity)).toEqual(expect.arrayContaining([12]));
    expect(rows.every((row) => row.sentQuantity === 12)).toBe(true);
  });

  it("skips multi-origin accounts and rows whose account was switched off", async () => {
    await enqueueForSkus(tdb(), organizationId, [skuId]);
    await db.marketplaceAccount.update({
      where: { id: accountId },
      data: { stockSyncEnabled: false },
    });
    const sim = simulator();
    expect((await processStockPushes(organizationId, later(), sim.deps)).skipped).toBe(2);
    expect(sim.calls).toEqual([]);

    await db.marketplaceAccount.update({
      where: { id: accountId },
      data: { stockSyncEnabled: true, multiWarehouse: true },
    });
    await enqueueForSkus(tdb(), organizationId, [skuId]);
    expect(await pushOf("MLB-UP-A")).toMatchObject({
      status: "skipped",
      skipReason: SKIP_REASONS.multiWarehouse,
    });
  });

  it("preview warns about listings that would be zeroed, Full last", async () => {
    await setStock(0);
    await db.listing.updateMany({ where: { organizationId }, data: { availableQuantity: 99 } });
    const rows = await stockSyncPreview(tdb(), accountId);
    expect(rows.map((row) => [row.externalId, row.willZero, row.plan.action])).toEqual([
      ["MLB-UP-A", true, "send"],
      ["MLB-UP-B", true, "send"],
      ["MLB-FULL", false, "skip"],
    ]);
    expect(await db.stockPush.count({ where: { organizationId } })).toBe(0); // preview sends nothing
  });

  it("stops at the deadline and leaves the rest for the next round", async () => {
    await enqueueForSkus(tdb(), organizationId, [skuId]);
    const sim = simulator();
    const result = await processStockPushes(organizationId, new Date(Date.now() - 1), sim.deps);
    expect(result.timedOut).toBe(true);
    expect(sim.calls).toEqual([]);
  });
});
