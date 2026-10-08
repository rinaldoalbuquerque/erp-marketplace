import { isValidGtin } from "./gtin";
import type { VariationAttribute } from "./schemas";

// Builds ERP products/SKUs proposals from imported marketplace listings, for
// the owner to review before anything is created (pure: no database).
//
// Rules (approved plan):
// - one ERP SKU per distinct marketplace SKU code (same code in several
//   listings -> one SKU linked to all of them);
// - product = User Products family (members become the product's SKUs);
//   without family, each SKU is its own product;
// - EAN only when every listing of the SKU agrees (and the check digit is valid);
// - initial stock = highest available quantity among the SKU's listings
//   (summing would count the same goods twice);
// - listings without a marketplace SKU are not created (listed for review);
// - codes that already exist in the ERP are skipped.

export type SourceAttribute = {
  id?: string | null;
  name?: string | null;
  value_name?: string | null;
};

export type SourceVariation = {
  variationId: string;
  sellerSku: string | null;
  attributes: VariationAttribute[];
  availableQuantity: number | null;
};

export type SourceListing = {
  listingId: string;
  externalId: string;
  title: string;
  permalink: string | null;
  familyId: string | null;
  familyName: string | null;
  sellerSku: string | null;
  availableQuantity: number | null;
  attributes: SourceAttribute[];
  variations: SourceVariation[];
};

export type ProposalWarning = "ean_conflict" | "ean_invalid" | "stock_conflict" | "invalid_code";

export const WARNING_LABELS: Record<ProposalWarning, string> = {
  ean_conflict: "EAN diferente entre os anúncios (ficou vazio)",
  ean_invalid: "EAN do anúncio é inválido (ficou vazio)",
  stock_conflict: "Estoque diferente entre os anúncios (usado o maior)",
  invalid_code: "Código do SKU fora do padrão do ERP (não pode ser criado)",
};

export type ProposedSku = {
  code: string;
  ean: string | null;
  variation: VariationAttribute[] | null;
  weightGrams: number | null;
  heightCm: number | null;
  widthCm: number | null;
  lengthCm: number | null;
  initialStock: number | null;
  listingIds: string[];
  externalIds: string[];
  warnings: ProposalWarning[];
  /** Can't be created as is (shown, never selectable). */
  blocked: boolean;
};

export type ProposedProduct = {
  key: string;
  name: string;
  brand: string | null;
  skus: ProposedSku[];
};

export type ListingWithoutSku = {
  listingId: string;
  externalId: string;
  title: string;
  permalink: string | null;
  reason: "no_sku" | "variations_without_sku";
};

export type Proposal = {
  products: ProposedProduct[];
  withoutSku: ListingWithoutSku[];
  /** Marketplace SKU codes that already exist in the ERP (auto-match links them). */
  existingCodes: string[];
};

const SKU_CODE = /^[A-Z0-9][A-Z0-9._\-/]*$/;
export const normalizeCode = (code: string) => code.trim().toUpperCase();

/** "992 g" -> 992, "1,5 kg" -> 1500. Null when not understood. */
export function parseWeightGrams(value: string | null | undefined): number | null {
  const match = value?.trim().match(/^(\d+(?:[.,]\d+)?)\s*(g|kg)$/i);
  if (!match) return null;
  const amount = Number((match[1] ?? "").replace(",", "."));
  const grams = (match[2] ?? "").toLowerCase() === "kg" ? amount * 1000 : amount;
  return grams > 0 ? Math.round(grams) : null;
}

/** "10 cm" -> 10, "15 mm" -> 2, "1,2 m" -> 120 (whole cm, at least 1). */
export function parseLengthCm(value: string | null | undefined): number | null {
  const match = value?.trim().match(/^(\d+(?:[.,]\d+)?)\s*(mm|cm|m)$/i);
  if (!match) return null;
  const amount = Number((match[1] ?? "").replace(",", "."));
  const unit = (match[2] ?? "").toLowerCase();
  const cm = unit === "mm" ? amount / 10 : unit === "m" ? amount * 100 : amount;
  return cm > 0 ? Math.max(1, Math.round(cm)) : null;
}

const attributeValue = (attributes: SourceAttribute[], id: string) =>
  attributes.find((attribute) => attribute.id === id)?.value_name?.trim() || null;

/** Attributes that never describe a variation (identifiers, package, condition...). */
const NON_VARIATION_ATTRIBUTES = new Set([
  "SELLER_SKU",
  "GTIN",
  "BRAND",
  "MODEL",
  "ITEM_CONDITION",
  "SELLER_PACKAGE_HEIGHT",
  "SELLER_PACKAGE_WIDTH",
  "SELLER_PACKAGE_LENGTH",
  "SELLER_PACKAGE_WEIGHT",
  "SELLER_PACKAGE_TYPE",
  "PACKAGE_WEIGHT",
  "PACKAGE_LENGTH",
  "PACKAGE_WIDTH",
  "PACKAGE_HEIGHT",
]);

type Unit = {
  code: string;
  listing: SourceListing;
  ownVariation: VariationAttribute[] | null;
  attributes: SourceAttribute[];
  availableQuantity: number | null;
};

const unique = <T>(values: T[]) => [...new Set(values)];

/** Attributes whose value changes between the SKUs of a family become the variation. */
function familyVariations(units: Unit[][]): Map<Unit[], VariationAttribute[]> {
  const result = new Map<Unit[], VariationAttribute[]>();
  if (units.length < 2) return result;
  const ids = unique(
    units.flatMap((group) =>
      (group[0]?.attributes ?? [])
        .map((attribute) => attribute.id)
        .filter((id): id is string => Boolean(id) && !NON_VARIATION_ATTRIBUTES.has(id as string)),
    ),
  );
  const differing = ids.filter(
    (id) => unique(units.map((group) => attributeValue(group[0]?.attributes ?? [], id))).length > 1,
  );
  for (const group of units) {
    const attributes = group[0]?.attributes ?? [];
    const variation = differing
      .map((id) => {
        const attribute = attributes.find((item) => item.id === id);
        return attribute?.name && attribute.value_name
          ? { name: attribute.name.slice(0, 40), value: attribute.value_name.slice(0, 60) }
          : null;
      })
      .filter((item): item is VariationAttribute => item !== null)
      .slice(0, 3);
    if (variation.length) result.set(group, variation);
  }
  return result;
}

export function buildProposal(listings: SourceListing[], existingCodes: Set<string>): Proposal {
  const withoutSku: ListingWithoutSku[] = [];
  const units: Unit[] = [];

  for (const listing of listings) {
    if (listing.variations.length > 0) {
      let missing = false;
      for (const variation of listing.variations) {
        if (!variation.sellerSku?.trim()) {
          missing = true;
          continue;
        }
        units.push({
          code: normalizeCode(variation.sellerSku),
          listing,
          ownVariation: variation.attributes.length ? variation.attributes.slice(0, 3) : null,
          attributes: listing.attributes,
          availableQuantity: variation.availableQuantity,
        });
      }
      if (missing) {
        withoutSku.push({
          listingId: listing.listingId,
          externalId: listing.externalId,
          title: listing.title,
          permalink: listing.permalink,
          reason: "variations_without_sku",
        });
      }
    } else if (listing.sellerSku?.trim()) {
      units.push({
        code: normalizeCode(listing.sellerSku),
        listing,
        ownVariation: null,
        attributes: listing.attributes,
        availableQuantity: listing.availableQuantity,
      });
    } else {
      withoutSku.push({
        listingId: listing.listingId,
        externalId: listing.externalId,
        title: listing.title,
        permalink: listing.permalink,
        reason: "no_sku",
      });
    }
  }

  // One SKU per code.
  const byCode = new Map<string, Unit[]>();
  for (const unit of units) byCode.set(unit.code, [...(byCode.get(unit.code) ?? []), unit]);

  const existing: string[] = [];
  const productGroups = new Map<string, Unit[][]>();
  for (const [code, group] of byCode) {
    if (existingCodes.has(code)) {
      existing.push(code);
      continue;
    }
    const first = group[0] as Unit;
    const key = first.listing.familyId ? `family:${first.listing.familyId}` : `sku:${code}`;
    productGroups.set(key, [...(productGroups.get(key) ?? []), group]);
  }

  const products: ProposedProduct[] = [];
  for (const [key, groups] of productGroups) {
    const variations = familyVariations(groups);
    const first = (groups[0] as Unit[])[0] as Unit;
    const skus = groups.map((group): ProposedSku => {
      const lead = group[0] as Unit;
      const warnings: ProposalWarning[] = [];

      const eans = unique(
        group.map((unit) => attributeValue(unit.attributes, "GTIN")).filter(Boolean) as string[],
      );
      let ean: string | null = null;
      if (eans.length > 1) warnings.push("ean_conflict");
      else if (eans.length === 1) {
        const digits = (eans[0] as string).replace(/\D/g, "");
        if (isValidGtin(digits)) ean = digits;
        else warnings.push("ean_invalid");
      }

      const stocks = group
        .map((unit) => unit.availableQuantity)
        .filter((value): value is number => typeof value === "number");
      if (unique(stocks).length > 1) warnings.push("stock_conflict");
      const blocked = lead.code.length > 60 || !SKU_CODE.test(lead.code);
      if (blocked) warnings.push("invalid_code");

      return {
        code: lead.code,
        ean,
        variation: lead.ownVariation ?? variations.get(group) ?? null,
        weightGrams: parseWeightGrams(attributeValue(lead.attributes, "SELLER_PACKAGE_WEIGHT")),
        heightCm: parseLengthCm(attributeValue(lead.attributes, "SELLER_PACKAGE_HEIGHT")),
        widthCm: parseLengthCm(attributeValue(lead.attributes, "SELLER_PACKAGE_WIDTH")),
        lengthCm: parseLengthCm(attributeValue(lead.attributes, "SELLER_PACKAGE_LENGTH")),
        initialStock: stocks.length ? Math.max(...stocks) : null,
        listingIds: unique(group.map((unit) => unit.listing.listingId)),
        externalIds: unique(group.map((unit) => unit.listing.externalId)),
        warnings,
        blocked,
      };
    });
    products.push({
      key,
      name: (first.listing.familyName ?? first.listing.title).trim().slice(0, 200),
      brand: attributeValue(first.attributes, "BRAND")?.slice(0, 80) ?? null,
      skus: skus.sort((a, b) => a.code.localeCompare(b.code)),
    });
  }

  products.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return { products, withoutSku, existingCodes: existing.sort() };
}
