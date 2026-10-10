// Form model of the listing screen (pure, no React): the listing is edited as
// "rows" (one per variant; a simple listing is one row) and converted back to
// the canonical listing when saving.

import type { AttributeValue } from "@/domain/listings/attributes";
import {
  DEFAULT_LISTING_TYPE,
  type CanonicalListing,
  type CanonicalVariant,
  type ListingTypeId,
} from "@/domain/listings/canonical";
import { centsToInput, parseBrlToCents } from "@/domain/products/money";

export const SIMPLE_KEY = "single";

/** Attributes edited in the rows, not in the technical sheet. */
export const ROW_ATTRIBUTE_IDS = new Set([
  "GTIN",
  "EMPTY_GTIN_REASON",
  "SELLER_SKU",
  "SELLER_PACKAGE_WEIGHT",
  "SELLER_PACKAGE_HEIGHT",
  "SELLER_PACKAGE_WIDTH",
  "SELLER_PACKAGE_LENGTH",
]);

export type Row = {
  key: string;
  /** Values of the varying attributes. */
  attributes: AttributeValue[];
  skuId: string | null;
  skuCode: string;
  gtin: string;
  /** "Não tenho agora": reason sent instead of the barcode. */
  emptyGtinReason: string | null;
  quantity: string;
  weight: string;
  height: string;
  width: string;
  length: string;
  pictures: CanonicalListing["pictures"];
  price: string;
  listingTypeId: ListingTypeId;
  warrantyType: string;
  warrantyTime: string;
  /** Own description instead of the shared one. */
  ownDescription: boolean;
  description: string;
};

const text = (value: number | null) => (value === null ? "" : String(value));
const attr = (listing: CanonicalListing, id: string) =>
  listing.attributes.find((attribute) => attribute.id === id)?.valueName ?? null;

/** Rows of a listing (one for a simple listing). */
export function rowsFromListing(listing: CanonicalListing, simpleSkuCode: string | null): Row[] {
  if (listing.variants.length === 0) {
    return [
      {
        key: SIMPLE_KEY,
        attributes: [],
        skuId: null,
        skuCode: listing.skuCode ?? simpleSkuCode ?? attr(listing, "SELLER_SKU") ?? "",
        gtin: attr(listing, "GTIN") ?? "",
        emptyGtinReason: attr(listing, "EMPTY_GTIN_REASON"),
        quantity: String(listing.availableQuantity),
        weight: text(listing.package.weightG),
        height: text(listing.package.heightCm),
        width: text(listing.package.widthCm),
        length: text(listing.package.lengthCm),
        pictures: listing.pictures,
        price: centsToInput(listing.priceCents),
        listingTypeId: listing.listingTypeId,
        warrantyType: listing.warranty.type ?? "",
        warrantyTime: listing.warranty.time ?? "",
        ownDescription: false,
        description: listing.description,
      },
    ];
  }
  return listing.variants.map((variant) => {
    const pkg = variant.package;
    return {
      key: variant.key,
      attributes: variant.attributes,
      skuId: variant.skuId,
      skuCode: variant.skuCode ?? variant.sellerSku ?? "",
      gtin: variant.gtin ?? "",
      emptyGtinReason: variant.emptyGtinReason,
      quantity: String(variant.availableQuantity),
      weight: text(pkg.weightG ?? listing.package.weightG),
      height: text(pkg.heightCm ?? listing.package.heightCm),
      width: text(pkg.widthCm ?? listing.package.widthCm),
      length: text(pkg.lengthCm ?? listing.package.lengthCm),
      pictures: variant.pictures.length ? variant.pictures : listing.pictures,
      price: centsToInput(variant.priceCents ?? listing.priceCents),
      listingTypeId: variant.listingTypeId ?? listing.listingTypeId,
      warrantyType: (variant.warranty ?? listing.warranty).type ?? "",
      warrantyTime: (variant.warranty ?? listing.warranty).time ?? "",
      ownDescription: variant.description !== null,
      description: variant.description ?? listing.description,
    };
  });
}

/** A new row, copying the sale data of a template row (price, type, warranty, package). */
export function newRow(key: string, attributes: AttributeValue[], template?: Row): Row {
  return {
    key,
    attributes,
    skuId: null,
    skuCode: "",
    gtin: "",
    emptyGtinReason: null,
    quantity: template?.quantity ?? "0",
    weight: template?.weight ?? "",
    height: template?.height ?? "",
    width: template?.width ?? "",
    length: template?.length ?? "",
    pictures: [],
    price: template?.price ?? "",
    listingTypeId: template?.listingTypeId ?? DEFAULT_LISTING_TYPE,
    warrantyType: template?.warrantyType ?? "",
    warrantyTime: template?.warrantyTime ?? "",
    ownDescription: false,
    description: "",
  };
}

/** Key of a combination of values (to keep a row when the options change). */
export function comboKey(attributes: AttributeValue[], ids: string[]): string {
  return ids
    .map(
      (id) => attributes.find((attribute) => attribute.id === id)?.valueName?.toLowerCase() ?? "",
    )
    .join("|");
}

/** All combinations of the chosen options (e.g. 2 colors × 3 sizes = 6). */
export function combinations(
  ids: string[],
  options: Record<string, AttributeValue[]>,
): AttributeValue[][] {
  return ids
    .reduce<AttributeValue[][]>(
      (combos, id) =>
        combos.flatMap((combo) => (options[id] ?? []).map((option) => [...combo, option])),
      [[]],
    )
    .filter((combo) => combo.length === ids.length && ids.length > 0);
}

/** Rows for the chosen combinations, keeping the rows that already existed. */
export function syncRows(rows: Row[], ids: string[], combos: AttributeValue[][]): Row[] {
  const existing = new Map(rows.map((row) => [comboKey(row.attributes, ids), row]));
  const template = rows[0];
  return combos.map((combo, index) => {
    const found = existing.get(comboKey(combo, ids));
    return found
      ? { ...found, attributes: combo }
      : newRow(`n${Date.now().toString(36)}${index}`, combo, template);
  });
}

type Shared = Pick<
  CanonicalListing,
  "familyName" | "title" | "categoryId" | "categoryName" | "condition" | "attributes"
> & { description: string };

export type Built = { listing: CanonicalListing } | { errors: Record<string, string> };

function positive(value: string): number | null | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^\d+$/.test(trimmed) && Number(trimmed) > 0 ? Number(trimmed) : "invalid";
}

/** Rows (+ shared data) -> canonical listing, or the field errors. */
export function listingFromRows(
  shared: Shared,
  kind: "simple" | "variants",
  variationIds: string[],
  rows: Row[],
): Built {
  const errors: Record<string, string> = {};
  const parsed = rows.map((row) => {
    const price = row.price.trim() ? parseBrlToCents(row.price) : null;
    if (row.price.trim() && (price === null || price <= 0)) {
      errors[`row.${row.key}.price`] = "Preço inválido";
    }
    const quantity = Number(row.quantity);
    if (!Number.isInteger(quantity) || quantity < 0) {
      errors[`row.${row.key}.quantity`] = "Quantidade inválida";
    }
    const pkg = {
      weightG: positive(row.weight),
      heightCm: positive(row.height),
      widthCm: positive(row.width),
      lengthCm: positive(row.length),
    };
    for (const [field, value] of Object.entries(pkg)) {
      if (value === "invalid") errors[`row.${row.key}.${field}`] = "Número inteiro";
    }
    return { row, price, quantity, pkg: pkg as CanonicalListing["package"] };
  });
  if (Object.keys(errors).length) return { errors };

  const first = parsed[0]!;
  const warranty = (row: Row) => ({
    type: row.warrantyType.trim() || null,
    time: row.warrantyTime.trim() || null,
  });
  const sheet = shared.attributes.filter((attribute) => !ROW_ATTRIBUTE_IDS.has(attribute.id));
  const base: CanonicalListing = {
    familyName: shared.familyName,
    title: shared.title,
    description: shared.description,
    categoryId: shared.categoryId,
    categoryName: shared.categoryName,
    condition: shared.condition,
    listingTypeId: first.row.listingTypeId,
    priceCents: first.price,
    availableQuantity: first.quantity,
    pictures: first.row.pictures,
    attributes: sheet,
    warranty: warranty(first.row),
    package: first.pkg,
    skuCode: null,
    variationAttributeIds: [],
    variants: [],
  };

  if (kind === "simple") {
    const own: AttributeValue[] = [];
    if (first.row.emptyGtinReason !== null) {
      own.push({ id: "EMPTY_GTIN_REASON", valueId: null, valueName: first.row.emptyGtinReason });
    } else if (first.row.gtin.trim()) {
      own.push({ id: "GTIN", valueId: null, valueName: first.row.gtin.trim() });
    }
    // The typed code is also the seller code shown on the marketplace (SELLER_SKU).
    if (first.row.skuCode.trim()) {
      own.push({
        id: "SELLER_SKU",
        valueId: null,
        valueName: first.row.skuCode.trim().toUpperCase(),
      });
    }
    return {
      listing: {
        ...base,
        attributes: [...sheet, ...own],
        skuCode: first.row.skuCode.trim() || null,
      },
    };
  }

  const variants: CanonicalVariant[] = parsed.map(({ row, price, quantity, pkg }) => ({
    key: row.key,
    attributes: row.attributes.filter((attribute) => variationIds.includes(attribute.id)),
    priceCents: price,
    availableQuantity: quantity,
    pictures: row.pictures,
    gtin: row.emptyGtinReason !== null ? null : row.gtin.trim() || null,
    emptyGtinReason: row.emptyGtinReason,
    sellerSku: row.skuCode.trim() ? row.skuCode.trim().toUpperCase() : null,
    skuId: row.skuId,
    skuCode: row.skuCode.trim() || null,
    listingTypeId: row.listingTypeId,
    warranty: warranty(row),
    description: row.ownDescription ? row.description : null,
    package: pkg,
  }));
  return { listing: { ...base, pictures: [], variationAttributeIds: variationIds, variants } };
}
