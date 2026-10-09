import { z } from "zod";

import type { AttributeValue } from "./attributes";

// Canonical listing (CLAUDE.md: "Modelo canônico de anúncio"): a marketplace-
// neutral listing used by drafts now and by copy / replicate / migrate (2D).
// Connectors convert it to each marketplace's format when publishing.
// Attribute ids are the category attribute ids of the target marketplace
// (e.g. ML "BRAND", "GTIN"); mapping between marketplaces comes with Shopee.

/** Listing types offered on the form (ML MLB: Clássico / Premium). */
export const LISTING_TYPES = {
  gold_special: "Clássico",
  gold_pro: "Premium",
} as const;
export type ListingTypeId = keyof typeof LISTING_TYPES;
export const DEFAULT_LISTING_TYPE: ListingTypeId = "gold_special";

export const LISTING_CONDITIONS = { new: "Novo", used: "Usado" } as const;

const attributeValueSchema = z.object({
  id: z.string().min(1).max(100),
  valueId: z.string().max(100).nullable(),
  valueName: z.string().max(500).nullable(),
});

const pictureSchema = z.object({
  /** Marketplace picture id (after upload) */
  id: z.string().min(1).max(200),
  /** Preview URL returned by the marketplace, when known */
  url: z.string().url().max(1000).nullable(),
});

export const canonicalListingSchema = z.object({
  /** User Products: generic name of the family; the marketplace builds the title. */
  familyName: z.string().trim().max(200),
  /** Traditional listings: the title itself. */
  title: z.string().trim().max(200),
  description: z.string().max(50_000),
  categoryId: z.string().trim().max(50).nullable(),
  /** Display name of the category (shown on the form; not sent). */
  categoryName: z.string().max(300).nullable().default(null),
  condition: z.enum(["new", "used"]),
  listingTypeId: z.enum(["gold_special", "gold_pro"]),
  priceCents: z.number().int().positive().max(1_000_000_000).nullable(),
  availableQuantity: z.number().int().min(0).max(1_000_000),
  pictures: z.array(pictureSchema).max(12),
  attributes: z.array(attributeValueSchema).max(300),
  warranty: z.object({
    /** e.g. "Garantia do vendedor", "Sem garantia" */
    type: z.string().trim().max(100).nullable(),
    /** e.g. "90 dias" */
    time: z.string().trim().max(100).nullable(),
  }),
});

export type CanonicalListing = z.infer<typeof canonicalListingSchema>;

export function emptyListing(): CanonicalListing {
  return {
    familyName: "",
    title: "",
    description: "",
    categoryId: null,
    categoryName: null,
    condition: "new",
    listingTypeId: DEFAULT_LISTING_TYPE,
    priceCents: null,
    availableQuantity: 0,
    pictures: [],
    attributes: [],
    warranty: { type: null, time: null },
  };
}

/** ERP data used to start a listing from a SKU. */
export type SkuSeed = {
  productName: string;
  productDescription: string | null;
  brand: string | null;
  ean: string | null;
  stockOnHand: number;
};

// ML attribute ids used to pre-fill (documented in the publishing examples:
// https://developers.mercadolivre.com.br/pt_br/preco-variacao — BRAND, GTIN).
const BRAND = "BRAND";
const GTIN = "GTIN";

/** A new listing pre-filled from a SKU (name, description, brand, EAN, stock). */
export function listingFromSku(seed: SkuSeed): CanonicalListing {
  const attributes: AttributeValue[] = [];
  if (seed.brand) attributes.push({ id: BRAND, valueId: null, valueName: seed.brand });
  if (seed.ean) attributes.push({ id: GTIN, valueId: null, valueName: seed.ean });
  return {
    ...emptyListing(),
    familyName: seed.productName.slice(0, 200),
    title: seed.productName.slice(0, 200),
    description: seed.productDescription ?? "",
    availableQuantity: Math.max(0, seed.stockOnHand),
    attributes,
  };
}

export type PublishModel = "user_products" | "traditional";

/** What is still missing before asking the marketplace to validate (pt-BR, for the form). */
export function missingForPublish(listing: CanonicalListing, model: PublishModel): string[] {
  const missing: string[] = [];
  if (model === "user_products" && !listing.familyName) missing.push("Nome da família");
  if (model === "traditional" && !listing.title) missing.push("Título");
  if (!listing.categoryId) missing.push("Categoria");
  if (listing.priceCents === null) missing.push("Preço");
  if (listing.pictures.length === 0) missing.push("Ao menos uma foto");
  return missing;
}
