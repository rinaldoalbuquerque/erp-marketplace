import { describe, expect, it } from "vitest";

import {
  canonicalListingSchema,
  emptyListing,
  listingFromSku,
  missingForPublish,
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
