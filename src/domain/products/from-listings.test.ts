import { describe, expect, it } from "vitest";

import {
  buildProposal,
  parseLengthCm,
  parseWeightGrams,
  type SourceListing,
} from "@/domain/products/from-listings";

function listing(overrides: Partial<SourceListing> & { externalId: string }): SourceListing {
  return {
    listingId: `id-${overrides.externalId}`,
    title: `Título ${overrides.externalId}`,
    permalink: null,
    familyId: null,
    familyName: null,
    sellerSku: null,
    availableQuantity: 5,
    attributes: [],
    variations: [],
    ...overrides,
  };
}

const attrs = (values: Record<string, string>) =>
  Object.entries(values).map(([id, value_name]) => ({ id, name: id.toLowerCase(), value_name }));

describe("parsers", () => {
  it.each([
    ["992 g", 992],
    ["1,5 kg", 1500],
    ["1.5 kg", 1500],
    ["10 g", 10],
  ])("weight %s", (input, grams) => {
    expect(parseWeightGrams(input)).toBe(grams);
  });

  it.each(["", "abc", "0 g", "10 lb", null])("weight rejects %j", (input) => {
    expect(parseWeightGrams(input)).toBeNull();
  });

  it.each([
    ["10 cm", 10],
    ["10,5 cm", 11],
    ["15 mm", 2],
    ["1 mm", 1],
    ["1,2 m", 120],
  ])("length %s", (input, cm) => {
    expect(parseLengthCm(input)).toBe(cm);
  });
});

describe("buildProposal", () => {
  it("one ERP SKU per code, linked to every listing that uses it", () => {
    const proposal = buildProposal(
      [
        listing({ externalId: "MLB1", sellerSku: "gar-1l", availableQuantity: 3 }),
        listing({ externalId: "MLB2", sellerSku: " GAR-1L ", availableQuantity: 7 }),
      ],
      new Set(),
    );
    expect(proposal.products).toHaveLength(1);
    const sku = proposal.products[0]?.skus[0];
    expect(sku).toMatchObject({
      code: "GAR-1L",
      externalIds: ["MLB1", "MLB2"],
      initialStock: 7, // highest, not the sum
      warnings: ["stock_conflict"],
      blocked: false,
    });
  });

  it("a User Products family becomes one product whose SKUs vary by the differing attributes", () => {
    const proposal = buildProposal(
      [
        listing({
          externalId: "MLB1",
          sellerSku: "CAM-AZ",
          familyId: "F1",
          familyName: "Camiseta básica",
          attributes: attrs({ BRAND: "Hering", COLOR: "Azul", MATERIAL: "Algodão" }),
        }),
        listing({
          externalId: "MLB2",
          sellerSku: "CAM-PR",
          familyId: "F1",
          familyName: "Camiseta básica",
          attributes: attrs({ BRAND: "Hering", COLOR: "Preto", MATERIAL: "Algodão" }),
        }),
      ],
      new Set(),
    );
    expect(proposal.products).toHaveLength(1);
    const product = proposal.products[0];
    expect(product).toMatchObject({ name: "Camiseta básica", brand: "Hering" });
    expect(product?.skus.map((sku) => [sku.code, sku.variation])).toEqual([
      ["CAM-AZ", [{ name: "color", value: "Azul" }]],
      ["CAM-PR", [{ name: "color", value: "Preto" }]],
    ]);
  });

  it("without family, each SKU is its own product named after the listing", () => {
    const proposal = buildProposal(
      [
        listing({ externalId: "MLB1", sellerSku: "A1", title: "Garrafa" }),
        listing({ externalId: "MLB2", sellerSku: "B2", title: "Copo" }),
      ],
      new Set(),
    );
    expect(proposal.products.map((product) => product.name)).toEqual(["Copo", "Garrafa"]);
  });

  it("EAN only when all listings agree and the check digit is valid", () => {
    const proposal = buildProposal(
      [
        listing({
          externalId: "MLB1",
          sellerSku: "OK",
          attributes: attrs({ GTIN: "4006381333931" }),
        }),
        listing({
          externalId: "MLB2",
          sellerSku: "DIF",
          attributes: attrs({ GTIN: "4006381333931" }),
        }),
        listing({ externalId: "MLB3", sellerSku: "DIF", attributes: attrs({ GTIN: "73513537" }) }),
        listing({
          externalId: "MLB4",
          sellerSku: "BAD",
          attributes: attrs({ GTIN: "1234567890123" }),
        }),
      ],
      new Set(),
    );
    const skus = Object.fromEntries(
      proposal.products.flatMap((product) => product.skus).map((sku) => [sku.code, sku]),
    );
    expect(skus.OK).toMatchObject({ ean: "4006381333931", warnings: [] });
    expect(skus.DIF).toMatchObject({ ean: null, warnings: ["ean_conflict"] });
    expect(skus.BAD).toMatchObject({ ean: null, warnings: ["ean_invalid"] });
  });

  it("reads weight and package size from the listing attributes", () => {
    const proposal = buildProposal(
      [
        listing({
          externalId: "MLB1",
          sellerSku: "A1",
          attributes: attrs({
            SELLER_PACKAGE_WEIGHT: "992 g",
            SELLER_PACKAGE_HEIGHT: "10 cm",
            SELLER_PACKAGE_WIDTH: "20 cm",
            SELLER_PACKAGE_LENGTH: "30 cm",
          }),
        }),
      ],
      new Set(),
    );
    expect(proposal.products[0]?.skus[0]).toMatchObject({
      weightGrams: 992,
      heightCm: 10,
      widthCm: 20,
      lengthCm: 30,
    });
  });

  it("skips codes that already exist in the ERP", () => {
    const proposal = buildProposal(
      [
        listing({ externalId: "MLB1", sellerSku: "POLO" }),
        listing({ externalId: "MLB2", sellerSku: "NEW" }),
      ],
      new Set(["POLO"]),
    );
    expect(proposal.existingCodes).toEqual(["POLO"]);
    expect(proposal.products.flatMap((product) => product.skus).map((sku) => sku.code)).toEqual([
      "NEW",
    ]);
  });

  it("lists listings without SKU instead of creating them", () => {
    const proposal = buildProposal(
      [
        listing({ externalId: "MLB1" }),
        listing({
          externalId: "MLB2",
          variations: [
            { variationId: "V1", sellerSku: null, attributes: [], availableQuantity: 1 },
          ],
        }),
      ],
      new Set(),
    );
    expect(proposal.products).toEqual([]);
    expect(proposal.withoutSku.map((item) => [item.externalId, item.reason])).toEqual([
      ["MLB1", "no_sku"],
      ["MLB2", "variations_without_sku"],
    ]);
  });

  it("variations with their own SKU become SKUs with the variation attributes", () => {
    const proposal = buildProposal(
      [
        listing({
          externalId: "MLB1",
          title: "Camiseta",
          variations: [
            {
              variationId: "V1",
              sellerSku: "CAM-M",
              attributes: [{ name: "Tamanho", value: "M" }],
              availableQuantity: 4,
            },
          ],
        }),
      ],
      new Set(),
    );
    expect(proposal.products[0]?.skus[0]).toMatchObject({
      code: "CAM-M",
      variation: [{ name: "Tamanho", value: "M" }],
      initialStock: 4,
    });
  });

  it("blocks codes the ERP can't store", () => {
    const proposal = buildProposal(
      [listing({ externalId: "MLB1", sellerSku: "CAM AZUL" })],
      new Set(),
    );
    expect(proposal.products[0]?.skus[0]).toMatchObject({
      blocked: true,
      warnings: ["invalid_code"],
    });
  });
});
