import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { listListings } from "@/server/listings/queries";
import { removeListingsFromSystem } from "@/server/listings/remove-service";
import { tenantDb } from "@/server/tenant/tenant-db";

// Real database (`npm run test:db`) in a TEMPORARY organization deleted at the end.

let organizationId: string;
let accountId: string;
const tdb = () => tenantDb(organizationId);

beforeAll(async () => {
  organizationId = (await db.organization.create({ data: { name: "[teste] remover anúncios" } }))
    .id;
  accountId = (
    await db.marketplaceAccount.create({
      data: {
        organizationId,
        marketplace: "mercadolivre",
        externalUserId: `rm-${organizationId}`,
        nickname: "TESTE",
        status: "active",
      },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await db.skuListingMapping.deleteMany({ where: { organizationId } });
  await db.listing.deleteMany({ where: { organizationId } });
  await db.sku.deleteMany({ where: { organizationId } });
  await db.product.deleteMany({ where: { organizationId } });
  await db.marketplaceAccount.deleteMany({ where: { organizationId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
});

describe("removeListingsFromSystem", () => {
  it("hides the listing, drops the SKU link and keeps the row", async () => {
    const product = await db.product.create({
      data: { organizationId, name: "Pote" },
      select: { id: true },
    });
    const sku = await db.sku.create({
      data: { organizationId, productId: product.id, code: "RM-1" },
      select: { id: true },
    });
    const listing = await db.listing.create({
      data: {
        organizationId,
        marketplaceAccountId: accountId,
        marketplace: "mercadolivre",
        externalId: "MLB900000101",
        title: "Pote removido",
        status: "active",
        raw: {},
        syncedAt: new Date(),
      },
      select: { id: true },
    });
    await db.skuListingMapping.create({
      data: { organizationId, skuId: sku.id, listingId: listing.id },
    });

    expect((await listListings(tdb(), {})).total).toBe(1);
    expect(await removeListingsFromSystem(tdb(), [listing.id])).toBe(1);

    expect((await listListings(tdb(), {})).total).toBe(0);
    expect(await db.skuListingMapping.count({ where: { listingId: listing.id } })).toBe(0);
    const kept = await db.listing.findUnique({ where: { id: listing.id } });
    expect(kept?.removedAt).not.toBeNull();
    // Removing again changes nothing.
    expect(await removeListingsFromSystem(tdb(), [listing.id])).toBe(0);
  });
});
