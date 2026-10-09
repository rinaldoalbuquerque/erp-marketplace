import { describe, expect, it, vi } from "vitest";

import type { FetchFn } from "@/connectors/mercadolivre/http";
import { getOrder, normalizeOrder, searchOrdersUpdated } from "@/connectors/mercadolivre/orders";
import { MarketplaceAuthError } from "@/connectors/types";

function fakeFetch(handler: (url: URL) => { status: number; body: unknown }) {
  const fn = vi.fn(async (input: string | URL | Request) => {
    const { status, body } = handler(new URL(String(input)));
    return new Response(JSON.stringify(body), { status });
  });
  return fn as unknown as FetchFn & typeof fn;
}

// Shape from the documentation example (GET /orders/{id}).
const docOrder = {
  id: 2000003508897196,
  date_created: "2022-04-08T17:01:30.000-04:00",
  date_closed: "2022-04-08T17:01:33.000-04:00",
  last_updated: "2022-04-08T17:03:32.000-04:00",
  pack_id: 2000003508553677,
  fulfilled: null,
  total_amount: 50,
  order_items: [
    {
      item: {
        id: "MLB2608564035",
        title: "Camiseta Basica",
        category_id: "MLB31447",
        variation_id: 174390848694,
        seller_custom_field: null,
        seller_sku: null,
      },
      quantity: 1,
      unit_price: 50,
      currency_id: "BRL",
      sale_fee: 12,
    },
  ],
  currency_id: "BRL",
  shipping: { id: 41297142475 },
  status: "paid",
  tags: ["no_shipping", "test_order", "paid"],
  buyer: { id: 266272126 },
  seller: { id: 478055419 },
};

describe("normalizeOrder", () => {
  it("converts the documented order shape", () => {
    expect(normalizeOrder(docOrder)).toMatchObject({
      externalId: "2000003508897196",
      packId: "2000003508553677",
      status: "paid",
      tags: ["no_shipping", "test_order", "paid"],
      totalCents: 5000,
      currency: "BRL",
      buyerNickname: null,
      shippingId: "41297142475",
      dateCreated: new Date("2022-04-08T21:01:30.000Z"),
      dateClosed: new Date("2022-04-08T21:01:33.000Z"),
      items: [
        {
          externalItemId: "MLB2608564035",
          variationKey: "174390848694",
          title: "Camiseta Basica",
          quantity: 1,
          unitPriceCents: 5000,
          saleFeeCents: 1200,
          sellerSku: null,
        },
      ],
    });
  });

  it("an order not confirmed yet has no date_closed; no variation means key ''", () => {
    const order = normalizeOrder({
      ...docOrder,
      status: "payment_in_process",
      date_closed: null,
      order_items: [{ item: { id: "MLB1", seller_sku: "GAR-1L" }, quantity: 2 }],
    });
    expect(order.dateClosed).toBeNull();
    expect(order.items[0]).toMatchObject({ variationKey: "", sellerSku: "GAR-1L", quantity: 2 });
  });
});

describe("getOrder", () => {
  it("reads /orders/{id}; 401 asks to reconnect", async () => {
    const ok = fakeFetch(() => ({ status: 200, body: docOrder }));
    expect((await getOrder(ok, "t", "2000003508897196")).externalId).toBe("2000003508897196");
    expect(new URL(String(ok.mock.calls[0]?.[0])).pathname).toBe("/orders/2000003508897196");

    const denied = fakeFetch(() => ({ status: 401, body: {} }));
    await expect(getOrder(denied, "t", "1")).rejects.toBeInstanceOf(MarketplaceAuthError);
  });
});

describe("searchOrdersUpdated", () => {
  it("filters by last update and follows offset until paging.total", async () => {
    const fetchFn = fakeFetch((url) => {
      const offset = Number(url.searchParams.get("offset"));
      const ids = offset === 0 ? Array.from({ length: 50 }, (_, i) => i + 1) : [51, 52];
      return {
        status: 200,
        body: {
          results: ids.map((id) => ({ ...docOrder, id })),
          paging: { total: 52, offset, limit: 50 },
        },
      };
    });
    const orders = await searchOrdersUpdated(
      fetchFn,
      "t",
      "225885396",
      new Date("2026-10-09T10:00:00.000Z"),
      new Date("2026-10-09T11:00:00.000Z"),
    );
    expect(orders).toHaveLength(52);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const first = new URL(String(fetchFn.mock.calls[0]?.[0]));
    expect(first.pathname).toBe("/orders/search");
    expect(first.searchParams.get("seller")).toBe("225885396");
    expect(first.searchParams.get("order.date_last_updated.from")).toBe(
      "2026-10-09T10:00:00.000-00:00",
    );
    expect(first.searchParams.get("order.date_last_updated.to")).toBe(
      "2026-10-09T11:00:00.000-00:00",
    );
  });
});
