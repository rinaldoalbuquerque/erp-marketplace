import "server-only";

import type { TenantDb } from "@/server/tenant/tenant-db";

export type DeleteProductsResult = {
  /** Removed for good (never had stock movements or sales). */
  deleted: number;
  /** Had history (stock movements or sales): archived instead, so old orders keep their SKU. */
  archived: number;
  /** Listings that were linked to a removed SKU and are now "sem SKU". */
  unlinkedListings: number;
  failed: number;
};

/**
 * Deletes products and their SKUs. A product whose SKUs have history is archived
 * instead (deleting would break orders, invoices and stock reports).
 * Listings linked to a removed SKU stay, only unlinked; drafts lose the SKU.
 */
export async function deleteProducts(
  tdb: TenantDb,
  productIds: string[],
): Promise<DeleteProductsResult> {
  const result: DeleteProductsResult = { deleted: 0, archived: 0, unlinkedListings: 0, failed: 0 };
  for (const productId of [...new Set(productIds)]) {
    try {
      const outcome = await tdb.$transaction(async (tx) => {
        const product = await tx.product.findFirst({
          where: { id: productId },
          select: { id: true, archivedAt: true, skus: { select: { id: true } } },
        });
        if (!product) return null;
        const skuIds = product.skus.map((sku) => sku.id);
        const [movements, sales] = await Promise.all([
          tx.stockMovement.count({ where: { skuId: { in: skuIds } } }),
          tx.orderItem.count({ where: { skuId: { in: skuIds } } }),
        ]);
        if (movements + sales > 0) {
          if (!product.archivedAt) {
            await tx.product.updateMany({
              where: { id: productId },
              data: { archivedAt: new Date() },
            });
          }
          return { kind: "archived" as const, unlinked: 0 };
        }
        const unlinked = await tx.skuListingMapping.deleteMany({
          where: { skuId: { in: skuIds } },
        });
        await tx.listingDraft.updateMany({
          where: { skuId: { in: skuIds } },
          data: { skuId: null },
        });
        await tx.sku.deleteMany({ where: { id: { in: skuIds } } });
        await tx.product.deleteMany({ where: { id: productId } });
        return { kind: "deleted" as const, unlinked: unlinked.count };
      });
      if (!outcome) continue;
      result[outcome.kind] += 1;
      result.unlinkedListings += outcome.unlinked;
    } catch (error) {
      // e.g. a sale arrived for this SKU in the meantime (the database refuses the delete).
      console.error("Product delete failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
      result.failed += 1;
    }
  }
  return result;
}
