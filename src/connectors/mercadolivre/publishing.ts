import { z } from "zod";

import type { CanonicalListing, PublishModel } from "@/domain/listings/canonical";

import {
  MarketplaceApiError,
  type CategorySuggestion,
  type FeeQuote,
  type MarketplaceListing,
  type UploadedPicture,
} from "../types";
import { bearer, failure } from "./editing";
import { ML_API_BASE, mlFetch, type FetchFn } from "./http";
import { getJson, normalizeItem, toCents } from "./items";

// Creating listings (Phase 2C).
// - Category predictor: GET /sites/MLB/domain_discovery/search?q=&limit=
//   https://developers.mercadolivre.com.br/pt_br/categorizacao-de-produtos
// - Pictures: POST /pictures/items/upload (multipart "file", up to 10 MB) -> { id, variations[] }
//   https://developers.mercadolivre.com.br/pt_br/trabalhar-com-imagens
// - Fees: GET /sites/MLB/listing_prices?price=&category_id=&listing_type_id=&currency_id=
//   https://developers.mercadolivre.com.br/pt_br/comissao-por-vender
// - Validate: POST /items/validate (204 = ok, 400 = causes)
//   https://developers.mercadolivre.com.br/pt_br/validador-de-publicacoes
// - Publish: POST /items. User Products sellers send family_name and NO title
//   (ML builds the title); traditional sellers send title.
//   https://developers.mercadolivre.com.br/pt_br/preco-variacao
//   https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos

const SITE = "MLB";
const CURRENCY = "BRL";
export const SUGGESTION_LIMIT = 3; // the docs recommend limit=3

const suggestionSchema = z.array(
  z
    .object({
      category_id: z.string(),
      category_name: z.string().nullish(),
      domain_name: z.string().nullish(),
      attributes: z
        .array(
          z
            .object({
              id: z.string(),
              value_id: z.string().nullish(),
              value_name: z.string().nullish(),
            })
            .passthrough(),
        )
        .nullish(),
    })
    .passthrough(),
);

export async function suggestCategories(
  fetchFn: FetchFn,
  accessToken: string,
  query: string,
): Promise<CategorySuggestion[]> {
  const text = query.trim();
  if (!text) return [];
  const params = new URLSearchParams({ q: text, limit: String(SUGGESTION_LIMIT) });
  const body = await getJson(
    fetchFn,
    `${ML_API_BASE}/sites/${SITE}/domain_discovery/search?${params}`,
    accessToken,
  );
  const parsed = suggestionSchema.safeParse(body);
  if (!parsed.success) throw new MarketplaceApiError("Unexpected category suggestion.", 200);
  return parsed.data.map((row) => ({
    categoryId: row.category_id,
    categoryName: row.category_name ?? row.category_id,
    domainName: row.domain_name ?? null,
    attributes: (row.attributes ?? []).map((attribute) => ({
      id: attribute.id,
      valueId: attribute.value_id ?? null,
      valueName: attribute.value_name ?? null,
    })),
  }));
}

const pictureSchema = z
  .object({
    id: z.string(),
    variations: z
      .array(
        z
          .object({
            size: z.string().nullish(),
            url: z.string().nullish(),
            secure_url: z.string().nullish(),
          })
          .passthrough(),
      )
      .nullish(),
  })
  .passthrough();

export async function uploadPicture(
  fetchFn: FetchFn,
  accessToken: string,
  file: Blob,
  filename: string,
): Promise<UploadedPicture> {
  const form = new FormData();
  form.append("file", file, filename);
  const response = await mlFetch(fetchFn, `${ML_API_BASE}/pictures/items/upload`, {
    method: "POST",
    headers: bearer(accessToken),
    body: form,
  });
  if (!response.ok) await failure(response, "Picture upload");
  const parsed = pictureSchema.safeParse(await response.json());
  if (!parsed.success) throw new MarketplaceApiError("Unexpected picture response.", 200);
  // Largest version first in the docs example; prefer https.
  const first = parsed.data.variations?.[0];
  return { id: parsed.data.id, url: first?.secure_url ?? first?.url ?? null };
}

const feeSchema = z
  .object({
    listing_type_id: z.string(),
    listing_type_name: z.string().nullish(),
    sale_fee_amount: z.number().nullish(),
    sale_fee_details: z
      .object({ percentage_fee: z.number().nullish(), fixed_fee: z.number().nullish() })
      .passthrough()
      .nullish(),
  })
  .passthrough();

export async function quoteFees(
  fetchFn: FetchFn,
  accessToken: string,
  input: { categoryId: string; priceCents: number; listingTypeIds: string[] },
): Promise<FeeQuote[]> {
  const quotes: FeeQuote[] = [];
  for (const listingTypeId of input.listingTypeIds) {
    const params = new URLSearchParams({
      price: (input.priceCents / 100).toFixed(2),
      currency_id: CURRENCY,
      category_id: input.categoryId,
      listing_type_id: listingTypeId,
    });
    const body = await getJson(
      fetchFn,
      `${ML_API_BASE}/sites/${SITE}/listing_prices?${params}`,
      accessToken,
    );
    // The docs show an array (sometimes nested); accept an object too.
    const rows = (Array.isArray(body) ? body.flat(2) : [body]) as unknown[];
    for (const row of rows) {
      const parsed = feeSchema.safeParse(row);
      if (!parsed.success || parsed.data.listing_type_id !== listingTypeId) continue;
      quotes.push({
        listingTypeId,
        listingTypeName: parsed.data.listing_type_name ?? null,
        saleFeeCents: toCents(parsed.data.sale_fee_amount) ?? 0,
        percentageFee: parsed.data.sale_fee_details?.percentage_fee ?? null,
        fixedFeeCents: toCents(parsed.data.sale_fee_details?.fixed_fee),
      });
      break;
    }
  }
  return quotes;
}

/** Canonical listing -> ML POST /items body. */
export function toPublishBody(listing: CanonicalListing, model: PublishModel) {
  if (!listing.categoryId || listing.priceCents === null) {
    throw new RangeError("Listing needs category and price before publishing.");
  }
  const saleTerms = [
    ...(listing.warranty.type ? [{ id: "WARRANTY_TYPE", value_name: listing.warranty.type }] : []),
    ...(listing.warranty.time ? [{ id: "WARRANTY_TIME", value_name: listing.warranty.time }] : []),
  ];
  return {
    ...(model === "user_products" ? { family_name: listing.familyName } : { title: listing.title }),
    category_id: listing.categoryId,
    price: listing.priceCents / 100,
    currency_id: CURRENCY,
    available_quantity: listing.availableQuantity,
    buying_mode: "buy_it_now",
    listing_type_id: listing.listingTypeId,
    condition: listing.condition,
    // By id when known; otherwise by URL ("source", documented for POST /items).
    pictures: listing.pictures.map((picture) =>
      picture.id ? { id: picture.id } : { source: picture.url },
    ),
    attributes: listing.attributes.map((attribute) => ({
      id: attribute.id,
      ...(attribute.valueId ? { value_id: attribute.valueId } : {}),
      ...(attribute.valueName !== null ? { value_name: attribute.valueName } : {}),
    })),
    ...(saleTerms.length ? { sale_terms: saleTerms } : {}),
  };
}

const json = (accessToken: string) => ({
  ...bearer(accessToken),
  "content-type": "application/json",
});

export async function validateListing(
  fetchFn: FetchFn,
  accessToken: string,
  listing: CanonicalListing,
  model: PublishModel,
): Promise<void> {
  const response = await mlFetch(fetchFn, `${ML_API_BASE}/items/validate`, {
    method: "POST",
    headers: json(accessToken),
    body: JSON.stringify(toPublishBody(listing, model)),
  });
  if (!response.ok) await failure(response, "Listing validation");
}

export async function publishListing(
  fetchFn: FetchFn,
  accessToken: string,
  listing: CanonicalListing,
  model: PublishModel,
): Promise<MarketplaceListing> {
  // Not retried automatically (unlike mlFetch): a retry after a lost answer
  // could create the listing twice. The caller marks the draft for checking.
  let response: Response;
  try {
    response = await fetchFn(`${ML_API_BASE}/items`, {
      method: "POST",
      headers: json(accessToken),
      body: JSON.stringify(toPublishBody(listing, model)),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new MarketplaceApiError(
      `Publish: no answer (${error instanceof Error ? error.name : "network error"}).`,
      null,
    );
  }
  if (!response.ok) await failure(response, "Publish");
  return normalizeItem(await response.json());
}
