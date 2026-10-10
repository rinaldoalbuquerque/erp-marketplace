import { describe, expect, it, vi } from "vitest";

import {
  getCatalogProductForCopy,
  getFamily,
  getListingForCopy,
} from "@/connectors/mercadolivre/copying";
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
        package: { weightG: null, heightCm: null, widthCm: null, lengthCm: null },
        variationAttributeIds: [],
        variants: [],
      },
      "user_products",
    );
    expect(body.pictures).toEqual([
      { source: "https://http2.mlstatic.com/D_111-O.jpg" },
      { id: "333-MLB1_01" },
    ]);
  });
});

describe("getCatalogProductForCopy", () => {
  // Fields seen on GET /products/MLB39565808 (2026-10-10).
  const product = {
    id: "MLB39565808",
    name: "Escorredor Bancada Pia Compacto Louças Talheres Pratos Preto",
    family_name: "Escorredor de louça EVRODU Escorredor Compacto Preto",
    domain_id: "MLB-DISHES_RACKS",
    pictures: [
      {
        id: "789094-MLA100058497347_122025",
        url: "https://http2.mlstatic.com/D_NQ_NP_789094-MLA100058497347_122025-F.jpg",
      },
    ],
    attributes: [{ id: "BRAND", name: "Marca", value_id: "32132876", value_name: "EVRODU" }],
    short_description: { type: "plaintext", content: "Escorredor de pia compacto." },
  };

  it("builds a draft from the catalog: name, pictures by URL, sheet, description, category", async () => {
    const fetchFn = fakeFetch((url) =>
      url.pathname.startsWith("/catalog_domains/")
        ? { status: 200, body: [{ id: "MLB194034", name: "Escorredores" }] }
        : { status: 200, body: product },
    );
    const copy = await getCatalogProductForCopy(fetchFn, "t", "MLB39565808");
    expect(copy?.listing).toMatchObject({
      familyName: "Escorredor de louça EVRODU Escorredor Compacto Preto",
      title: "Escorredor Bancada Pia Compacto Louças Talheres Pratos Preto",
      description: "Escorredor de pia compacto.",
      categoryId: "MLB194034",
      categoryName: "Escorredores",
      priceCents: null,
      pictures: [
        {
          id: null,
          url: "https://http2.mlstatic.com/D_NQ_NP_789094-MLA100058497347_122025-F.jpg",
        },
      ],
      attributes: [{ id: "BRAND", valueId: "32132876", valueName: "EVRODU" }],
    });
    expect(new URL(String(fetchFn.mock.calls[1]?.[0])).pathname).toBe(
      "/catalog_domains/MLB-DISHES_RACKS/categories",
    );
  });

  it("not a catalog product -> null", async () => {
    const fetchFn = fakeFetch(() => ({ status: 404, body: { error: "not_found" } }));
    expect(await getCatalogProductForCopy(fetchFn, "t", "MLB1")).toBeNull();
  });
});

describe("variations and families", () => {
  it("reads the variations of a traditional listing (combination, price, pictures, SKU)", async () => {
    const traditional = {
      id: "MLB777",
      title: "Camiseta Básica",
      category_id: "MLB31447",
      price: 49,
      status: "active",
      pictures: [
        { id: "P1", secure_url: "https://http2.mlstatic.com/P1.jpg" },
        { id: "P2", secure_url: "https://http2.mlstatic.com/P2.jpg" },
      ],
      attributes: [{ id: "BRAND", value_name: "Marca X" }],
      variations: [
        {
          id: 9001,
          price: 49,
          available_quantity: 3,
          picture_ids: ["P2"],
          attribute_combinations: [
            { id: "COLOR", value_id: "52049", value_name: "Preto" },
            { id: "SIZE", value_id: "1", value_name: "M" },
          ],
          attributes: [{ id: "SELLER_SKU", value_name: "CAM-PR-M" }],
        },
      ],
    };
    const fetchFn = fakeFetch((url) =>
      url.pathname.endsWith("/description")
        ? { status: 404, body: {} }
        : { status: 200, body: traditional },
    );
    const copy = await getListingForCopy(fetchFn, "t", "MLB777");
    expect(copy.hasVariations).toBe(true);
    expect(copy.familyId).toBeNull();
    expect(copy.variations).toEqual([
      {
        externalId: "9001",
        attributes: [
          { id: "COLOR", valueId: "52049", valueName: "Preto" },
          { id: "SIZE", valueId: "1", valueName: "M" },
        ],
        priceCents: 4900,
        availableQuantity: 3,
        pictures: [{ id: "P2", url: "https://http2.mlstatic.com/P2.jpg" }],
        sellerSku: "CAM-PR-M",
      },
    ]);
  });

  it("reads a User Products family: varying and shared attributes", async () => {
    const fetchFn = fakeFetch(() => ({
      status: 200,
      body: {
        family_id: 1034108706118545,
        family_name: "Boné Esportivo Dry Fit",
        attributes: [
          { id: "BRAND", hierarchy: "PARENT_PK" },
          { id: "MODEL", hierarchy: "PARENT_PK" },
        ],
        child_attributes_ids: ["COLOR", "SIZE"],
      },
    }));
    expect(await getFamily(fetchFn, "t", "1034108706118545")).toEqual({
      familyId: "1034108706118545",
      familyName: "Boné Esportivo Dry Fit",
      childAttributeIds: ["COLOR", "SIZE"],
      parentAttributeIds: ["BRAND", "MODEL"],
    });
    expect(new URL(String(fetchFn.mock.calls[0]?.[0])).pathname).toBe(
      "/user-products-families/1034108706118545",
    );
    expect(
      await getFamily(
        fakeFetch(() => ({ status: 404, body: {} })),
        "t",
        "1",
      ),
    ).toBeNull();
  });
});
