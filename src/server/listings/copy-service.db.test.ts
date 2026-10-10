import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MarketplaceValidationError, type ListingForCopy } from "@/connectors/types";
import { emptyListing } from "@/domain/listings/canonical";
import { db } from "@/server/db";
import { copyToDraft, createVariationDraft } from "@/server/listings/copy-service";
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
    variations: [],
    familyId: null,
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

  it("a traditional listing with variations becomes one draft with its variants (SKU per variant)", async () => {
    const variation = (id: string, color: string, sku: string) => ({
      externalId: id,
      attributes: [{ id: "COLOR", valueId: null, valueName: color }],
      priceCents: 3990,
      availableQuantity: 2,
      pictures: [{ id: `PIC-${id}`, url: `https://http2.mlstatic.com/${id}.jpg` }],
      sellerSku: sku,
    });
    const withVariations = source({
      hasVariations: true,
      variations: [variation("V1", "Azul", "POTE-AZ"), variation("V2", "Verde", "POTE-VD")],
    });
    // Link variation V1 of the own listing to the SKU.
    const listing = await db.listing.findFirstOrThrow({
      where: { organizationId, externalId: OWN_ID },
    });
    const localVariation = await db.listingVariation.create({
      data: { organizationId, listingId: listing.id, externalId: "V1", attributes: [] },
    });
    await db.skuListingMapping.create({
      data: {
        organizationId,
        skuId,
        listingId: listing.id,
        listingVariationId: localVariation.id,
        variationKey: localVariation.id,
      },
    });
    const accepting = fakeConnector({
      getListingForCopy: async () => withVariations,
      getCategoryAttributes: async () => [],
    });
    const result = await copyToDraft(
      ctx(),
      { sourceExternalId: OWN_ID, targetAccountId },
      { key, connectorFor: () => accepting },
    );
    expect(result).toMatchObject({ status: "created", variants: 2 });
    const draft = await db.listingDraft.findUniqueOrThrow({
      where: { id: result.status === "created" ? result.draftId : "" },
    });
    const content = draft.content as {
      familyName: string;
      variationAttributeIds: string[];
      variants: Array<{
        key: string;
        skuId: string | null;
        priceCents: number;
        pictures: unknown[];
        sellerSku: string;
      }>;
    };
    expect(content.familyName).toBe("Pote Hermético 370ml");
    expect(content.variationAttributeIds).toEqual(["COLOR"]);
    expect(content.variants.map((variant) => variant.key)).toEqual(["V1", "V2"]);
    expect(content.variants[0]).toMatchObject({
      skuId, // V1 linked to the SKU
      priceCents: 3990,
      sellerSku: "POTE-AZ",
      pictures: [{ id: null, url: "https://http2.mlstatic.com/V1.jpg" }],
    });
    expect(content.variants[1]?.skuId).toBeNull();
  });

  it("missing listings are reported, not copied", async () => {
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
      // Another seller's listing: ML no longer tells "missing" from "forbidden".
    ).toEqual({ status: "not_readable" });
  });

  it("another seller's listing is unreadable; a catalog product id is copied from the catalog", async () => {
    const forbidden = () => {
      throw new MarketplaceValidationError(["Access to the requested resource is forbidden"]);
    };
    const catalog = fakeConnector({
      getListingForCopy: async () => forbidden(),
      getCatalogProductForCopy: async (_token, id) =>
        id === "MLB39565808" ? source({ sellerId: null }) : null,
    });
    const deps = { key, connectorFor: () => catalog };
    expect(
      await copyToDraft(ctx(), { sourceExternalId: "MLB5354765828", targetAccountId }, deps),
    ).toEqual({ status: "not_readable" });
    const result = await copyToDraft(
      ctx(),
      { sourceExternalId: "MLB39565808", targetAccountId },
      deps,
    );
    expect(result).toMatchObject({ status: "created", catalogProductId: "MLB39565808" });
    const row = await db.listingDraft.findUniqueOrThrow({
      where: { id: result.status === "created" ? result.draftId : "" },
    });
    expect(row).toMatchObject({ sourceKind: "external", sourceExternalId: "MLB39565808" });
  });

  it("new variation: same family, varying attributes and per-listing data left empty", async () => {
    const up = await db.listing.create({
      data: {
        organizationId,
        marketplaceAccountId: sourceAccountId,
        marketplace: "mercadolivre",
        externalId: `MLB${Date.now()}7`,
        title: "Pote Azul",
        status: "active",
        listingModel: "user_products",
        familyId: "555",
        raw: {},
        syncedAt: new Date(),
      },
    });
    const upConnector = fakeConnector({
      getListingForCopy: async () =>
        source({
          familyId: "555",
          listing: {
            ...source().listing,
            attributes: [
              { id: "BRAND", valueId: null, valueName: "Marca X" },
              { id: "COLOR", valueId: null, valueName: "Azul" },
              { id: "GTIN", valueId: null, valueName: "7891234567895" },
            ],
          },
        }),
      getFamily: async () => ({
        familyId: "555",
        familyName: "Pote Hermético",
        childAttributeIds: ["COLOR"],
        parentAttributeIds: ["BRAND"],
      }),
      getCategoryAttributes: async () => [],
    });
    const result = await createVariationDraft(ctx(), up.id, {
      key,
      connectorFor: () => upConnector,
    });
    expect(result).toMatchObject({ status: "created", family: { childAttributeIds: ["COLOR"] } });
    const draft = await db.listingDraft.findUniqueOrThrow({
      where: { id: result.status === "created" ? result.draftId : "" },
    });
    expect(draft.targetFamilyId).toBe("555");
    expect(draft.content).toMatchObject({
      familyName: "Pote Hermético",
      pictures: [],
      attributes: [{ id: "BRAND", valueName: "Marca X" }], // COLOR and GTIN left for the user
    });
  });

  it("new variation only for User Products listings", async () => {
    const traditional = await db.listing.create({
      data: {
        organizationId,
        marketplaceAccountId: sourceAccountId,
        marketplace: "mercadolivre",
        externalId: `MLB${Date.now()}8`,
        title: "Tradicional",
        status: "active",
        listingModel: "traditional",
        raw: {},
        syncedAt: new Date(),
      },
    });
    expect(await createVariationDraft(ctx(), traditional.id, { key })).toEqual({
      status: "not_user_products",
    });
  });

  it("a User Products family is copied as one draft (siblings = variants), once per batch", async () => {
    const stamp = Date.now();
    const ids = [`MLB${stamp}21`, `MLB${stamp}22`];
    for (const externalId of ids) {
      await db.listing.create({
        data: {
          organizationId,
          marketplaceAccountId: sourceAccountId,
          marketplace: "mercadolivre",
          externalId,
          title: externalId,
          status: "active",
          listingModel: "user_products",
          familyId: "FAM-77",
          raw: {},
          syncedAt: new Date(),
        },
      });
    }
    const colorOf: Record<string, string> = { [ids[0]!]: "Azul", [ids[1]!]: "Verde" };
    const familyConnector = fakeConnector({
      getListingForCopy: async (_token, externalId) =>
        source({
          familyId: "FAM-77",
          title: `Pote ${colorOf[externalId]}`,
          listing: {
            ...source().listing,
            priceCents: externalId === ids[0] ? 2990 : 3190,
            attributes: [
              { id: "BRAND", valueId: null, valueName: "Marca X" },
              { id: "COLOR", valueId: null, valueName: colorOf[externalId]! },
              { id: "GTIN", valueId: null, valueName: `GTIN-${colorOf[externalId]}` },
            ],
          },
        }),
      getFamily: async () => ({
        familyId: "FAM-77",
        familyName: "Pote Hermético",
        childAttributeIds: ["COLOR"],
        parentAttributeIds: ["BRAND"],
      }),
      getCategoryAttributes: async () => [],
    });
    const job = await db.syncJob.create({
      data: { organizationId, marketplaceAccountId: targetAccountId, type: "replicate_listings" },
    });
    const deps = { key, connectorFor: () => familyConnector };
    const first = await copyToDraft(
      ctx(),
      { sourceExternalId: ids[0]!, targetAccountId, batchJobId: job.id },
      deps,
    );
    expect(first).toMatchObject({ status: "created", variants: 2 });
    // The sibling of the same family in the same batch: already copied.
    expect(
      await copyToDraft(
        ctx(),
        { sourceExternalId: ids[1]!, targetAccountId, batchJobId: job.id },
        deps,
      ),
    ).toEqual({ status: "duplicate" });

    const draft = await db.listingDraft.findUniqueOrThrow({
      where: { id: first.status === "created" ? first.draftId : "" },
    });
    expect(draft.sourceExternalId).toBe("family:FAM-77");
    expect(draft.content).toMatchObject({
      familyName: "Pote Hermético",
      variationAttributeIds: ["COLOR"],
      attributes: [{ id: "BRAND", valueName: "Marca X" }],
      variants: [
        { attributes: [{ id: "COLOR", valueName: "Azul" }], gtin: "GTIN-Azul", priceCents: 2990 },
        { attributes: [{ id: "COLOR", valueName: "Verde" }], gtin: "GTIN-Verde", priceCents: 3190 },
      ],
    });
  });
});
