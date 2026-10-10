import "server-only";

import type { TenantDb } from "@/server/tenant/tenant-db";

/**
 * "Excluir só do sistema": hides listings from the ERP. They stay on the
 * marketplace as they are; imports keep them hidden (removedAt is never cleared
 * by a sync). The SKU links go away, so the ERP stops sending stock to them.
 * Old orders keep pointing to the listing.
 */
export async function removeListingsFromSystem(
  tdb: TenantDb,
  listingIds: string[],
): Promise<number> {
  const ids = [...new Set(listingIds)];
  if (ids.length === 0) return 0;
  return tdb.$transaction(async (tx) => {
    const removed = await tx.listing.updateMany({
      where: { id: { in: ids }, removedAt: null },
      data: { removedAt: new Date() },
    });
    await tx.skuListingMapping.deleteMany({ where: { listingId: { in: ids } } });
    await tx.stockPush.deleteMany({ where: { listingId: { in: ids }, status: "pending" } });
    return removed.count;
  });
}
