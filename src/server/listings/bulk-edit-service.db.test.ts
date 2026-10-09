import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { EditableListing, ListingPatch, MarketplaceListing } from "@/connectors/types";
import { db } from "@/server/db";
import { batchProgress, runBatchRound } from "@/server/listings/batch-service";
import {
  bulkUndoInfo,
  previewBulkEdit,
  startBulkEdit,
  startUndo,
} from "@/server/listings/bulk-edit-service";
import { encryptTokens } from "@/server/marketplaces/token-service";
import { tenantDb } from "@/server/tenant/tenant-db";
import { fakeConnector } from "@/test/fake-connector";

// Real database (`npm run test:db`) in a TEMPORARY organization deleted at the end.
// Mercado Livre is simulated (an in-memory "marketplace" with prices and statuses).

const key = randomBytes(32);
let organizationId: string;
let accountId: string;
let lockedAccountId: string;
const ids: Record<string, string> = {};
const later = () => new Date(Date.now() + 60_000);
const tdb = () => tenantDb(organizationId);

/** Simulated marketplace state by external id. */
let market: Record<string, { priceCents: number; status: string }>;

function marketListing(externalId: string): MarketplaceListing {
  const state = market[externalId]!;
  return {
    externalId,
    title: externalId,
    status: state.status,
    subStatus: [],
    priceCents: state.priceCents,
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
  };
}

const updates: Array<{ id: string; patch: ListingPatch }> = [];
const connector = fakeConnector({
  getListingForEdit: async (_token, externalId): Promise<EditableListing> => ({
    listing: marketListing(externalId),
    attributes: [],
    description: null,
    rules: { titleEditable: false, familyNameEditable: false, titleLockReason: null },
  }),
  updateListing: async (_token, externalId, patch) => {
    updates.push({ id: externalId, patch });
    const state = market[externalId]!;
    if (patch.priceCents) state.priceCents = patch.priceCents;
    if (patch.status) state.status = patch.status;
    return { warnings: [] };
  },
});
const deps = { key, connectorFor: () => connector };

async function createListing(accId: string, externalId: string, priceCents: number) {
  const listing = await db.listing.create({
    data: {
      organizationId,
      marketplaceAccountId: accId,
      marketplace: "mercadolivre",
      externalId,
      title: externalId,
      status: "active",
      priceCents,
      raw: {},
      syncedAt: new Date(),
    },
  });
  ids[externalId] = listing.id;
}

beforeAll(async () => {
  organizationId = (await db.organization.create({ data: { name: "[teste] massa" } })).id;
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
  await createListing(accountId, "MLB9000001", 2990);
  await createListing(accountId, "MLB9000002", 4990);
  await createListing(lockedAccountId, "MLB9000003", 1990);
});

afterAll(async () => {
  await db.syncJob.deleteMany({ where: { organizationId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

beforeEach(async () => {
  market = {
    MLB9000001: { priceCents: 2990, status: "active" },
    MLB9000002: { priceCents: 4990, status: "active" },
    MLB9000003: { priceCents: 1990, status: "active" },
  };
  updates.length = 0;
  await db.listing.updateMany({
    where: { organizationId, externalId: "MLB9000001" },
    data: { priceCents: 2990, status: "active" },
  });
  await db.listing.updateMany({
    where: { organizationId, externalId: "MLB9000002" },
    data: { priceCents: 4990, status: "active" },
  });
});

const selection = () => ({
  kind: "ids" as const,
  listingIds: [ids.MLB9000001!, ids.MLB9000002!, ids.MLB9000003!],
});

describe("bulk edit against the database", () => {
  it("preview shows old -> new and what is skipped", async () => {
    const preview = await previewBulkEdit(tdb(), selection(), {
      kind: "price_percent",
      percent: 10,
      roundTo90: true,
    });
    const byId = Object.fromEntries(preview.rows.map((row) => [row.externalId, row.plan]));
    expect(byId.MLB9000001).toMatchObject({ change: { from: 2990, to: 3290 } });
    expect(byId.MLB9000002).toMatchObject({ change: { from: 4990, to: 5490 } });
    expect(byId.MLB9000003).toMatchObject({ action: "skip" }); // account locked
  });

  it("applies final values once, records history, and undo restores", async () => {
    const start = await startBulkEdit(tdb(), organizationId, null, selection(), {
      kind: "price_percent",
      percent: 10,
      roundTo90: true,
    });
    expect(start.status).toBe("started");
    const jobId = start.status === "started" ? start.jobIds[0]! : "";
    expect(await runBatchRound(organizationId, jobId, later(), deps)).toBe("completed");
    expect(market.MLB9000001!.priceCents).toBe(3290);
    expect(market.MLB9000002!.priceCents).toBe(5490);
    expect(market.MLB9000003!.priceCents).toBe(1990); // locked account untouched
    expect(await batchProgress(organizationId, jobId)).toMatchObject({ done: 2, failed: 0 });
    expect(await db.listingEdit.count({ where: { organizationId } })).toBeGreaterThanOrEqual(2);
    expect(await bulkUndoInfo(organizationId, jobId)).toEqual({ canUndo: true, isUndo: false });

    // Running the same job again changes nothing (final values, not "+10% again").
    await db.syncJob.update({
      where: { id: jobId },
      data: { status: "paused", pendingIds: [ids.MLB9000001!] },
    });
    await runBatchRound(organizationId, jobId, later(), deps);
    expect(market.MLB9000001!.priceCents).toBe(3290);

    const undo = await startUndo(organizationId, null, jobId);
    const undoId = undo.status === "started" ? undo.jobIds[0]! : "";
    await runBatchRound(organizationId, undoId, later(), deps);
    expect(market.MLB9000001!.priceCents).toBe(2990);
    expect(market.MLB9000002!.priceCents).toBe(4990);
    expect(await bulkUndoInfo(organizationId, undoId)).toEqual({ canUndo: false, isUndo: true });
  });

  it("a price changed elsewhere since the preview is reported, not overwritten", async () => {
    const start = await startBulkEdit(tdb(), organizationId, null, selection(), {
      kind: "price_set",
      cents: 3990,
      roundTo90: false,
    });
    const jobId = start.status === "started" ? start.jobIds[0]! : "";
    market.MLB9000001!.priceCents = 2500; // changed in the ML panel meanwhile
    await runBatchRound(organizationId, jobId, later(), deps);
    expect(market.MLB9000001!.priceCents).toBe(2500);
    expect(market.MLB9000002!.priceCents).toBe(3990);
    const progress = await batchProgress(organizationId, jobId);
    expect(progress).toMatchObject({ done: 1, failed: 1 });
    expect(progress?.errors[0]?.message).toContain("mudou desde a prévia");
  });

  it("pauses in bulk", async () => {
    const start = await startBulkEdit(tdb(), organizationId, null, selection(), {
      kind: "status",
      status: "paused",
    });
    const jobId = start.status === "started" ? start.jobIds[0]! : "";
    await runBatchRound(organizationId, jobId, later(), deps);
    expect(updates.map((update) => update.patch)).toEqual([
      { status: "paused" },
      { status: "paused" },
    ]);
    expect(market.MLB9000001!.status).toBe("paused");
  });
});
