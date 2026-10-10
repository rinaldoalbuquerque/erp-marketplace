import { describe, expect, it } from "vitest";

import {
  canonicalListingSchema,
  emptyListing,
  emptyVariant,
  listingFromSku,
  missingForPublish,
  variantListing,
} from "@/domain/listings/canonical";

describe("canonical listing", () => {
  it("a new listing is valid and Clássico by default", () => {
    const listing = emptyListing();
    expect(canonicalListingSchema.safeParse(listing).success).toBe(true);
    expect(listing.listingTypeId).toBe("gold_special");
  });

  it("starts from a SKU with name, description, brand, EAN and stock (negative = 0)", () => {
    const listing = listingFromSku({
      productName: "Borracha Panela de Pressão 4,5 L",
      productDescription: "Silicone atóxico",
      brand: "Clock",
      ean: "7891234567895",
      stockOnHand: -2,
    });
    expect(listing).toMatchObject({
      familyName: "Borracha Panela de Pressão 4,5 L",
      title: "Borracha Panela de Pressão 4,5 L",
      description: "Silicone atóxico",
      availableQuantity: 0,
      attributes: [
        { id: "BRAND", valueId: null, valueName: "Clock" },
        { id: "GTIN", valueId: null, valueName: "7891234567895" },
      ],
    });
  });

  it("lists what is missing before validation, per listing model", () => {
    const listing = { ...emptyListing(), title: "Título" };
    expect(missingForPublish(listing, "user_products")).toEqual([
      "Nome da família",
      "Categoria",
      "Preço",
      "Ao menos uma foto",
    ]);
    const ready = {
      ...listing,
      familyName: "Família",
      categoryId: "MLB1",
      priceCents: 1000,
      pictures: [{ id: "123-MLB1_1", url: null }],
    };
    expect(missingForPublish(ready, "user_products")).toEqual([]);
    expect(missingForPublish({ ...ready, title: "" }, "traditional")).toEqual(["Título"]);
  });

  it("rejects invalid data", () => {
    expect(canonicalListingSchema.safeParse({ ...emptyListing(), priceCents: -5 }).success).toBe(
      false,
    );
    expect(
      canonicalListingSchema.safeParse({ ...emptyListing(), listingTypeId: "free" }).success,
    ).toBe(false);
  });
});

describe("variants", () => {
  const base = {
    ...emptyListing(),
    familyName: "Pote Hermético 370ml",
    categoryId: "MLB1",
    priceCents: 2990,
    pictures: [{ id: "BASE", url: null }],
    attributes: [
      { id: "BRAND", valueId: null, valueName: "Marca X" },
      { id: "COLOR", valueId: null, valueName: "Preto" },
      { id: "GTIN", valueId: null, valueName: "000" },
    ],
    variationAttributeIds: ["COLOR"],
  };
  const azul = {
    ...emptyVariant("v1"),
    attributes: [{ id: "COLOR", valueId: null, valueName: "Azul" }],
    gtin: "7891234567895",
    sellerSku: "POTE-AZ",
    availableQuantity: 4,
  };

  it("a variant's listing = shared data + its own values", () => {
    const listing = variantListing(base, azul);
    expect(listing).toMatchObject({
      familyName: "Pote Hermético 370ml",
      priceCents: 2990, // falls back to the listing's price
      availableQuantity: 4,
      pictures: [{ id: "BASE", url: null }], // falls back to the listing's pictures
      variants: [],
    });
    expect(listing.attributes).toEqual([
      { id: "BRAND", valueId: null, valueName: "Marca X" },
      { id: "COLOR", valueId: null, valueName: "Azul" },
      { id: "GTIN", valueId: null, valueName: "7891234567895" },
      { id: "SELLER_SKU", valueId: null, valueName: "POTE-AZ" },
    ]);
    const noBarcode = variantListing(base, {
      ...azul,
      gtin: null,
      emptyGtinReason: "O produto não tem código cadastrado",
      priceCents: 3290,
    });
    expect(noBarcode.priceCents).toBe(3290);
    expect(noBarcode.attributes).toContainEqual({
      id: "EMPTY_GTIN_REASON",
      valueId: null,
      valueName: "O produto não tem código cadastrado",
    });
    expect(noBarcode.attributes.some((attribute) => attribute.id === "GTIN")).toBe(false);
  });

  it("lists what each variant still needs, and repeated combinations", () => {
    const listing = {
      ...base,
      priceCents: null,
      pictures: [],
      variants: [azul, { ...emptyVariant("v2") }, { ...azul, key: "v3" }],
    };
    expect(missingForPublish(listing, "user_products")).toEqual([
      "Azul: preço",
      "Azul: ao menos uma foto",
      "Variante 2: valor de COLOR",
      "Variante 2: preço",
      "Variante 2: ao menos uma foto",
      "Azul: preço",
      "Azul: ao menos uma foto",
      "Variantes 1 e 3 têm os mesmos valores",
    ]);
    expect(missingForPublish({ ...base, variants: [azul] }, "traditional")).toContain(
      "Variantes só podem ser publicadas em contas User Products",
    );
  });

  it("old drafts without variants still parse (simple listing)", () => {
    const { variants: _variants, variationAttributeIds: _ids, ...old } = emptyListing();
    const parsed = canonicalListingSchema.parse(old);
    expect(parsed.variants).toEqual([]);
    expect(parsed.variationAttributeIds).toEqual([]);
  });
});
