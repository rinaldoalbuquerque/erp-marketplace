import { describe, expect, it, vi } from "vitest";

import { getListingForCopy, resolveCatalogProduct } from "@/connectors/mercadolivre/copying";
import type { FetchFn } from "@/connectors/mercadolivre/http";
import { toPublishBody } from "@/connectors/mercadolivre/publishing";

function fakeFetch(handler: (url: URL) => { status: number; body: unknown }) {
  const fn = vi.fn(async (input: string | URL | Request) => {
    const { status, body } = handler(new URL(String(input)));
    return new Response(JSON.stringify(body), { status });
  });
  return fn as unknown as FetchFn & typeof fn;
}

// Shape of a public item (another seller): no available_quantity.
const item = {
  id: "MLB555",
  seller_id: 999,
  title: "Pote Hermético De Vidro 370ml",
  family_name: "Pote Hermético De Vidro 370ml",
  user_product_id: "MLBU9",
  category_id: "MLB1234",
  price: 29.9,
  currency_id: "BRL",
  condition: "new",
  listing_type_id: "gold_pro",
  status: "active",
  pictures: [
    { id: "111-MLB555_01", secure_url: "https://http2.mlstatic.com/D_111-O.jpg" },
    { id: "222-MLB555_01", url: "http://http2.mlstatic.com/D_222-O.jpg" },
  ],
  sale_terms: [
    { id: "WARRANTY_TYPE", value_name: "Garantia do vendedor" },
    { id: "WARRANTY_TIME", value_name: "30 dias" },
  ],
  attributes: [{ id: "BRAND", value_id: "1", value_name: "Marca X" }],
  variations: [],
};

describe("getListingForCopy", () => {
  it("reads any listing into the canonical model", async () => {
    const fetchFn = fakeFetch((url) =>
      url.pathname.endsWith("/description")
        ? { status: 200, body: { plain_text: "Pote de vidro." } }
        : { status: 200, body: item },
    );
    const copy = await getListingForCopy(fetchFn, "t", "MLB555");
    expect(copy).toMatchObject({
      sellerId: "999",
      listingModel: "user_products",
      hasVariations: false,
      title: "Pote Hermético De Vidro 370ml",
    });
    expect(copy.listing).toMatchObject({
      familyName: "Pote Hermético De Vidro 370ml",
      description: "Pote de vidro.",
      categoryId: "MLB1234",
      listingTypeId: "gold_pro",
      priceCents: 2990,
      availableQuantity: 0,
      pictures: [
        { id: "111-MLB555_01", url: "https://http2.mlstatic.com/D_111-O.jpg" },
        { id: "222-MLB555_01", url: "http://http2.mlstatic.com/D_222-O.jpg" },
      ],
      attributes: [{ id: "BRAND", valueId: "1", valueName: "Marca X" }],
      warranty: { type: "Garantia do vendedor", time: "30 dias" },
    });
  });

  it("a picture without id is published by its URL (source)", () => {
    const body = toPublishBody(
      {
        familyName: "Pote",
        title: "Pote",
        description: "",
        categoryId: "MLB1234",
        categoryName: null,
        condition: "new",
        listingTypeId: "gold_special",
        priceCents: 1000,
        availableQuantity: 1,
        pictures: [
          { id: null, url: "https://http2.mlstatic.com/D_111-O.jpg" },
          { id: "333-MLB1_01", url: null },
        ],
        attributes: [],
        warranty: { type: null, time: null },
      },
      "user_products",
    );
    expect(body.pictures).toEqual([
      { source: "https://http2.mlstatic.com/D_111-O.jpg" },
      { id: "333-MLB1_01" },
    ]);
  });
});

describe("resolveCatalogProduct", () => {
  it("uses the buy box winner of a catalog product", async () => {
    const fetchFn = fakeFetch(() => ({
      status: 200,
      body: { id: "MLB39565808", buy_box_winner: { item_id: "MLB111" } },
    }));
    expect(await resolveCatalogProduct(fetchFn, "t", "MLB39565808")).toBe("MLB111");
    expect(new URL(String(fetchFn.mock.calls[0]?.[0])).pathname).toBe("/products/MLB39565808");
  });

  it("without a winner, takes the first listing of the product", async () => {
    const fetchFn = fakeFetch((url) =>
      url.pathname.endsWith("/items")
        ? { status: 200, body: { results: [{ item_id: "MLB5429219232" }], paging: { total: 5 } } }
        : { status: 200, body: { id: "MLB39565808", buy_box_winner: null } },
    );
    expect(await resolveCatalogProduct(fetchFn, "t", "MLB39565808")).toBe("MLB5429219232");
  });

  it("not a catalog product -> null", async () => {
    const fetchFn = fakeFetch(() => ({ status: 404, body: { error: "not_found" } }));
    expect(await resolveCatalogProduct(fetchFn, "t", "MLB1")).toBeNull();
  });
});
