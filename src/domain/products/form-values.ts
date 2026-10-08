import { centsToInput } from "./money";
import type { VariationAttribute } from "./schemas";

/** Saved SKU -> string values for the edit form (inverse of skuSchema). */
export function skuToFormValues(sku: {
  code: string;
  ean: string | null;
  variation: unknown;
  ncm: string | null;
  cest: string | null;
  origin: number | null;
  unit: string;
  defaultCfop: string | null;
  weightGrams: number | null;
  heightCm: number | null;
  widthCm: number | null;
  lengthCm: number | null;
  location: string | null;
  costCents: number | null;
}): Record<string, string> {
  const variation = Array.isArray(sku.variation) ? (sku.variation as VariationAttribute[]) : [];
  const text = (value: string | number | null) => (value === null ? "" : String(value));
  return {
    code: sku.code,
    ean: text(sku.ean),
    ...Object.fromEntries(
      [1, 2, 3].flatMap((slot) => [
        [`variationName${slot}`, variation[slot - 1]?.name ?? ""],
        [`variationValue${slot}`, variation[slot - 1]?.value ?? ""],
      ]),
    ),
    ncm: text(sku.ncm),
    cest: text(sku.cest),
    origin: text(sku.origin),
    unit: sku.unit,
    defaultCfop: text(sku.defaultCfop),
    weightGrams: text(sku.weightGrams),
    heightCm: text(sku.heightCm),
    widthCm: text(sku.widthCm),
    lengthCm: text(sku.lengthCm),
    location: text(sku.location),
    cost: centsToInput(sku.costCents),
  };
}
