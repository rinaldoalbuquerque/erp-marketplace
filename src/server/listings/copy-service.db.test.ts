import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MarketplaceValidationError, type ListingForCopy } from "@/connectors/types";
import { emptyListing } from "@/domain/listings/canonical";
import { db } from "@/server/db";
import { copyToDraft } from "@/server/listings/copy-service";
import { loadDraft } from "@/server/listings/draft-service";
import { encryptTokens } from "@/server/marketplaces/token-service";
import { tenantDb } from "@/server/tenant/tenant-db";
import { fakeConnector } from "@/test/fake-connector";

// Real database (`npm run test:db`) in a TEMPORARY organization deleted at the end.
// Mercado Livre is simulated.

const key = randomBytes(32);
const CATEGORY = `MLBCOPY${Date.now()}`;
let organizationId: string;
let sourceAccountId: string;
let targetAccountId: string;
let skuId: string;
const OWN_ID = `MLB${Date.now()}1`;

const ctx = () => ({ tdb: tenantDb(organizationId), organizationId, userId: null });

const tokens = () =>
  encryptTokens(
    {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
      scopes: null,
      externalUserId: "1",
    },
    key,
  );

function source(overrides: Partial<ListingForCopy> = {}): ListingForCopy {
  return {
    listing: {
      ...emptyListing(),
      familyName: "Pote Hermético 370ml",
      title: "Pote Hermético 370ml",
      description: "Pote de vidro.",
      categoryId: CATEGORY,
      priceCents: 2990,
      availableQuantity: 50,
      pictures: [{ id: "111-MLB_01", url: "https://http2.mlstatic.com/D_111-O.jpg" }],
      attributes: [
        { id: "BRAND", valueId: null, valueName: "Marca X" },
        { id: "INTERNAL", valueId: null, valueName: "x" },
      ],
    },
    sellerId: "1",
    listingModel: "user_products",
    hasVariations: false,
    permalink: null,
    title: "Pote Hermético 370ml",
    ...overrides,
  };
}

const connector = (copy = source()) =>
  fakeConnector({
    getListingForCopy: async () => copy,
    getCategoryAttributes: async () => [
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
    ],
  });

beforeAll(async () => {
  organizationId = (await db.organization.create({ data: { name: "[teste] cópia" } })).id;
  const make = async (nickname: string) =>
    (
      await db.marketplaceAccount.create({
        data: {
          organizationId,
          marketplace: "mercadolivre",
          externalUserId: `test-${randomUUID()}`,
          nickname,
          listingModel: "user_products",
          ...tokens(),
        },
      })
    ).id;
  sourceAccountId = await make("ORIGEM");
  targetAccountId = await make("DESTINO");
  const productId = (await db.product.create({ data: { organizationId, name: "Pote" } })).id;
  skuId = (
    await db.sku.create({
      data: {
        organizationId,
        productId,
        code: `TESTE-${randomUUID().slice(0, 8)}`,
        stockOnHand: 7,
      },
    })
  ).id;
  const listing = await db.listing.create({
    data: {
      organizationId,
      marketplaceAccountId: sourceAccountId,
      marketplace: "mercadolivre",
      externalId: OWN_ID,
      title: "Pote",
      status: "active",
      raw: {},
      syncedAt: new Date(),
    },
  });
  await db.skuListingMapping.create({ data: { organizationId, skuId, listingId: listing.id } });
});

afterAll(async () => {
  await db.marketplaceCategory.deleteMany({ where: { categoryId: CATEGORY } });
  await db.listingDraft.deleteMany({ where: { organizationId } });
  await db.syncJob.deleteMany({ where: { organizationId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

describe("copy listings against the database", () => {
  it("own listing to another account: SKU inherited, pictures by URL, price adjusted", async () => {
    const result = await copyToDraft(
      ctx(),
      {
        sourceExternalId: OWN_ID,
        targetAccountId,
        options: { price: { percent: 10, roundTo90: true }, listingTypeId: "gold_pro" },
      },
      { key, connectorFor: () => connector() },
    );
    expect(result.status).toBe("created");
    const draft = await loadDraft(ctx().tdb, result.status === "created" ? result.draftId : "");
    expect(draft?.sku?.id).toBe(skuId);
    expect(draft?.listing).toMatchObject({
      priceCents: 3290,
      listingTypeId: "gold_pro",
      availableQuantity: 7, // ERP stock of the inherited SKU
      pictures: [{ id: null, url: "https://http2.mlstatic.com/D_111-O.jpg" }],
      attributes: [{ id: "BRAND", valueName: "Marca X" }], // INTERNAL not accepted by the category
    });
    const row = await db.listingDraft.findUniqueOrThrow({
      where: { id: result.status === "created" ? result.draftId : "" },
    });
    expect(row).toMatchObject({ sourceKind: "own", sourceExternalId: OWN_ID, sourceAccountId });
  });

  it("same account keeps picture ids", async () => {
    const result = await copyToDraft(
      ctx(),
      { sourceExternalId: OWN_ID, targetAccountId: sourceAccountId },
      { key, connectorFor: () => connector() },
    );
    const draft = await loadDraft(ctx().tdb, result.status === "created" ? result.draftId : "");
    expect(draft?.listing.pictures[0]?.id).toBe("111-MLB_01");
  });

  it("another seller's listing: external, no SKU", async () => {
    const result = await copyToDraft(
      ctx(),
      { sourceExternalId: "MLB999999999", targetAccountId },
      { key, connectorFor: () => connector() },
    );
    const row = await db.listingDraft.findUniqueOrThrow({
      where: { id: result.status === "created" ? result.draftId : "" },
    });
    expect(row).toMatchObject({ sourceKind: "external", skuId: null, sourceAccountId: null });
  });

  it("a batch never copies the same source twice", async () => {
    const job = await db.syncJob.create({
      data: { organizationId, marketplaceAccountId: targetAccountId, type: "replicate_listings" },
    });
    const run = () =>
      copyToDraft(
        ctx(),
        { sourceExternalId: OWN_ID, targetAccountId, batchJobId: job.id },
        { key, connectorFor: () => connector() },
      );
    expect((await run()).status).toBe("created");
    expect((await run()).status).toBe("duplicate");
  });

  it("listings with variations and missing listings are reported, not copied", async () => {
    expect(
      await copyToDraft(
        ctx(),
        { sourceExternalId: OWN_ID, targetAccountId },
        { key, connectorFor: () => connector(source({ hasVariations: true })) },
      ),
    ).toEqual({ status: "has_variations" });
    const missing = fakeConnector({
      getListingForCopy: async () => {
        throw new MarketplaceValidationError(["Item not found"]);
      },
    });
    expect(
      await copyToDraft(
        ctx(),
        { sourceExternalId: "MLB1234567", targetAccountId },
        { key, connectorFor: () => missing },
      ),
    ).toEqual({ status: "not_found" });
  });

  it("a catalog product id copies one of its listings", async () => {
    const reads: string[] = [];
    const catalog = fakeConnector({
      getListingForCopy: async (_token, id) => {
        reads.push(id);
        if (id === "MLB39565808") throw new MarketplaceValidationError(["Item not found"]);
        return source();
      },
      resolveCatalogProduct: async () => "MLB5429219232",
    });
    const result = await copyToDraft(
      ctx(),
      { sourceExternalId: "MLB39565808", targetAccountId },
      { key, connectorFor: () => catalog },
    );
    expect(result).toMatchObject({
      status: "created",
      catalogProductId: "MLB39565808",
      copiedExternalId: "MLB5429219232",
    });
    expect(reads).toEqual(["MLB39565808", "MLB5429219232"]);
    const row = await db.listingDraft.findUniqueOrThrow({
      where: { id: result.status === "created" ? result.draftId : "" },
    });
    expect(row.sourceExternalId).toBe("MLB5429219232");
  });
});
