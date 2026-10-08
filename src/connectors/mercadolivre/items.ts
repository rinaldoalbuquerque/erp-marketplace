import { z } from "zod";

import {
  MarketplaceApiError,
  MarketplaceAuthError,
  type ListingFetchResult,
  type MarketplaceListing,
  type MarketplaceListingVariation,
} from "../types";
import { ML_API_BASE, mlFetch, readErrorBody, type FetchFn } from "./http";

// Reading a seller's listings.
// Docs: https://developers.mercadolivre.com.br/pt_br/itens-e-buscas
// - GET /users/{USER_ID}/items/search?search_type=scan: all items, also past
//   1000; follow scroll_id (expires in 5 min) until no more results; limit max 100.
// - GET /items/bulk?ids=ID1,ID2: up to 20 items per call. Replaces /items?ids=
//   (being discontinued, migrate by 25/10/2026). Each element: { id, status_code, body }.
// - Confirmed on a real MLB account (2026-10-08): search without status filter
//   returns every status (active + paused + closed...); bulk body includes
//   user_product_id, family_id, family_name, variations, seller_custom_field.
// User Products: items with family_name != null are in the new model
// (https://developers.mercadolivre.com.br/pt_br/user-products).

export const SEARCH_PAGE_SIZE = 100;
export const BULK_SIZE = 20;
const MAX_SCAN_PAGES = 2000; // safety stop (200k items)

async function getJson(fetchFn: FetchFn, url: string, accessToken: string): Promise<unknown> {
  const response = await mlFetch(fetchFn, url, {
    headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 401) {
    throw new MarketplaceAuthError("Mercado Livre rejected the access token.", "unauthorized");
  }
  if (!response.ok) {
    const error = await readErrorBody(response);
    throw new MarketplaceApiError(
      `Mercado Livre request failed (${error.error ?? error.message ?? response.status}).`,
      response.status,
      error.error ?? null,
    );
  }
  return response.json();
}

const scanPageSchema = z.object({
  results: z.array(z.string()).default([]),
  scroll_id: z.string().nullish(),
});

export async function listListingIds(
  fetchFn: FetchFn,
  accessToken: string,
  externalUserId: string,
): Promise<string[]> {
  const ids = new Set<string>();
  let scrollId: string | null | undefined;
  for (let page = 0; page < MAX_SCAN_PAGES; page++) {
    const params = new URLSearchParams({ search_type: "scan", limit: String(SEARCH_PAGE_SIZE) });
    if (scrollId) params.set("scroll_id", scrollId);
    const url = `${ML_API_BASE}/users/${encodeURIComponent(externalUserId)}/items/search?${params}`;
    const parsed = scanPageSchema.safeParse(await getJson(fetchFn, url, accessToken));
    if (!parsed.success) {
      throw new MarketplaceApiError("Unexpected items search response.", 200);
    }
    const { results, scroll_id } = parsed.data;
    if (results.length === 0) break;
    results.forEach((id) => ids.add(id));
    if (!scroll_id) break;
    scrollId = scroll_id;
  }
  return [...ids];
}

// Item fields we use. Everything else stays in `raw`.
const attributeSchema = z
  .object({
    id: z.string().nullish(),
    name: z.string().nullish(),
    value_name: z.string().nullish(),
  })
  .passthrough();

const variationSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    attribute_combinations: z.array(attributeSchema).default([]),
    price: z.number().nullish(),
    available_quantity: z.number().nullish(),
    sold_quantity: z.number().nullish(),
    seller_custom_field: z.string().nullish(),
    attributes: z.array(attributeSchema).default([]),
  })
  .passthrough();

const itemSchema = z
  .object({
    id: z.string(),
    title: z.string().nullish(),
    status: z.string().nullish(),
    sub_status: z.array(z.string()).nullish(),
    price: z.number().nullish(),
    currency_id: z.string().nullish(),
    available_quantity: z.number().nullish(),
    sold_quantity: z.number().nullish(),
    permalink: z.string().nullish(),
    thumbnail: z.string().nullish(),
    category_id: z.string().nullish(),
    listing_type_id: z.string().nullish(),
    condition: z.string().nullish(),
    user_product_id: z.string().nullish(),
    family_id: z.union([z.number(), z.string()]).nullish(),
    family_name: z.string().nullish(),
    seller_custom_field: z.string().nullish(),
    attributes: z.array(attributeSchema).default([]),
    variations: z.array(variationSchema).default([]),
    last_updated: z.string().nullish(),
  })
  .passthrough();

const toCents = (price: number | null | undefined) =>
  typeof price === "number" ? Math.round(price * 100) : null;

/** SKU from seller_custom_field or the SELLER_SKU attribute (both documented as SKU sources). */
function sellerSkuOf(
  customField: string | null | undefined,
  attributes: Array<z.infer<typeof attributeSchema>>,
): string | null {
  const fromField = customField?.trim();
  if (fromField) return fromField;
  const fromAttribute = attributes.find((attribute) => attribute.id === "SELLER_SKU")?.value_name;
  return fromAttribute?.trim() || null;
}

const https = (url: string | null | undefined) =>
  url ? url.replace(/^http:\/\//, "https://") : null;

export function normalizeItem(body: unknown): MarketplaceListing {
  const item = itemSchema.parse(body);
  const variations: MarketplaceListingVariation[] = item.variations.map((variation) => ({
    externalId: String(variation.id),
    attributes: variation.attribute_combinations
      .filter((attribute) => attribute.name && attribute.value_name)
      .map((attribute) => ({
        name: attribute.name as string,
        value: attribute.value_name as string,
      })),
    priceCents: toCents(variation.price),
    availableQuantity: variation.available_quantity ?? null,
    soldQuantity: variation.sold_quantity ?? null,
    sellerSku: sellerSkuOf(variation.seller_custom_field, variation.attributes),
  }));
  const lastUpdated = item.last_updated ? new Date(item.last_updated) : null;

  return {
    externalId: item.id,
    title: item.title ?? item.family_name ?? item.id,
    status: item.status ?? "unknown",
    subStatus: item.sub_status ?? [],
    priceCents: toCents(item.price),
    currency: item.currency_id ?? null,
    availableQuantity: item.available_quantity ?? null,
    soldQuantity: item.sold_quantity ?? null,
    permalink: item.permalink ?? null,
    thumbnailUrl: https(item.thumbnail),
    categoryId: item.category_id ?? null,
    listingTypeId: item.listing_type_id ?? null,
    condition: item.condition ?? null,
    listingModel: item.family_name ? "user_products" : "traditional",
    userProductId: item.user_product_id ?? null,
    familyId: item.family_id == null ? null : String(item.family_id),
    familyName: item.family_name ?? null,
    sellerSku: sellerSkuOf(item.seller_custom_field, item.attributes),
    externalUpdatedAt: lastUpdated && !Number.isNaN(lastUpdated.getTime()) ? lastUpdated : null,
    variations,
    raw: body,
  };
}

const bulkSchema = z.array(
  z
    .object({
      id: z.string().optional(),
      status_code: z.number(),
      body: z.unknown(),
    })
    .passthrough(),
);

export async function getListings(
  fetchFn: FetchFn,
  accessToken: string,
  externalIds: string[],
): Promise<ListingFetchResult[]> {
  const results: ListingFetchResult[] = [];
  for (let start = 0; start < externalIds.length; start += BULK_SIZE) {
    const chunk = externalIds.slice(start, start + BULK_SIZE);
    const url = `${ML_API_BASE}/items/bulk?ids=${chunk.map(encodeURIComponent).join(",")}`;
    const parsed = bulkSchema.safeParse(await getJson(fetchFn, url, accessToken));
    if (!parsed.success) throw new MarketplaceApiError("Unexpected items bulk response.", 200);

    const byId = new Map(parsed.data.map((entry, index) => [entry.id ?? chunk[index], entry]));
    for (const id of chunk) {
      const entry = byId.get(id);
      if (!entry) {
        results.push({ externalId: id, error: "Não retornado pelo Mercado Livre." });
      } else if (entry.status_code !== 200) {
        const message =
          (entry.body as { message?: string } | null)?.message ?? `HTTP ${entry.status_code}`;
        results.push({ externalId: id, error: message });
      } else {
        try {
          results.push({ externalId: id, listing: normalizeItem(entry.body) });
        } catch {
          results.push({ externalId: id, error: "Resposta do anúncio em formato inesperado." });
        }
      }
    }
  }
  return results;
}
