import { describe, expect, it } from "vitest";

import { emptyListing, emptyVariant } from "@/domain/listings/canonical";

import {
  combinations,
  listingFromRows,
  newRow,
  rowsFromListing,
  SIMPLE_KEY,
  syncRows,
} from "./form-model";

const shared = {
  familyName: "Pote Hermético",
  title: "Pote Hermético",
  categoryId: "MLB1",
  categoryName: null,
  condition: "new" as const,
  attributes: [
    { id: "BRAND", valueId: null, valueName: "Marca X" },
    { id: "GTIN", valueId: null, valueName: "old" }, // edited in the rows, dropped from the sheet
  ],
  description: "Descrição padrão",
};

describe("listing form model", () => {
  it("a simple listing is one row and goes back as a simple listing", () => {
    const listing = {
      ...emptyListing(),
      priceCents: 2990,
      availableQuantity: 5,
      attributes: [{ id: "GTIN", valueId: null, valueName: "7891234567895" }],
      package: { weightG: 500, heightCm: 10, widthCm: 20, lengthCm: 30 },
    };
    const [row] = rowsFromListing(listing, "POTE-1");
    expect(row).toMatchObject({
      key: SIMPLE_KEY,
      skuCode: "POTE-1",
      gtin: "7891234567895",
      price: "29,90",
      quantity: "5",
      weight: "500",
    });
    const built = listingFromRows(shared, "simple", [], [row!]);
    expect("listing" in built && built.listing).toMatchObject({
      priceCents: 2990,
      availableQuantity: 5,
      skuCode: "POTE-1",
      package: { weightG: 500, heightCm: 10, widthCm: 20, lengthCm: 30 },
      variants: [],
      attributes: [
        { id: "BRAND", valueName: "Marca X" },
        { id: "GTIN", valueName: "7891234567895" },
        { id: "SELLER_SKU", valueName: "POTE-1" },
      ],
    });
  });

  it("variants: each row keeps its own values; shared description unless personalized", () => {
    const azul = {
      ...newRow("a", [{ id: "COLOR", valueId: null, valueName: "Azul" }]),
      price: "29,90",
      quantity: "3",
      skuCode: "pote-az",
      gtin: "7891234567895",
      listingTypeId: "gold_pro" as const,
    };
    const verde = {
      ...newRow("b", [{ id: "COLOR", valueId: null, valueName: "Verde" }]),
      price: "31,90",
      quantity: "2",
      emptyGtinReason: "Outro motivo",
      ownDescription: true,
      description: "Só a verde",
    };
    const built = listingFromRows(shared, "variants", ["COLOR"], [azul, verde]);
    if (!("listing" in built)) throw new Error("expected a listing");
    expect(built.listing.variationAttributeIds).toEqual(["COLOR"]);
    expect(built.listing.variants[0]).toMatchObject({
      priceCents: 2990,
      availableQuantity: 3,
      skuCode: "pote-az",
      sellerSku: "POTE-AZ",
      gtin: "7891234567895",
      listingTypeId: "gold_pro",
      description: null,
    });
    expect(built.listing.variants[1]).toMatchObject({
      priceCents: 3190,
      gtin: null,
      emptyGtinReason: "Outro motivo",
      description: "Só a verde",
    });
    // and back to rows
    const rows = rowsFromListing(built.listing, null);
    expect(rows.map((row) => row.price)).toEqual(["29,90", "31,90"]);
    expect(rows[1]).toMatchObject({ ownDescription: true, description: "Só a verde" });
  });

  it("reports invalid numbers per row", () => {
    const bad = { ...newRow("x", []), price: "abc", quantity: "-1", weight: "2,5" };
    expect(listingFromRows(shared, "simple", [], [bad])).toEqual({
      errors: {
        "row.x.price": "Preço inválido",
        "row.x.quantity": "Quantidade inválida",
        "row.x.weightG": "Número inteiro",
      },
    });
  });

  it("combinations of two attributes, keeping existing rows", () => {
    const color = (name: string) => ({ id: "COLOR", valueId: null, valueName: name });
    const size = (name: string) => ({ id: "SIZE", valueId: null, valueName: name });
    const combos = combinations(["COLOR", "SIZE"], {
      COLOR: [color("Azul"), color("Verde")],
      SIZE: [size("P"), size("M")],
    });
    expect(combos).toHaveLength(4);
    const existing = {
      ...newRow("keep", [color("Azul"), size("P")]),
      skuCode: "AZ-P",
      price: "10,00",
    };
    const rows = syncRows([existing], ["COLOR", "SIZE"], combos);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ key: "keep", skuCode: "AZ-P" });
    expect(rows[1]).toMatchObject({ skuCode: "", price: "10,00" }); // new rows copy sale data
    expect(combinations([], {})).toEqual([]);
  });

  it("copied variants keep the seller SKU as the code", () => {
    const listing = {
      ...emptyListing(),
      variationAttributeIds: ["COLOR"],
      variants: [{ ...emptyVariant("v"), sellerSku: "CAM-AZ-M" }],
    };
    expect(rowsFromListing(listing, null)[0]?.skuCode).toBe("CAM-AZ-M");
  });
});
