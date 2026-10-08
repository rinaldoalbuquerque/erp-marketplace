import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { createFromListings, getProductProposal } from "@/server/products/from-listings-service";
import { tenantDb } from "@/server/tenant/tenant-db";

// Real database (`npm run test:db`) in a TEMPORARY organization deleted at the end.

let organizationId: string;
let accountId: string;
const tdb = () => tenantDb(organizationId);
const member = () => ({ organizationId, userId: null, canAdjustStock: true });

async function createListing(
  externalId: string,
  sellerSku: string | null,
  availableQuantity: number,
  extra: {
    familyId?: string;
    familyName?: string;
    attributes?: Array<Record<string, string>>;
  } = {},
) {
  await db.listing.create({
    data: {
      organizationId,
      marketplaceAccountId: accountId,
      marketplace: "mercadolivre",
      externalId,
      title: `Título ${externalId}`,
      status: "active",
      sellerSku,
      availableQuantity,
      familyId: extra.familyId ?? null,
      familyName: extra.familyName ?? null,
      listingModel: extra.familyId ? "user_products" : "traditional",
      raw: { id: externalId, attributes: extra.attributes ?? [] },
      syncedAt: new Date(),
    },
  });
}

beforeAll(async () => {
  organizationId = (await db.organization.create({ data: { name: "[teste] produtos do ML" } })).id;
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
  await createListing("MLB1", "GAR-1L", 4, {
    attributes: [
      { id: "BRAND", name: "Marca", value_name: "Termolar" },
      { id: "GTIN", name: "EAN", value_name: "4006381333931" },
      { id: "SELLER_PACKAGE_WEIGHT", name: "Peso", value_name: "992 g" },
    ],
  });
  await createListing("MLB2", "GAR-1L", 9); // same SKU, another listing
  await createListing("MLB3", "CAM-AZ", 2, {
    familyId: "F1",
    familyName: "Camiseta",
    attributes: [{ id: "COLOR", name: "Cor", value_name: "Azul" }],
  });
  await createListing("MLB4", "CAM-PR", 0, {
    familyId: "F1",
    familyName: "Camiseta",
    attributes: [{ id: "COLOR", name: "Cor", value_name: "Preto" }],
  });
  await createListing("MLB5", null, 1); // no SKU
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

describe("create products from listings against the database", () => {
  it("proposes from the stored listings", async () => {
    const proposal = await getProductProposal(tdb(), organizationId);
    expect(proposal.products.map((product) => product.name).sort()).toEqual([
      "Camiseta",
      "Título MLB1",
    ]);
    expect(proposal.withoutSku.map((item) => item.externalId)).toEqual(["MLB5"]);
  });

  it("creates only the selected codes, adds initial stock and links the listings", async () => {
    const report = await createFromListings(tdb(), member(), {
      codes: ["GAR-1L", "CAM-AZ", "CAM-PR"],
      includeStock: true,
    });
    expect(report).toEqual({
      productsCreated: 2,
      skusCreated: 3,
      skippedExisting: 0,
      stockEntries: 2, // CAM-PR has 0 in the marketplace: no entry
      linked: 4, // MLB1, MLB2 (same SKU), MLB3, MLB4
    });

    const garrafa = await db.sku.findFirstOrThrow({
      where: { organizationId, code: "GAR-1L" },
      include: { product: true },
    });
    expect(garrafa).toMatchObject({
      ean: "4006381333931",
      weightGrams: 992,
      stockOnHand: 9, // highest of 4 and 9, not 13
      product: { name: "Título MLB1", brand: "Termolar" },
    });
    const camiseta = await db.sku.findMany({
      where: { organizationId, code: { in: ["CAM-AZ", "CAM-PR"] } },
      select: { productId: true },
    });
    expect(new Set(camiseta.map((sku) => sku.productId)).size).toBe(1); // one product

    const movement = await db.stockMovement.findFirstOrThrow({ where: { skuId: garrafa.id } });
    expect(movement).toMatchObject({
      type: "manual_in",
      quantity: 9,
      reason: "Estoque inicial importado do Mercado Livre",
    });
  });

  it("running again creates nothing (idempotent)", async () => {
    const report = await createFromListings(tdb(), member(), {
      codes: ["GAR-1L", "CAM-AZ", "CAM-PR"],
      includeStock: true,
    });
    expect(report).toMatchObject({
      productsCreated: 0,
      skusCreated: 0,
      stockEntries: 0,
      linked: 0,
    });
    expect(await db.sku.count({ where: { organizationId } })).toBe(3);
    expect(await db.stockMovement.count({ where: { organizationId } })).toBe(2);
  });

  it("ignores codes that were not proposed (the browser can't inject data)", async () => {
    const report = await createFromListings(tdb(), member(), {
      codes: ["HACK-1"],
      includeStock: true,
    });
    expect(report.skusCreated).toBe(0);
  });
});
