import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { deleteProducts } from "@/server/products/delete-service";
import { tenantDb } from "@/server/tenant/tenant-db";

// Real database (`npm run test:db`) in a TEMPORARY organization deleted at the end.

let organizationId: string;
let accountId: string;
const tdb = () => tenantDb(organizationId);

async function product(code: string) {
  const created = await db.product.create({
    data: { organizationId, name: `Produto ${code}` },
    select: { id: true },
  });
  const sku = await db.sku.create({
    data: { organizationId, productId: created.id, code },
    select: { id: true },
  });
  return { productId: created.id, skuId: sku.id };
}

beforeAll(async () => {
  organizationId = (await db.organization.create({ data: { name: "[teste] excluir produtos" } }))
    .id;
  accountId = (
    await db.marketplaceAccount.create({
      data: {
        organizationId,
        marketplace: "mercadolivre",
        externalUserId: `del-${organizationId}`,
        nickname: "TESTE",
        status: "active",
      },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await db.stockMovement.deleteMany({ where: { organizationId } });
  await db.skuListingMapping.deleteMany({ where: { organizationId } });
  await db.listing.deleteMany({ where: { organizationId } });
  await db.sku.deleteMany({ where: { organizationId } });
  await db.product.deleteMany({ where: { organizationId } });
  await db.marketplaceAccount.deleteMany({ where: { organizationId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
});

describe("deleteProducts", () => {
  it("deletes a product without history and unlinks its listing", async () => {
    const { productId, skuId } = await product("DEL-1");
    const listing = await db.listing.create({
      data: {
        organizationId,
        marketplaceAccountId: accountId,
        marketplace: "mercadolivre",
        externalId: "MLB900000001",
        title: "Anúncio",
        status: "active",
        raw: {},
        syncedAt: new Date(),
      },
      select: { id: true },
    });
    await db.skuListingMapping.create({
      data: { organizationId, skuId, listingId: listing.id },
    });

    const result = await deleteProducts(tdb(), [productId]);

    expect(result).toEqual({ deleted: 1, archived: 0, unlinkedListings: 1, failed: 0 });
    expect(await db.product.count({ where: { id: productId } })).toBe(0);
    expect(await db.sku.count({ where: { id: skuId } })).toBe(0);
    expect(await db.listing.count({ where: { id: listing.id } })).toBe(1);
  });

  it("archives a product with stock movements instead of deleting", async () => {
    const { productId, skuId } = await product("DEL-2");
    await db.stockMovement.create({
      data: { organizationId, skuId, type: "manual_in", quantity: 5, balanceAfter: 5 },
    });

    const result = await deleteProducts(tdb(), [productId]);

    expect(result).toEqual({ deleted: 0, archived: 1, unlinkedListings: 0, failed: 0 });
    const kept = await db.product.findUnique({ where: { id: productId } });
    expect(kept?.archivedAt).not.toBeNull();
  });

  it("ignores products of another organization", async () => {
    const other = await db.organization.create({ data: { name: "[teste] outra" } });
    const foreign = await db.product.create({
      data: { organizationId: other.id, name: "Alheio" },
      select: { id: true },
    });
    try {
      const result = await deleteProducts(tdb(), [foreign.id]);
      expect(result.deleted + result.archived).toBe(0);
      expect(await db.product.count({ where: { id: foreign.id } })).toBe(1);
    } finally {
      await db.product.deleteMany({ where: { organizationId: other.id } });
      await db.organization.deleteMany({ where: { id: other.id } });
    }
  });
});
