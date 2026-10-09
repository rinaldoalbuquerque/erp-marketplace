import { describe, expect, it, vi } from "vitest";

import type { FetchFn } from "@/connectors/mercadolivre/http";
import { getListings, listListingIds, normalizeItem } from "@/connectors/mercadolivre/items";
import { MarketplaceAuthError } from "@/connectors/types";

function fakeFetch(handler: (url: URL) => { status: number; body: unknown }) {
  const fn = vi.fn(async (input: string | URL | Request) => {
    const { status, body } = handler(new URL(String(input)));
    return new Response(JSON.stringify(body), { status });
  });
  return fn as unknown as FetchFn & typeof fn;
}

// Shapes based on the documentation and the field names seen on a real MLB item.
const upItem = {
  id: "MLB100",
  title: "Garrafa térmica 1L",
  status: "active",
  sub_status: [],
  price: 89.9,
  currency_id: "BRL",
  available_quantity: 12,
  sold_quantity: 40,
  permalink: "https://produto.mercadolivre.com.br/MLB-100",
  thumbnail: "http://http2.mlstatic.com/D_100.jpg",
  category_id: "MLB1234",
  listing_type_id: "gold_special",
  condition: "new",
  user_product_id: "MLBU555",
  family_id: 777,
  family_name: "Garrafa térmica",
  seller_custom_field: null,
  attributes: [{ id: "SELLER_SKU", name: "SKU", value_name: "GAR-1L" }],
  variations: [],
  shipping: { logistic_type: "fulfillment" },
  last_updated: "2026-10-01T10:00:00.000Z",
};

const traditionalItem = {
  id: "MLB200",
  title: "Camiseta básica",
  status: "paused",
  sub_status: ["out_of_stock"],
  price: 49,
  currency_id: "BRL",
  available_quantity: 0,
  sold_quantity: 3,
  family_name: null,
  seller_custom_field: "CAM",
  attributes: [],
  variations: [
    {
      id: 9001,
      attribute_combinations: [
        { id: "COLOR", name: "Cor", value_name: "Azul" },
        { id: "SIZE", name: "Tamanho", value_name: "M" },
      ],
      price: 49,
      available_quantity: 0,
      sold_quantity: 2,
      seller_custom_field: null,
      attributes: [{ id: "SELLER_SKU", value_name: "CAM-AZ-M" }],
    },
  ],
};

describe("listListingIds (scan)", () => {
  it("follows scroll_id until there are no more results", async () => {
    const pages = [
      { results: ["MLB1", "MLB2"], scroll_id: "s1" },
      { results: ["MLB3"], scroll_id: "s1" },
      { results: [], scroll_id: null },
    ];
    const fetchFn = fakeFetch(() => ({ status: 200, body: pages.shift() }));
    const ids = await listListingIds(fetchFn, "APP_USR-x", "225885396");

    expect(ids).toEqual(["MLB1", "MLB2", "MLB3"]);
    const first = new URL(String(fetchFn.mock.calls[0]?.[0]));
    expect(first.pathname).toBe("/users/225885396/items/search");
    expect(first.searchParams.get("search_type")).toBe("scan");
    expect(first.searchParams.get("limit")).toBe("100");
    expect(first.searchParams.has("scroll_id")).toBe(false);
    expect(new URL(String(fetchFn.mock.calls[1]?.[0])).searchParams.get("scroll_id")).toBe("s1");
  });

  it("stops when scroll_id is null and removes duplicates", async () => {
    const fetchFn = fakeFetch(() => ({
      status: 200,
      body: { results: ["MLB1", "MLB1"], scroll_id: null },
    }));
    expect(await listListingIds(fetchFn, "t", "1")).toEqual(["MLB1"]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("401 asks to reconnect", async () => {
    const fetchFn = fakeFetch(() => ({ status: 401, body: {} }));
    await expect(listListingIds(fetchFn, "t", "1")).rejects.toBeInstanceOf(MarketplaceAuthError);
  });
});

describe("getListings (/items/bulk)", () => {
  it("reads in groups of 20 using the new bulk endpoint", async () => {
    const ids = Array.from({ length: 45 }, (_, index) => `MLB${index}`);
    const fetchFn = fakeFetch((url) => {
      const requested = (url.searchParams.get("ids") ?? "").split(",");
      return {
        status: 200,
        body: requested.map((id) => ({ id, status_code: 200, body: { ...upItem, id } })),
      };
    });
    const results = await getListings(fetchFn, "t", ids);

    expect(fetchFn).toHaveBeenCalledTimes(3); // 20 + 20 + 5
    expect(new URL(String(fetchFn.mock.calls[0]?.[0])).pathname).toBe("/items/bulk");
    expect(results).toHaveLength(45);
    expect(results.every((result) => "listing" in result)).toBe(true);
  });

  it("reports per-item errors without failing the batch", async () => {
    const fetchFn = fakeFetch(() => ({
      status: 200,
      body: [
        { id: "MLB100", status_code: 200, body: upItem },
        { id: "MLB404", status_code: 404, body: { message: "Item not found" } },
      ],
    }));
    const results = await getListings(fetchFn, "t", ["MLB100", "MLB404", "MLB999"]);
    expect(results[0]).toMatchObject({ externalId: "MLB100" });
    expect(results[1]).toEqual({ externalId: "MLB404", error: "Item not found" });
    expect(results[2]).toMatchObject({ externalId: "MLB999", error: expect.any(String) });
  });
});

describe("normalizeItem", () => {
  it("converts a User Products item", () => {
    expect(normalizeItem(upItem)).toMatchObject({
      externalId: "MLB100",
      title: "Garrafa térmica 1L",
      status: "active",
      priceCents: 8990,
      currency: "BRL",
      availableQuantity: 12,
      soldQuantity: 40,
      thumbnailUrl: "https://http2.mlstatic.com/D_100.jpg",
      listingModel: "user_products",
      userProductId: "MLBU555",
      familyId: "777",
      familyName: "Garrafa térmica",
      sellerSku: "GAR-1L",
      variations: [],
      externalUpdatedAt: new Date("2026-10-01T10:00:00.000Z"),
      logisticType: "fulfillment",
    });
  });

  it("converts a traditional item with variations", () => {
    const listing = normalizeItem(traditionalItem);
    expect(listing).toMatchObject({
      listingModel: "traditional",
      status: "paused",
      subStatus: ["out_of_stock"],
      priceCents: 4900,
      sellerSku: "CAM",
      familyName: null,
    });
    expect(listing.variations).toEqual([
      {
        externalId: "9001",
        attributes: [
          { name: "Cor", value: "Azul" },
          { name: "Tamanho", value: "M" },
        ],
        priceCents: 4900,
        availableQuantity: 0,
        soldQuantity: 2,
        sellerSku: "CAM-AZ-M",
      },
    ]);
  });

  it("keeps the original payload and tolerates missing fields", () => {
    const minimal = { id: "MLB1" };
    const listing = normalizeItem(minimal);
    expect(listing.raw).toBe(minimal);
    expect(listing).toMatchObject({ title: "MLB1", status: "unknown", priceCents: null });
  });

  it("rounds prices to cents without floating point noise", () => {
    expect(normalizeItem({ id: "MLB1", price: 19.99 }).priceCents).toBe(1999);
    expect(normalizeItem({ id: "MLB1", price: 0.1 + 0.2 }).priceCents).toBe(30);
  });
});
