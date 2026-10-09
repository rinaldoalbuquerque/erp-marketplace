import { z } from "zod";

import { MarketplaceApiError, type MarketplaceOrder } from "../types";
import { ML_API_BASE, type FetchFn } from "./http";
import { getJson, toCents } from "./items";

// Reading sales (orders).
// Docs: https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas
// - GET /orders/{ORDER_ID}: one order (also the `resource` of orders_v2 notifications).
// - GET /orders/search?seller={SELLER_ID}&order.date_last_updated.from=...&.to=...:
//   full orders in `results`, paged by offset/limit (`paging.total`, limit 50 in the docs).
// - date_closed: "when the order first becomes confirmed / paid and is
//   discounted from the item's stock". Status values: confirmed,
//   payment_required, payment_in_process, partially_paid, paid,
//   partially_refunded, pending_cancel, cancelled, invalid.
// - order_items[].item: id, variation_id, seller_sku, seller_custom_field.

export const ORDERS_PAGE_SIZE = 50;
const MAX_SEARCH_PAGES = 200; // safety stop (10k orders in one window)

const idSchema = z.union([z.number(), z.string()]).transform(String);

const orderSchema = z
  .object({
    id: idSchema,
    pack_id: idSchema.nullish(),
    status: z.string().nullish(),
    tags: z.array(z.string()).nullish(),
    total_amount: z.number().nullish(),
    currency_id: z.string().nullish(),
    date_created: z.string(),
    date_closed: z.string().nullish(),
    last_updated: z.string().nullish(),
    buyer: z.object({ nickname: z.string().nullish() }).passthrough().nullish(),
    shipping: z.object({ id: idSchema.nullish() }).passthrough().nullish(),
    order_items: z
      .array(
        z
          .object({
            item: z
              .object({
                id: z.string(),
                title: z.string().nullish(),
                variation_id: idSchema.nullish(),
                seller_sku: z.string().nullish(),
                seller_custom_field: z.string().nullish(),
              })
              .passthrough(),
            quantity: z.number().int(),
            unit_price: z.number().nullish(),
            sale_fee: z.number().nullish(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

const date = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export function normalizeOrder(body: unknown): MarketplaceOrder {
  const parsed = orderSchema.safeParse(body);
  if (!parsed.success) throw new MarketplaceApiError("Unexpected order response.", 200);
  const order = parsed.data;
  const dateCreated = date(order.date_created);
  if (!dateCreated) throw new MarketplaceApiError("Order without a valid date_created.", 200);
  return {
    externalId: order.id,
    packId: order.pack_id ?? null,
    status: order.status ?? "unknown",
    tags: order.tags ?? [],
    totalCents: toCents(order.total_amount),
    currency: order.currency_id ?? null,
    buyerNickname: order.buyer?.nickname ?? null,
    shippingId: order.shipping?.id ?? null,
    dateCreated,
    dateClosed: date(order.date_closed),
    externalUpdatedAt: date(order.last_updated),
    items: order.order_items.map((line) => ({
      externalItemId: line.item.id,
      variationKey: line.item.variation_id ?? "",
      title: line.item.title ?? line.item.id,
      quantity: line.quantity,
      unitPriceCents: toCents(line.unit_price),
      saleFeeCents: toCents(line.sale_fee),
      sellerSku: line.item.seller_sku || line.item.seller_custom_field || null,
    })),
    raw: body,
  };
}

export async function getOrder(
  fetchFn: FetchFn,
  accessToken: string,
  externalOrderId: string,
): Promise<MarketplaceOrder> {
  const url = `${ML_API_BASE}/orders/${encodeURIComponent(externalOrderId)}`;
  return normalizeOrder(await getJson(fetchFn, url, accessToken));
}

/** Date format of the docs' examples: 2015-07-01T00:00:00.000-00:00 */
const mlDate = (value: Date) => value.toISOString().replace("Z", "-00:00");

const searchPageSchema = z.object({
  results: z.array(z.unknown()).default([]),
  paging: z.object({ total: z.number().int() }).passthrough(),
});

export async function searchOrdersUpdated(
  fetchFn: FetchFn,
  accessToken: string,
  externalUserId: string,
  from: Date,
  to: Date,
): Promise<MarketplaceOrder[]> {
  const orders = new Map<string, MarketplaceOrder>();
  for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
    const params = new URLSearchParams({
      seller: externalUserId,
      "order.date_last_updated.from": mlDate(from),
      "order.date_last_updated.to": mlDate(to),
      offset: String(page * ORDERS_PAGE_SIZE),
      limit: String(ORDERS_PAGE_SIZE),
    });
    const parsed = searchPageSchema.safeParse(
      await getJson(fetchFn, `${ML_API_BASE}/orders/search?${params}`, accessToken),
    );
    if (!parsed.success) throw new MarketplaceApiError("Unexpected orders search response.", 200);
    for (const result of parsed.data.results) {
      const order = normalizeOrder(result);
      orders.set(order.externalId, order);
    }
    const seen = (page + 1) * ORDERS_PAGE_SIZE;
    if (parsed.data.results.length === 0 || seen >= parsed.data.paging.total) break;
  }
  return [...orders.values()];
}
