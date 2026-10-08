// Automatic SKU linking: a listing (or variation) whose marketplace SKU is
// exactly an ERP SKU code gets linked to that SKU. Comparison ignores case and
// surrounding spaces only (ERP codes are stored uppercase and trimmed).

export type MatchTarget = {
  listingId: string;
  variationId: string | null;
  /** SKU the seller typed in the marketplace. */
  sellerSku: string | null;
};

export type MatchSku = { id: string; code: string };

export type PlannedMatch = { listingId: string; variationId: string | null; skuId: string };

export const normalizeSkuForMatch = (code: string) => code.trim().toUpperCase();

export function planAutoMatches(targets: MatchTarget[], skus: MatchSku[]): PlannedMatch[] {
  const byCode = new Map(skus.map((sku) => [normalizeSkuForMatch(sku.code), sku.id]));
  const planned: PlannedMatch[] = [];
  for (const target of targets) {
    if (!target.sellerSku) continue;
    const skuId = byCode.get(normalizeSkuForMatch(target.sellerSku));
    if (skuId)
      planned.push({ listingId: target.listingId, variationId: target.variationId, skuId });
  }
  return planned;
}
