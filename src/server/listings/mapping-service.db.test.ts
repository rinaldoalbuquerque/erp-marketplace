import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { autoMatch, linkSku, unlinkMappings } from "@/server/listings/mapping-service";
import { tenantDb } from "@/server/tenant/tenant-db";

// Real database (`npm run test:db`) in a TEMPORARY organization deleted at the end.

let organizationId: string;
let accountId: string;
let skuA: string;
let skuB: string;
const userId: string | null = null;
const tdb = () => tenantDb(organizationId);

async function createListing(
  externalId: string,
  sellerSku: string | null,
  variations: Array<string | null> = [],
) {
  const listing = await db.listing.create({
    data: {
      organizationId,
      marketplaceAccountId: accountId,
      marketplace: "mercadolivre",
      externalId,
      title: `Anúncio ${externalId}`,
      status: "active",
      sellerSku,
      raw: {},
      syncedAt: new Date(),
    },
  });
  for (const [index, sku] of variations.entries()) {
    await db.listingVariation.create({
      data: {
        organizationId,
        listingId: listing.id,
        externalId: `${externalId}-V${index}`,
        attributes: [{ name: "Cor", value: String(index) }],
        sellerSku: sku,
      },
    });
  }
  return db.listing.findUniqueOrThrow({ where: { id: listing.id }, include: { variations: true } });
}

beforeAll(async () => {
  organizationId = (await db.organization.create({ data: { name: "[teste] mapeamento" } })).id;
  accountId = (
    await db.marketplaceAccount.create({
      data: {
        organizationId,
        marketplace: "mercadolivre",
        externalUserId: `test-${randomUUID()}`,
        nickname: "TESTE",
      },
    })
  ).id;
  const product = await db.product.create({ data: { organizationId, name: "Produto teste" } });
  skuA = (await db.sku.create({ data: { organizationId, productId: product.id, code: "AAA-1" } }))
    .id;
  skuB = (await db.sku.create({ data: { organizationId, productId: product.id, code: "BBB-2" } }))
    .id;
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

beforeEach(async () => {
  await db.listing.deleteMany({ where: { organizationId } });
});

describe("SKU mapping against the database", () => {
  it("links by SKU code and re-linking replaces (never two SKUs on one listing)", async () => {
    const listing = await createListing("MLB1", null);
    const input = { listingId: listing.id, variationId: null };
    expect(await linkSku(tdb(), organizationId, userId, { ...input, skuCode: "aaa-1 " })).toEqual({
      status: "linked",
      skuCode: "AAA-1",
    });
    await linkSku(tdb(), organizationId, userId, { ...input, skuCode: "BBB-2" });

    const mappings = await db.skuListingMapping.findMany({ where: { listingId: listing.id } });
    expect(mappings).toHaveLength(1);
    expect(mappings[0]?.skuId).toBe(skuB);
  });

  it("a listing with variations must be linked per variation", async () => {
    const listing = await createListing("MLB2", null, ["X", "Y"]);
    expect(
      await linkSku(tdb(), organizationId, userId, {
        listingId: listing.id,
        variationId: null,
        skuCode: "AAA-1",
      }),
    ).toEqual({ status: "variation_required" });

    const [first, second] = listing.variations;
    for (const variation of [first, second]) {
      await linkSku(tdb(), organizationId, userId, {
        listingId: listing.id,
        variationId: variation?.id ?? null,
        skuCode: "AAA-1",
      });
    }
    expect(await db.skuListingMapping.count({ where: { listingId: listing.id } })).toBe(2);
  });

  it("unknown SKU code and foreign variation are refused", async () => {
    const listing = await createListing("MLB3", null);
    const other = await createListing("MLB4", null, ["Z"]);
    expect(
      await linkSku(tdb(), organizationId, userId, {
        listingId: listing.id,
        variationId: null,
        skuCode: "NAO-EXISTE",
      }),
    ).toEqual({ status: "sku_not_found" });
    expect(
      await linkSku(tdb(), organizationId, userId, {
        listingId: listing.id,
        variationId: other.variations[0]?.id ?? null,
        skuCode: "AAA-1",
      }),
    ).toEqual({ status: "target_not_found" });
  });

  it("auto-match links identical codes only and never touches existing links", async () => {
    const exact = await createListing("MLB10", "aaa-1");
    const manual = await createListing("MLB11", "AAA-1");
    const noMatch = await createListing("MLB12", "AAA");
    const variations = await createListing("MLB13", "BBB-2", ["BBB-2", null]);
    // Manual link to another SKU must survive auto-match.
    await linkSku(tdb(), organizationId, userId, {
      listingId: manual.id,
      variationId: null,
      skuCode: "BBB-2",
    });

    const linked = await autoMatch(tdb(), organizationId, userId);

    expect(linked.map((item) => item.externalId).sort()).toEqual(["MLB10", "MLB13"]);
    const byListing = async (id: string) =>
      db.skuListingMapping.findMany({ where: { listingId: id } });
    expect((await byListing(exact.id))[0]?.skuId).toBe(skuA);
    expect((await byListing(manual.id))[0]?.skuId).toBe(skuB); // unchanged
    expect(await byListing(noMatch.id)).toHaveLength(0);
    // Only the variation with its own SKU got linked.
    const variationLinks = await byListing(variations.id);
    expect(variationLinks).toHaveLength(1);
    // (Find it by SKU: the database doesn't guarantee the variations' order.)
    const withSku = variations.variations.find((variation) => variation.sellerSku === "BBB-2");
    expect(variationLinks[0]?.listingVariationId).toBe(withSku?.id);

    // Running again links nothing new.
    expect(await autoMatch(tdb(), organizationId, userId)).toEqual([]);

    // Undo removes exactly what auto-match created.
    expect(
      await unlinkMappings(
        tdb(),
        linked.map((item) => item.mappingId),
      ),
    ).toBe(2);
    expect((await byListing(manual.id))[0]?.skuId).toBe(skuB);
  });

  it("another organization can't link or unlink", async () => {
    const listing = await createListing("MLB20", null);
    const foreign = tenantDb(randomUUID());
    expect(
      await linkSku(foreign, randomUUID(), userId, {
        listingId: listing.id,
        variationId: null,
        skuCode: "AAA-1",
      }),
    ).toEqual({ status: "target_not_found" });

    await linkSku(tdb(), organizationId, userId, {
      listingId: listing.id,
      variationId: null,
      skuCode: "AAA-1",
    });
    const mapping = await db.skuListingMapping.findFirstOrThrow({
      where: { listingId: listing.id },
    });
    expect(await unlinkMappings(foreign, [mapping.id])).toBe(0);
    expect(await db.skuListingMapping.count({ where: { id: mapping.id } })).toBe(1);
  });
});
