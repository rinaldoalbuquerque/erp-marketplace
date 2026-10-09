import { z } from "zod";

import { emptyListing, type CanonicalListing } from "@/domain/listings/canonical";

import type { ListingForCopy } from "../types";
import { getListingForEdit } from "./editing";
import type { FetchFn } from "./http";

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
