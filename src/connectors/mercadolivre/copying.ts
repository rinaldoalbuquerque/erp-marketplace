import { z } from "zod";

import { emptyListing, type CanonicalListing } from "@/domain/listings/canonical";

import type { ListingForCopy } from "../types";
import { failure, getListingForEdit } from "./editing";
import { ML_API_BASE, mlFetch, type FetchFn } from "./http";

// Reading any listing (own or another seller's) into the canonical model, for
// copy / migrate / replicate (Phase 2D).
// - GET /items/{id} is public; some fields only come with the owner's token
//   (available_quantity, sold_quantity...): https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos
// - Pictures can be sent back by URL ("source") when publishing (same page);
//   own pictures can also go by id.
// - Warranty: sale_terms WARRANTY_TYPE / WARRANTY_TIME (same names as when publishing).

const rawSchema = z
  .object({
    seller_id: z.union([z.number(), z.string()]).transform(String).nullish(),
    pictures: z
      .array(
        z
          .object({
            id: z.string().nullish(),
            secure_url: z.string().nullish(),
            url: z.string().nullish(),
          })
          .passthrough(),
      )
      .nullish(),
    sale_terms: z
      .array(z.object({ id: z.string(), value_name: z.string().nullish() }).passthrough())
      .nullish(),
  })
  .passthrough();

const LISTING_TYPES = new Set(["gold_special", "gold_pro"]);

export async function getListingForCopy(
  fetchFn: FetchFn,
  accessToken: string,
  externalId: string,
): Promise<ListingForCopy> {
  const { listing, attributes, description } = await getListingForEdit(
    fetchFn,
    accessToken,
    externalId,
  );
  const raw = rawSchema.catch({}).parse(listing.raw ?? {});
  const term = (id: string) =>
    raw.sale_terms?.find((saleTerm) => saleTerm.id === id)?.value_name ?? null;

  const canonical: CanonicalListing = {
    ...emptyListing(),
    familyName: listing.familyName ?? listing.title,
    title: listing.title,
    description: description ?? "",
    categoryId: listing.categoryId,
    condition: listing.condition === "used" ? "used" : "new",
    listingTypeId:
      listing.listingTypeId && LISTING_TYPES.has(listing.listingTypeId)
        ? (listing.listingTypeId as CanonicalListing["listingTypeId"])
        : "gold_special",
    priceCents: listing.priceCents,
    availableQuantity: Math.max(0, listing.availableQuantity ?? 0),
    pictures: (raw.pictures ?? [])
      .map((picture) => ({
        id: picture.id ?? null,
        url: picture.secure_url ?? picture.url ?? null,
      }))
      .filter((picture) => picture.id !== null || picture.url !== null)
      .slice(0, 12),
    attributes,
    warranty: { type: term("WARRANTY_TYPE"), time: term("WARRANTY_TIME") },
  };
  return {
    listing: canonical,
    sellerId: raw.seller_id ?? null,
    listingModel: listing.listingModel,
    hasVariations: listing.variations.length > 0,
    permalink: listing.permalink,
    title: listing.title,
  };
}

// Catalog products (pages /p/MLB...) are not listings: GET /items answers 404.
// - GET /products/{id}: documented; buy_box_winner = listing winning the page
//   https://developers.mercadolivre.com.br/pt_br/buscador-de-produtos
//   https://developers.mercadolivre.com.br/pt_br/concorrencia-em-catalogo
// - GET /products/{id}/items: NOT found in the docs pages read; seen working on
//   2026-10-10 (results[].item_id of the sellers on the page). Used only when
//   the product has no buy box winner.
const productSchema = z
  .object({
    buy_box_winner: z.object({ item_id: z.string().nullish() }).passthrough().nullish(),
  })
  .passthrough();
const productItemsSchema = z
  .object({ results: z.array(z.object({ item_id: z.string() }).passthrough()).default([]) })
  .passthrough();

/** Listing to copy for a catalog product id; null when it is not a catalog product. */
export async function resolveCatalogProduct(
  fetchFn: FetchFn,
  accessToken: string,
  productId: string,
): Promise<string | null> {
  const id = encodeURIComponent(productId);
  const headers = { authorization: `Bearer ${accessToken}` };
  const product = await mlFetch(fetchFn, `${ML_API_BASE}/products/${id}`, { headers });
  if (product.status === 404) return null;
  if (!product.ok) await failure(product, "Catalog product");
  const winner = productSchema.catch({}).parse(await product.json()).buy_box_winner?.item_id;
  if (winner) return winner;
  const items = await mlFetch(fetchFn, `${ML_API_BASE}/products/${id}/items`, { headers });
  if (!items.ok) return null;
  return (
    productItemsSchema.catch({ results: [] }).parse(await items.json()).results[0]?.item_id ?? null
  );
}
