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

const pictureSchema = z
  .object({
    /** Marketplace picture id (after upload, or of the same seller's listing) */
    id: z.string().min(1).max(200).nullable(),
    /** Picture URL: preview, and the source when there is no id (copies from other sellers) */
    url: z.string().url().max(1000).nullable(),
  })
  .refine((picture) => picture.id !== null || picture.url !== null, {
    error: "Foto sem código nem endereço.",
  });

/** Package of the product (used by the marketplace to calculate shipping). */
const packageSchema = z.object({
  weightG: z.number().int().positive().max(1_000_000).nullable(),
  heightCm: z.number().int().positive().max(10_000).nullable(),
  widthCm: z.number().int().positive().max(10_000).nullable(),
  lengthCm: z.number().int().positive().max(10_000).nullable(),
});
export type ListingPackage = z.infer<typeof packageSchema>;
export const EMPTY_PACKAGE: ListingPackage = {
  weightG: null,
  heightCm: null,
  widthCm: null,
  lengthCm: null,
};

const warrantySchema = z.object({
  /** e.g. "Garantia do vendedor", "Sem garantia" */
  type: z.string().trim().max(100).nullable(),
  /** e.g. "90 dias" */
  time: z.string().trim().max(100).nullable(),
});

/**
 * One variant of a listing (e.g. Cor = Azul). On User Products marketplaces each
 * variant is published as its own listing of the same family; fields left empty
 * (price, pictures) use the listing's own.
 */
export const variantSchema = z.object({
  /** Local key (stable while editing; the source variation id for copies). */
  key: z.string().min(1).max(60),
  /** Values of the varying attributes (variationAttributeIds). */
  attributes: z.array(attributeValueSchema).max(10),
  priceCents: z.number().int().positive().max(1_000_000_000).nullable(),
  availableQuantity: z.number().int().min(0).max(1_000_000),
  pictures: z.array(pictureSchema).max(12),
  /** Barcode (EAN/UPC); null with emptyGtinReason when the product has none. */
  gtin: z.string().trim().max(20).nullable(),
  emptyGtinReason: z.string().max(100).nullable(),
  /** Seller code shown on the marketplace (SELLER_SKU). */
  sellerSku: z.string().trim().max(100).nullable(),
  /** ERP SKU the variant sells (linked after publishing). */
  skuId: z.string().uuid().nullable(),
  /** SKU code typed on the form; created in the ERP when publishing if it does not exist. */
  skuCode: z.string().trim().max(60).nullable().default(null),
  /** Per-variant overrides (null = the listing's own). */
  listingTypeId: z.enum(["gold_special", "gold_pro"]).nullable().default(null),
  warranty: warrantySchema.nullable().default(null),
  description: z.string().max(50_000).nullable().default(null),
  package: packageSchema.default(EMPTY_PACKAGE),
});

export type CanonicalVariant = z.infer<typeof variantSchema>;

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
  warranty: warrantySchema,
  package: packageSchema.default(EMPTY_PACKAGE),
  /** Simple listing: SKU code typed on the form (created in the ERP when publishing if new). */
  skuCode: z.string().trim().max(60).nullable().default(null),
  /** Attributes that vary among the variants (e.g. COLOR, SIZE). Empty = simple listing. */
  variationAttributeIds: z.array(z.string().min(1).max(100)).max(5).default([]),
  variants: z.array(variantSchema).max(100).default([]),
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
    package: { ...EMPTY_PACKAGE },
    skuCode: null,
    variationAttributeIds: [],
    variants: [],
  };
}

export function emptyVariant(key: string): CanonicalVariant {
  return {
    key,
    attributes: [],
    priceCents: null,
    availableQuantity: 0,
    pictures: [],
    gtin: null,
    emptyGtinReason: null,
    sellerSku: null,
    skuId: null,
    skuCode: null,
    listingTypeId: null,
    warranty: null,
    description: null,
    package: { ...EMPTY_PACKAGE },
  };
}

const SELLER_SKU = "SELLER_SKU";
const EMPTY_GTIN_REASON = "EMPTY_GTIN_REASON";

/**
 * The single listing published for one variant: the listing's shared data plus
 * the variant's values (attributes, barcode, seller code, price, stock, pictures).
 */
export function variantListing(
  base: CanonicalListing,
  variant: CanonicalVariant,
): CanonicalListing {
  const replaced = new Set([
    ...variant.attributes.map((attribute) => attribute.id),
    GTIN,
    EMPTY_GTIN_REASON,
    SELLER_SKU,
  ]);
  const own: AttributeValue[] = [...variant.attributes];
  if (variant.gtin) own.push({ id: GTIN, valueId: null, valueName: variant.gtin });
  else if (variant.emptyGtinReason) {
    own.push({ id: EMPTY_GTIN_REASON, valueId: null, valueName: variant.emptyGtinReason });
  }
  if (variant.sellerSku) own.push({ id: SELLER_SKU, valueId: null, valueName: variant.sellerSku });
  const pick = <T>(own: T | null, shared: T | null) => (own ?? shared) as T | null;
  return {
    ...base,
    priceCents: variant.priceCents ?? base.priceCents,
    availableQuantity: variant.availableQuantity,
    pictures: variant.pictures.length ? variant.pictures : base.pictures,
    listingTypeId: variant.listingTypeId ?? base.listingTypeId,
    warranty: variant.warranty ?? base.warranty,
    description: variant.description ?? base.description,
    package: {
      weightG: pick(variant.package.weightG, base.package.weightG),
      heightCm: pick(variant.package.heightCm, base.package.heightCm),
      widthCm: pick(variant.package.widthCm, base.package.widthCm),
      lengthCm: pick(variant.package.lengthCm, base.package.lengthCm),
    },
    attributes: [...base.attributes.filter((attribute) => !replaced.has(attribute.id)), ...own],
    variationAttributeIds: [],
    variants: [],
  };
}

/** Text of a variant for messages, e.g. "Azul / M" (falls back to its position). */
export function variantLabel(variant: CanonicalVariant, index: number): string {
  const values = variant.attributes
    .map((attribute) => attribute.valueName)
    .filter((value): value is string => Boolean(value));
  return values.length ? values.join(" / ") : `Variante ${index + 1}`;
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
  if (listing.variants.length === 0) {
    if (listing.priceCents === null) missing.push("Preço");
    if (listing.pictures.length === 0) missing.push("Ao menos uma foto");
    return missing;
  }
  if (model !== "user_products") {
    missing.push("Variantes só podem ser publicadas em contas User Products");
  }
  if (listing.variationAttributeIds.length === 0) missing.push("O que varia entre as variantes");
  const seen = new Map<string, number>();
  listing.variants.forEach((variant, index) => {
    const label = variantLabel(variant, index);
    for (const id of listing.variationAttributeIds) {
      const value = variant.attributes.find((attribute) => attribute.id === id);
      if (!value?.valueName && !value?.valueId) missing.push(`${label}: valor de ${id}`);
    }
    if ((variant.priceCents ?? listing.priceCents) === null) missing.push(`${label}: preço`);
    if (variant.pictures.length === 0 && listing.pictures.length === 0) {
      missing.push(`${label}: ao menos uma foto`);
    }
    const combination = listing.variationAttributeIds
      .map((id) => variant.attributes.find((attribute) => attribute.id === id)?.valueName ?? "")
      .join("|")
      .toLowerCase();
    const twin = seen.get(combination);
    if (twin !== undefined) {
      missing.push(`Variantes ${twin + 1} e ${index + 1} têm os mesmos valores`);
    } else {
      seen.set(combination, index);
    }
  });
  return missing;
}
