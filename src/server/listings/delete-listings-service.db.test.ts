import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MarketplaceValidationError, type EditableListing } from "@/connectors/types";
import { db } from "@/server/db";
import { batchProgress, runBatchRound } from "@/server/listings/batch-service";
import { startDeleteListings } from "@/server/listings/delete-listings-service";
import { encryptTokens } from "@/server/marketplaces/token-service";
import { tenantDb } from "@/server/tenant/tenant-db";
import { fakeConnector } from "@/test/fake-connector";

// Real database (`npm run test:db`) in a TEMPORARY organization deleted at the end.
// Mercado Livre is simulated: nothing real is deleted.

const key = randomBytes(32);
let organizationId: string;
let accountId: string;
let lockedAccountId: string;
const ids: Record<string, string> = {};
const later = () => new Date(Date.now() + 60_000);
const tdb = () => tenantDb(organizationId);

const deleted: Array<{ id: string; alreadyClosed: boolean }> = [];
const connector = fakeConnector({
  getListingForEdit: async (_token, externalId): Promise<EditableListing> => ({
    listing: {
      externalId,
      title: externalId,
      status: externalId === "MLB9100002" ? "closed" : "active",
      subStatus: [],
      priceCents: 1000,
      currency: "BRL",
      availableQuantity: 1,
      soldQuantity: 0,
      permalink: null,
      thumbnailUrl: null,
      categoryId: "MLB1",
      listingTypeId: "gold_special",
      condition: "new",
      listingModel: "user_products",
      userProductId: null,
      familyId: null,
      familyName: null,
      sellerSku: null,
      logisticType: null,
      externalUpdatedAt: new Date(),
      variations: [],
      raw: {},
    },
    attributes: [],
    description: null,
    rules: { titleEditable: false, familyNameEditable: false, titleLockReason: null },
  }),
  deleteListing: async (_token, externalId, options) => {
    if (externalId === "MLB9100003") {
      throw new MarketplaceValidationError(["Anúncio com estoque no Full."]);
    }
    deleted.push({ id: externalId, alreadyClosed: options.alreadyClosed });
  },
});
const deps = { key, connectorFor: () => connector };

async function createListing(accId: string, externalId: string) {
  const listing = await db.listing.create({
    data: {
      organizationId,
      marketplaceAccountId: accId,
      marketplace: "mercadolivre",
      externalId,
      title: externalId,
      status: "active",
      raw: {},
      syncedAt: new Date(),
    },
  });
  ids[externalId] = listing.id;
}

beforeAll(async () => {
  organizationId = (await db.organization.create({ data: { name: "[teste] excluir no ML" } })).id;
  const make = async (nickname: string, allowWrites: boolean) =>
    (
      await db.marketplaceAccount.create({
        data: {
          organizationId,
          marketplace: "mercadolivre",
          externalUserId: `test-${randomUUID()}`,
          nickname,
          allowWrites,
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
  accountId = await make("LIBERADA", true);
  lockedAccountId = await make("BLOQUEADA", false);
  await createListing(accountId, "MLB9100001");
  await createListing(accountId, "MLB9100002");
  await createListing(accountId, "MLB9100003");
  await createListing(lockedAccountId, "MLB9100004");
});

afterAll(async () => {
  await db.syncJob.deleteMany({ where: { organizationId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

describe("delete listings on the marketplace", () => {
  it("deletes, records and removes from the ERP; reports refusals; skips locked accounts", async () => {
    const started = await startDeleteListings(tdb(), organizationId, null, Object.values(ids));
    if (started.status !== "started") throw new Error("expected a batch");
    expect(started.blocked).toBe(1);
    expect(started.jobIds).toHaveLength(1);
    const jobId = started.jobIds[0]!;

    expect(await runBatchRound(organizationId, jobId, later(), deps)).toBe("completed");

    expect([...deleted].sort((x, y) => x.id.localeCompare(y.id))).toEqual([
      { id: "MLB9100001", alreadyClosed: false },
      { id: "MLB9100002", alreadyClosed: true },
    ]);
    const progress = await batchProgress(organizationId, jobId);
    expect(progress).toMatchObject({ type: "delete_listings", done: 2, failed: 1 });
    expect(progress?.errors[0]?.message).toContain("Full");

    const rows = await db.listing.findMany({
      where: { organizationId },
      select: { externalId: true, removedAt: true },
      orderBy: { externalId: "asc" },
    });
    expect(rows.map((row) => [row.externalId, row.removedAt !== null])).toEqual([
      ["MLB9100001", true],
      ["MLB9100002", true],
      ["MLB9100003", false],
      ["MLB9100004", false],
    ]);
    expect(
      await db.listingEdit.count({
        where: { organizationId, listingId: ids.MLB9100001, message: "Excluído no Mercado Livre." },
      }),
    ).toBe(1);

    // Running the same batch again sends nothing twice.
    await db.syncJob.update({
      where: { id: jobId },
      data: { status: "paused", pendingIds: [ids.MLB9100001!] },
    });
    await runBatchRound(organizationId, jobId, later(), deps);
    expect(deleted).toHaveLength(2);
  });
});
