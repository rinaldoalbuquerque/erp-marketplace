import { describe, expect, it } from "vitest";

import { planAutoMatches } from "@/domain/listings/auto-match";

const skus = [
  { id: "sku-1", code: "CAM-AZ-M" },
  { id: "sku-2", code: "GAR-1L" },
];

describe("planAutoMatches", () => {
  it("links only identical codes (ignoring case and spaces)", () => {
    const planned = planAutoMatches(
      [
        { listingId: "L1", variationId: null, sellerSku: " gar-1l " },
        { listingId: "L2", variationId: "V1", sellerSku: "CAM-AZ-M" },
        { listingId: "L3", variationId: null, sellerSku: "CAM-AZ" }, // prefix: not a match
        { listingId: "L4", variationId: null, sellerSku: "CAM AZ M" }, // different code
        { listingId: "L5", variationId: null, sellerSku: null },
      ],
      skus,
    );
    expect(planned).toEqual([
      { listingId: "L1", variationId: null, skuId: "sku-2" },
      { listingId: "L2", variationId: "V1", skuId: "sku-1" },
    ]);
  });

  it("the same ERP SKU can feed several listings (one SKU, many listings)", () => {
    const planned = planAutoMatches(
      [
        { listingId: "L1", variationId: null, sellerSku: "GAR-1L" },
        { listingId: "L2", variationId: null, sellerSku: "GAR-1L" },
      ],
      skus,
    );
    expect(planned.map((match) => match.skuId)).toEqual(["sku-2", "sku-2"]);
  });

  it("returns nothing when there are no ERP SKUs", () => {
    expect(planAutoMatches([{ listingId: "L1", variationId: null, sellerSku: "X" }], [])).toEqual(
      [],
    );
  });
});
