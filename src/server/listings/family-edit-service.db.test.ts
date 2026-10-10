import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { EditableListing, ListingForCopy, MarketplaceListing } from "@/connectors/types";
import { emptyListing, emptyVariant } from "@/domain/listings/canonical";
import { db } from "@/server/db";
import { loadFamilyForEdit, publishNewVariants } from "@/server/listings/family-edit-service";
import { encryptTokens } from "@/server/marketplaces/token-service";
import { tenantDb } from "@/server/tenant/tenant-db";
import { fakeConnector } from "@/test/fake-connector";

// Real database (`npm run test:db`) in a TEMPORARY organization deleted at the end.
// Mercado Livre is simulated.

const key = randomBytes(32);
const FAMILY = `fam${Date.now()}`;
const CATEGORY = `MLBFAM${Date.now()}`;
let organizationId: string;
let accountId: string;
const ids: Record<string, string> = {};
const ctx = () => ({ tdb: tenantDb(organizationId), organizationId, userId: null });

function marketListing(externalId: string, familyId: string | null): MarketplaceListing {
  return {
    externalId,
    title: `Pote ${externalId}`,
    status: "active",
    subStatus: [],
    priceCents: 2990,
    currency: "BRL",
    availableQuantity: 1,
    soldQuantity: 0,
    permalink: null,
    thumbnailUrl: null,
    categoryId: CATEGORY,
    listingTypeId: "gold_special",
    condition: "new",
    listingModel: "user_products",
    userProductId: null,
    familyId,
    familyName: "Pote Hermético",
    sellerSku: null,
    logisticType: null,
    externalUpdatedAt: new Date("2026-10-10T10:00:00Z"),
    variations: [],
    raw: {},
  };
}

const source: ListingForCopy = {
  listing: {
    ...emptyListing(),
    familyName: "Pote Hermético",
    title: "Pote Hermético",
    categoryId: CATEGORY,
    priceCents: 2990,
    pictures: [{ id: "OLD", url: null }],
    attributes: [
      { id: "BRAND", valueId: null, valueName: "Marca X" },
      { id: "COLOR", valueId: null, valueName: "Azul" },
    ],
  },
  sellerId: "1",
  listingModel: "user_products",
  hasVariations: false,
  variations: [],
  familyId: FAMILY,
  permalink: null,
  title: "Pote Hermético",
};

const publish = vi.fn(async () => marketListing(`MLB${Date.now()}9`, FAMILY));
const connector = fakeConnector({
  getFamily: async () => ({
    familyId: FAMILY,
    familyName: "Pote Hermético",
    childAttributeIds: ["COLOR"],
    parentAttributeIds: ["BRAND"],
  }),
  getListingForEdit: async (_token, externalId): Promise<EditableListing> => ({
    listing: marketListing(externalId, externalId === "MLB8000003" ? null : FAMILY),
    attributes: [],
    description: null,
    rules: { titleEditable: false, familyNameEditable: false, titleLockReason: null },
  }),
  getCategoryAttributes: async () => [],
  getListingForCopy: async () => source,
  publishListing: publish,
  updateListingDescription: async () => undefined,
});
const deps = { key, connectorFor: () => connector };

beforeAll(async () => {
  organizationId = (await db.organization.create({ data: { name: "[teste] família" } })).id;
  accountId = (
    await db.marketplaceAccount.create({
      data: {
        organizationId,
        marketplace: "mercadolivre",
        externalUserId: `test-${randomUUID()}`,
        nickname: "TESTE",
        allowWrites: true,
        listingModel: "user_products",
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
  for (const [externalId, familyId] of [
    ["MLB8000001", FAMILY],
    ["MLB8000002", FAMILY],
    ["MLB8000003", null],
  ] as const) {
    const listing = await db.listing.create({
      data: {
        organizationId,
        marketplaceAccountId: accountId,
        marketplace: "mercadolivre",
        externalId,
        title: externalId,
        status: "active",
        listingModel: "user_products",
        familyId,
        raw: {},
        syncedAt: new Date(),
      },
    });
    ids[externalId] = listing.id;
  }
});

afterAll(async () => {
  await db.skuListingMapping.deleteMany({ where: { organizationId } });
  await db.listingDraft.deleteMany({ where: { organizationId } });
  await db.listing.deleteMany({ where: { organizationId } });
  await db.sku.deleteMany({ where: { organizationId } });
  await db.product.deleteMany({ where: { organizationId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

describe("family edit", () => {
  it("loads every member of the family, fresh; a lone listing is edited alone", async () => {
    const result = await loadFamilyForEdit(ctx(), ids.MLB8000001!, deps);
    if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
    expect(result.members.map((member) => member.externalId)).toEqual(["MLB8000001", "MLB8000002"]);
    expect(result.varyingIds).toEqual(["COLOR"]);
    expect(result.familyName).toBe("Pote Hermético");
    expect(result.members[0]?.versionStamp).toBe("2026-10-10T10:00:00.000Z");

    expect(await loadFamilyForEdit(ctx(), ids.MLB8000003!, deps)).toEqual({ status: "single" });
  });

  it("publishes a new variant into the family, creates its SKU and drops the helper draft", async () => {
    const variant = {
      ...emptyVariant("verde"),
      attributes: [{ id: "COLOR", valueId: null, valueName: "Verde" }],
      priceCents: 3990,
      pictures: [{ id: "P1", url: null }],
      gtin: "7891234567895",
      skuCode: "FAM-VERDE",
    };
    const result = await publishNewVariants(
      ctx(),
      ids.MLB8000001!,
      [variant],
      {
        canCreateSkus: true,
      },
      deps,
    );
    expect(result).toMatchObject({ status: "published", family: "same" });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(await db.listingDraft.count({ where: { organizationId } })).toBe(0);

    const sku = await db.sku.findFirst({ where: { organizationId, code: "FAM-VERDE" } });
    expect(sku).not.toBeNull();
    expect(await db.skuListingMapping.count({ where: { organizationId, skuId: sku!.id } })).toBe(1);
  });
});
