import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MarketplaceValidationError,
  type EditableListing,
  type ListingPatch,
  type MarketplaceListing,
} from "@/connectors/types";
import type { AttributeDefinition } from "@/domain/listings/attributes";
import { db } from "@/server/db";
import { loadForEdit, saveEdit } from "@/server/listings/edit-service";
import { encryptTokens } from "@/server/marketplaces/token-service";
import { tenantDb } from "@/server/tenant/tenant-db";
import { fakeConnector } from "@/test/fake-connector";

// Real database (`npm run test:db`) in a TEMPORARY organization deleted at the end.
// Mercado Livre is simulated: nothing is sent to it.

const key = randomBytes(32);
const CATEGORY = `MLBTEST-${randomUUID().slice(0, 8)}`;
let organizationId: string;
let accountId: string;
let listingId: string;

const definitions: AttributeDefinition[] = [
  {
    id: "BRAND",
    name: "Marca",
    valueType: "string",
    values: [],
    units: [],
    defaultUnit: null,
    required: true,
    conditionalRequired: false,
    hidden: false,
    readOnly: false,
    multivalued: false,
    maxLength: null,
    group: null,
  },
];

function marketplaceListing(overrides: Partial<MarketplaceListing> = {}): MarketplaceListing {
  return {
    externalId: "MLB1",
    title: "Item de Teste – Por favor, NÃO OFERTAR!",
    status: "active",
    subStatus: [],
    priceCents: 1000,
    currency: "BRL",
    availableQuantity: 1,
    soldQuantity: 0,
    permalink: null,
    thumbnailUrl: null,
    categoryId: CATEGORY,
    listingTypeId: "gold_special",
    condition: "new",
    listingModel: "traditional",
    userProductId: null,
    familyId: null,
    familyName: null,
    sellerSku: null,
    externalUpdatedAt: new Date("2026-10-08T10:00:00.000Z"),
    variations: [],
    raw: {},
    ...overrides,
  };
}

/** Simulated marketplace state + spies. */
function setup(state: { listing: MarketplaceListing; description: string | null }) {
  const updates: ListingPatch[] = [];
  const descriptions: string[] = [];
  const getCategoryAttributes = vi.fn(async () => definitions);
  const connector = fakeConnector({
    getCategoryAttributes,
    getListingForEdit: async (): Promise<EditableListing> => ({
      listing: state.listing,
      attributes: [{ id: "BRAND", valueId: null, valueName: "Termolar" }],
      description: state.description,
      rules: { titleEditable: true, familyNameEditable: false, titleLockReason: null },
    }),
    updateListing: async (_token, _id, patch) => {
      updates.push(patch);
      state.listing = {
        ...state.listing,
        ...(patch.priceCents ? { priceCents: patch.priceCents } : {}),
        externalUpdatedAt: new Date("2026-10-08T11:00:00.000Z"),
      };
      return { warnings: [] };
    },
    updateListingDescription: async (_token, _id, text) => {
      descriptions.push(text);
    },
  });
  return { connector, updates, descriptions, getCategoryAttributes };
}

const ctx = (canClose = true) => ({
  tdb: tenantDb(organizationId),
  organizationId,
  userId: null,
  canClose,
});
const STAMP = "2026-10-08T10:00:00.000Z";

beforeAll(async () => {
  organizationId = (await db.organization.create({ data: { name: "[teste] edição" } })).id;
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
  listingId = (
    await db.listing.create({
      data: {
        organizationId,
        marketplaceAccountId: accountId,
        marketplace: "mercadolivre",
        externalId: "MLB1",
        title: "Antigo",
        status: "active",
        categoryId: CATEGORY,
        raw: {},
        syncedAt: new Date(),
      },
    })
  ).id;
});

afterAll(async () => {
  await db.marketplaceCategory.deleteMany({ where: { categoryId: CATEGORY } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

beforeEach(async () => {
  await db.marketplaceAccount.update({ where: { id: accountId }, data: { allowWrites: true } });
  await db.listingEdit.deleteMany({ where: { organizationId } });
});

describe("listing edit against the database", () => {
  it("with the account switch off, nothing reaches the marketplace", async () => {
    await db.marketplaceAccount.update({ where: { id: accountId }, data: { allowWrites: false } });
    const sim = setup({ listing: marketplaceListing(), description: null });
    const deps = { key, connectorFor: () => sim.connector };
    expect((await loadForEdit(ctx(), listingId, deps)).status).toBe("writes_disabled");
    expect(
      (await saveEdit(ctx(), listingId, { versionStamp: STAMP, priceCents: 2000 }, deps)).status,
    ).toBe("writes_disabled");
    expect(sim.updates).toEqual([]);
  });

  it("load refreshes the local copy and caches the category sheet", async () => {
    const sim = setup({ listing: marketplaceListing(), description: "Texto" });
    const deps = { key, connectorFor: () => sim.connector };
    const first = await loadForEdit(ctx(), listingId, deps);
    expect(first).toMatchObject({ status: "ok", versionStamp: STAMP });
    await loadForEdit(ctx(), listingId, deps);
    expect(sim.getCategoryAttributes).toHaveBeenCalledTimes(1); // second time from cache
    const local = await db.listing.findUniqueOrThrow({ where: { id: listingId } });
    expect(local.title).toBe("Item de Teste – Por favor, NÃO OFERTAR!");
  });

  it("sends only what changed, records the edit and updates the local copy", async () => {
    const sim = setup({ listing: marketplaceListing(), description: "Texto" });
    const result = await saveEdit(
      ctx(),
      listingId,
      {
        versionStamp: STAMP,
        title: "Item de Teste – Por favor, NÃO OFERTAR!", // unchanged
        priceCents: 2500,
        description: "Texto", // unchanged
        attributes: { BRAND: { value: "Termolar" } }, // unchanged
      },
      { key, connectorFor: () => sim.connector },
    );
    expect(result).toMatchObject({ status: "saved", notApplied: [], notices: [] });
    expect(sim.updates).toEqual([{ priceCents: 2500 }]);
    expect(sim.descriptions).toEqual([]);
    const local = await db.listing.findUniqueOrThrow({ where: { id: listingId } });
    expect(local.priceCents).toBe(2500);
    const edit = await db.listingEdit.findFirstOrThrow({ where: { listingId } });
    expect(edit).toMatchObject({ status: "success" });
    expect(edit.changes).toEqual([{ field: "price", before: 1000, after: 2500 }]);
  });

  it("refuses to overwrite when the listing changed in the marketplace meanwhile", async () => {
    const sim = setup({ listing: marketplaceListing(), description: null });
    const result = await saveEdit(
      ctx(),
      listingId,
      { versionStamp: "2026-10-01T00:00:00.000Z", priceCents: 9999 },
      { key, connectorFor: () => sim.connector },
    );
    expect(result).toEqual({ status: "conflict" });
    expect(sim.updates).toEqual([]);
  });

  it("closing needs the delete permission", async () => {
    const sim = setup({ listing: marketplaceListing(), description: null });
    const result = await saveEdit(
      ctx(false),
      listingId,
      { versionStamp: STAMP, status: "closed" },
      { key, connectorFor: () => sim.connector },
    );
    expect(result).toEqual({ status: "forbidden" });
    expect(sim.updates).toEqual([]);
  });

  it("nothing changed -> no call; required attribute emptied -> field error", async () => {
    const sim = setup({ listing: marketplaceListing(), description: "Texto" });
    const deps = { key, connectorFor: () => sim.connector };
    expect(
      await saveEdit(ctx(), listingId, { versionStamp: STAMP, description: "Texto" }, deps),
    ).toEqual({ status: "no_changes" });
    expect(
      await saveEdit(
        ctx(),
        listingId,
        { versionStamp: STAMP, attributes: { BRAND: { value: "" } } },
        deps,
      ),
    ).toEqual({ status: "invalid", fieldErrors: { "attr.BRAND": "Obrigatório." } });
    expect(sim.updates).toEqual([]);
  });

  it("a refusal from the marketplace is shown and recorded as failed", async () => {
    const sim = setup({ listing: marketplaceListing(), description: null });
    sim.connector.updateListing = async () => {
      throw new MarketplaceValidationError(["The price is below the minimum"]);
    };
    const result = await saveEdit(
      ctx(),
      listingId,
      { versionStamp: STAMP, priceCents: 1 },
      { key, connectorFor: () => sim.connector },
    );
    expect(result).toEqual({ status: "refused", causes: ["The price is below the minimum"] });
    const edit = await db.listingEdit.findFirstOrThrow({ where: { listingId } });
    expect(edit).toMatchObject({ status: "failed", message: "The price is below the minimum" });
  });

  it("a general marketplace notice is informational: the edit is a success", async () => {
    // Real notices seen on the test account: shipping setup, unrelated to the edit.
    const sim = setup({ listing: marketplaceListing(), description: null });
    const applyPrice = sim.connector.updateListing;
    sim.connector.updateListing = async (token, id, patch) => {
      await applyPrice(token, id, patch);
      return { warnings: ["A conta não tem o Mercado Envios 1 (ME1) ativado."] };
    };
    const result = await saveEdit(
      ctx(),
      listingId,
      { versionStamp: STAMP, priceCents: 3000, description: "Nova descrição" },
      { key, connectorFor: () => sim.connector },
    );
    expect(result).toMatchObject({
      status: "saved",
      notApplied: [],
      notices: ["A conta não tem o Mercado Envios 1 (ME1) ativado."],
    });
    expect(sim.descriptions).toEqual(["Nova descrição"]);
    expect((await db.listingEdit.findFirstOrThrow({ where: { listingId } })).status).toBe(
      "success",
    );
  });

  it("a price the marketplace silently kept is reported as not applied (partial)", async () => {
    const sim = setup({ listing: marketplaceListing(), description: null });
    sim.connector.updateListing = async () => ({ warnings: [] }); // 200 OK, price unchanged
    const result = await saveEdit(
      ctx(),
      listingId,
      { versionStamp: STAMP, priceCents: 3000 },
      { key, connectorFor: () => sim.connector },
    );
    expect(result).toMatchObject({ status: "saved", notApplied: [expect.stringMatching(/preço/)] });
    expect((await db.listingEdit.findFirstOrThrow({ where: { listingId } })).status).toBe(
      "partial",
    );
  });

  it("another organization can't load or edit the listing", async () => {
    const sim = setup({ listing: marketplaceListing(), description: null });
    const foreign = {
      tdb: tenantDb(randomUUID()),
      organizationId: randomUUID(),
      userId: null,
      canClose: true,
    };
    const deps = { key, connectorFor: () => sim.connector };
    expect((await loadForEdit(foreign, listingId, deps)).status).toBe("not_found");
    expect(
      (await saveEdit(foreign, listingId, { versionStamp: STAMP, priceCents: 1 }, deps)).status,
    ).toBe("not_found");
  });
});
