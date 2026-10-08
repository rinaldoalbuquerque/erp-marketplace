import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type {
  ListingFetchResult,
  MarketplaceConnector,
  MarketplaceListing,
} from "@/connectors/types";
import { db } from "@/server/db";
import { runImportRound, startImport } from "@/server/listings/import-service";
import { encryptTokens } from "@/server/marketplaces/token-service";
import { tenantDb } from "@/server/tenant/tenant-db";

// Real database (`npm run test:db`) in a TEMPORARY organization deleted at the
// end. Mercado Livre is simulated: nothing is called or changed there.

const key = randomBytes(32);
let organizationId: string;
let accountId: string;
const farFuture = () => new Date(Date.now() + 60 * 60 * 1000);

function listing(id: string, overrides: Partial<MarketplaceListing> = {}): MarketplaceListing {
  return {
    externalId: id,
    title: `Anúncio ${id}`,
    status: "active",
    subStatus: [],
    priceCents: 1000,
    currency: "BRL",
    availableQuantity: 5,
    soldQuantity: 0,
    permalink: null,
    thumbnailUrl: null,
    categoryId: "MLB1",
    listingTypeId: "gold_special",
    condition: "new",
    listingModel: "user_products",
    userProductId: `UP-${id}`,
    familyId: "F1",
    familyName: "Família",
    sellerSku: `SKU-${id}`,
    externalUpdatedAt: null,
    variations: [],
    raw: { id },
    ...overrides,
  };
}

/** Fake marketplace with `count` listings; per-test overrides via `items`. */
function fakeConnector(count: number, items: Record<string, ListingFetchResult> = {}) {
  const ids = Array.from({ length: count }, (_, index) => `MLB${1000 + index}`);
  const calls = { list: 0, get: 0 };
  const connector: MarketplaceConnector = {
    id: "mercadolivre",
    label: "Mercado Livre",
    buildAuthorizationUrl: () => "",
    exchangeCode: async () => {
      throw new Error("not used");
    },
    refreshTokens: async () => {
      throw new Error("not used");
    },
    getAccountProfile: async () => {
      throw new Error("not used");
    },
    listListingIds: async () => {
      calls.list++;
      return ids;
    },
    getListings: async (_token, externalIds) => {
      calls.get++;
      return externalIds.map((id) => items[id] ?? { externalId: id, listing: listing(id) });
    },
  };
  return { connector, calls, ids };
}

const deps = (connector: MarketplaceConnector, now?: () => Date) => ({
  key,
  connectorFor: () => connector,
  ...(now ? { now } : {}),
});

beforeAll(async () => {
  organizationId = (await db.organization.create({ data: { name: "[teste] importação" } })).id;
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
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

beforeEach(async () => {
  await db.syncJob.deleteMany({ where: { organizationId } });
  await db.listing.deleteMany({ where: { organizationId } });
});

async function importAll(connector: MarketplaceConnector) {
  const start = await startImport(organizationId, accountId, null);
  if (!("jobId" in start)) throw new Error("not started");
  const result = await runImportRound(organizationId, start.jobId, farFuture(), deps(connector));
  return { jobId: start.jobId, result };
}

describe("listing import against the database", () => {
  it("imports every listing, reports counts and updates the account sync date", async () => {
    const { connector } = fakeConnector(45);
    const { jobId, result } = await importAll(connector);

    expect(result).toBe("completed");
    expect(await db.listing.count({ where: { organizationId } })).toBe(45);
    const job = await db.syncJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job).toMatchObject({
      status: "completed",
      total: 45,
      processed: 45,
      createdCount: 45,
      updatedCount: 0,
    });
    const account = await db.marketplaceAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.lastSyncAt).not.toBeNull();
  });

  it("importing again never duplicates (idempotent)", async () => {
    const { connector } = fakeConnector(30);
    await importAll(connector);
    const second = await importAll(connector);

    expect(await db.listing.count({ where: { organizationId } })).toBe(30);
    const job = await db.syncJob.findUniqueOrThrow({ where: { id: second.jobId } });
    expect(job).toMatchObject({ createdCount: 0, updatedCount: 30 });
  });

  it("stops at the time budget and resumes where it stopped", async () => {
    const { connector, calls } = fakeConnector(50);
    const start = await startImport(organizationId, accountId, null);
    if (!("jobId" in start)) throw new Error("not started");

    // Clock: the deadline passes right after the first step.
    let tick = 0;
    const base = Date.now();
    const clock = () => new Date(base + tick++ * 1000);
    const first = await runImportRound(
      organizationId,
      start.jobId,
      new Date(base + 3500),
      deps(connector, clock),
    );
    expect(first).toBe("paused");
    const paused = await db.syncJob.findUniqueOrThrow({ where: { id: start.jobId } });
    expect(paused.processed).toBeGreaterThan(0);
    expect(paused.processed).toBeLessThan(50);

    const again = await startImport(organizationId, accountId, null);
    expect(again).toEqual({ status: "resumed", jobId: start.jobId });
    expect(await runImportRound(organizationId, start.jobId, farFuture(), deps(connector))).toBe(
      "completed",
    );
    expect(await db.listing.count({ where: { organizationId } })).toBe(50);
    expect(calls.list).toBe(1); // the id list is fetched once and kept
  });

  it("only one round works on a job at a time", async () => {
    const { connector } = fakeConnector(40);
    const start = await startImport(organizationId, accountId, null);
    if (!("jobId" in start)) throw new Error("not started");
    const results = await Promise.all([
      runImportRound(organizationId, start.jobId, farFuture(), deps(connector)),
      runImportRound(organizationId, start.jobId, farFuture(), deps(connector)),
    ]);
    expect(results.sort()).toEqual(["busy", "completed"]);
    expect(await db.listing.count({ where: { organizationId } })).toBe(40);
  });

  it("a second start while the first is open returns the same job", async () => {
    const first = await startImport(organizationId, accountId, null);
    const second = await startImport(organizationId, accountId, null);
    if (!("jobId" in first) || !("jobId" in second)) throw new Error("not started");
    expect(second.jobId).toBe(first.jobId);
    expect(await db.syncJob.count({ where: { organizationId } })).toBe(1);
  });

  it("puts per-listing errors in the report and keeps going", async () => {
    const { connector } = fakeConnector(5, {
      MLB1002: { externalId: "MLB1002", error: "Item not found" },
    });
    const { jobId } = await importAll(connector);
    const job = await db.syncJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job).toMatchObject({ status: "completed", failedCount: 1, createdCount: 4 });
    expect(job.errors).toEqual([{ id: "MLB1002", message: "Item not found" }]);
  });

  it("removes variations that no longer exist in the marketplace", async () => {
    const variation = (id: string) => ({
      externalId: id,
      attributes: [{ name: "Cor", value: id }],
      priceCents: 100,
      availableQuantity: 1,
      soldQuantity: 0,
      sellerSku: null,
    });
    const withTwo = fakeConnector(1, {
      MLB1000: {
        externalId: "MLB1000",
        listing: listing("MLB1000", {
          listingModel: "traditional",
          variations: [variation("V1"), variation("V2")],
        }),
      },
    });
    await importAll(withTwo.connector);
    expect(await db.listingVariation.count({ where: { organizationId } })).toBe(2);

    const withOne = fakeConnector(1, {
      MLB1000: {
        externalId: "MLB1000",
        listing: listing("MLB1000", { listingModel: "traditional", variations: [variation("V2")] }),
      },
    });
    await importAll(withOne.connector);
    const left = await db.listingVariation.findMany({ where: { organizationId } });
    expect(left.map((row) => row.externalId)).toEqual(["V2"]);
  });

  it("another organization sees none of the imported listings", async () => {
    const { connector } = fakeConnector(3);
    await importAll(connector);
    expect(await tenantDb(randomUUID()).listing.count()).toBe(0);
    expect(await tenantDb(organizationId).listing.count()).toBe(3);
  });
});
