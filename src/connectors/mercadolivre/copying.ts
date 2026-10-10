import { z } from "zod";

import { emptyListing, type CanonicalListing } from "@/domain/listings/canonical";

import type { ListingFamily, ListingForCopy } from "../types";
import { failure, getListingForEdit } from "./editing";
import { ML_API_BASE, mlFetch, type FetchFn } from "./http";
import { toCents } from "./items";

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
    // Traditional variations: attribute_combinations, price, picture_ids, SKU
    // (https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos, variations).
    variations: z
      .array(
        z
          .object({
            id: z.union([z.number(), z.string()]).transform(String),
            price: z.number().nullish(),
            available_quantity: z.number().nullish(),
            picture_ids: z.array(z.string()).nullish(),
            seller_custom_field: z.string().nullish(),
            attribute_combinations: z
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
            attributes: z
              .array(z.object({ id: z.string(), value_name: z.string().nullish() }).passthrough())
              .nullish(),
          })
          .passthrough(),
      )
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
  const pictureUrl = new Map(
    (raw.pictures ?? []).map((picture) => [picture.id, picture.secure_url ?? picture.url ?? null]),
  );
  const variations = (raw.variations ?? []).map((variation) => ({
    externalId: variation.id,
    attributes: (variation.attribute_combinations ?? []).map((combination) => ({
      id: combination.id,
      valueId: combination.value_id ?? null,
      valueName: combination.value_name ?? null,
    })),
    priceCents: toCents(variation.price),
    availableQuantity: Math.max(0, variation.available_quantity ?? 0),
    pictures: (variation.picture_ids ?? []).map((id) => ({ id, url: pictureUrl.get(id) ?? null })),
    sellerSku:
      variation.attributes?.find((attribute) => attribute.id === "SELLER_SKU")?.value_name ??
      variation.seller_custom_field ??
      null,
  }));
  return {
    listing: canonical,
    sellerId: raw.seller_id ?? null,
    listingModel: listing.listingModel,
    hasVariations: variations.length > 0,
    variations,
    familyId: listing.familyId,
    permalink: listing.permalink,
    title: listing.title,
  };
}

// Catalog products (pages /p/MLB...). Since 2026-10 the ML API answers 403 to
// any read of another seller's listing (/items, /items/bulk, /user-products,
// public search), even though the docs still call /items public. Catalog
// products are Mercado Livre's own data and stay readable:
// - GET /products/{id}: name, family_name, pictures, attributes, short_description,
//   domain_id (https://developers.mercadolivre.com.br/pt_br/buscador-de-produtos)
// - GET /catalog_domains/{domain_id}/categories -> [{ id, name }]
//   (https://developers.mercadolivre.com.br/pt_br/categorizacao-de-produtos)
// The price is not part of a catalog product: the seller sets it.
const productSchema = z
  .object({
    id: z.string(),
    name: z.string().nullish(),
    family_name: z.string().nullish(),
    domain_id: z.string().nullish(),
    permalink: z.string().nullish(),
    pictures: z
      .array(z.object({ id: z.string().nullish(), url: z.string().nullish() }).passthrough())
      .nullish(),
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
    short_description: z.object({ content: z.string().nullish() }).passthrough().nullish(),
  })
  .passthrough();

const domainCategoriesSchema = z.array(
  z.object({ id: z.string(), name: z.string().nullish() }).passthrough(),
);

/** A catalog product as a listing to copy; null when the id is not a catalog product. */
export async function getCatalogProductForCopy(
  fetchFn: FetchFn,
  accessToken: string,
  productId: string,
): Promise<ListingForCopy | null> {
  const headers = { authorization: `Bearer ${accessToken}` };
  const response = await mlFetch(
    fetchFn,
    `${ML_API_BASE}/products/${encodeURIComponent(productId)}`,
    { headers },
  );
  if (response.status === 404) return null;
  if (!response.ok) await failure(response, "Catalog product");
  const parsed = productSchema.safeParse(await response.json());
  if (!parsed.success) return null;
  const product = parsed.data;

  let categoryId: string | null = null;
  let categoryName: string | null = null;
  if (product.domain_id) {
    const categories = await mlFetch(
      fetchFn,
      `${ML_API_BASE}/catalog_domains/${encodeURIComponent(product.domain_id)}/categories`,
      { headers },
    );
    if (categories.ok) {
      const first = domainCategoriesSchema.catch([]).parse(await categories.json())[0];
      categoryId = first?.id ?? null;
      categoryName = first?.name ?? null;
    }
  }

  const name = product.name ?? product.id;
  return {
    listing: {
      ...emptyListing(),
      familyName: (product.family_name ?? name).replace(/\s+/g, " ").trim().slice(0, 200),
      title: name.slice(0, 200),
      description: product.short_description?.content ?? "",
      categoryId,
      categoryName,
      // Catalog pictures go by URL (their ids belong to the catalog, not to the seller).
      pictures: (product.pictures ?? [])
        .filter((picture) => picture.url)
        .map((picture) => ({ id: null, url: picture.url! }))
        .slice(0, 12),
      attributes: (product.attributes ?? []).map((attribute) => ({
        id: attribute.id,
        valueId: attribute.value_id ?? null,
        valueName: attribute.value_name ?? null,
      })),
    },
    sellerId: null,
    listingModel: "unknown",
    hasVariations: false,
    variations: [],
    familyId: null,
    permalink: product.permalink ?? null,
    title: name,
  };
}

// User Products family: GET /user-products-families/{family_id}
// -> family_name, attributes[] with hierarchy PARENT_PK, child_attributes_ids
// (https://developers.mercadolivre.com.br/pt_br/preco-variacao, "Obter Família").
const familySchema = z
  .object({
    family_id: z.union([z.number(), z.string()]).transform(String),
    family_name: z.string().nullish(),
    attributes: z
      .array(z.object({ id: z.string(), hierarchy: z.string().nullish() }).passthrough())
      .nullish(),
    child_attributes_ids: z.array(z.string()).nullish(),
  })
  .passthrough();

export async function getFamily(
  fetchFn: FetchFn,
  accessToken: string,
  familyId: string,
): Promise<ListingFamily | null> {
  const response = await mlFetch(
    fetchFn,
    `${ML_API_BASE}/user-products-families/${encodeURIComponent(familyId)}`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (response.status === 404) return null;
  if (!response.ok) await failure(response, "Family");
  const parsed = familySchema.safeParse(await response.json());
  if (!parsed.success) return null;
  return {
    familyId: parsed.data.family_id,
    familyName: parsed.data.family_name ?? "",
    childAttributeIds: parsed.data.child_attributes_ids ?? [],
    parentAttributeIds: (parsed.data.attributes ?? [])
      .filter((attribute) => attribute.hierarchy === "PARENT_PK")
      .map((attribute) => attribute.id),
  };
}
