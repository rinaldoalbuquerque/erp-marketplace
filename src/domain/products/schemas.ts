import { z } from "zod";

import { isValidCest, isValidCfop, isValidNcm, onlyDigits, UNIT_CODES } from "./fiscal";
import { isValidGtin } from "./gtin";
import { parseBrlToCents } from "./money";

// Validation of the product and SKU forms (browser and server). Inputs arrive as
// strings from FormData; outputs are the values stored in the database.

/** Empty/whitespace -> null, otherwise trimmed text with a max length. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, { error: `${label}: no máximo ${max} caracteres.` })
    .transform((value) => value || null);

/** Optional code made of digits (punctuation ignored), checked by `isValid`. */
const optionalDigits = (isValid: (digits: string) => boolean, message: string) =>
  z.string().transform((value, ctx) => {
    const digits = onlyDigits(value);
    if (!digits) return null;
    if (!isValid(digits)) {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return digits;
  });

/** Optional whole number > 0 (grams, centimeters). */
const optionalPositiveInt = (label: string, max: number) =>
  z.string().transform((value, ctx) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!/^\d+$/.test(trimmed) || Number(trimmed) <= 0 || Number(trimmed) > max) {
      ctx.addIssue({
        code: "custom",
        message: `${label}: informe um número inteiro de 1 a ${max}.`,
      });
      return z.NEVER;
    }
    return Number(trimmed);
  });

export const productSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { error: "Informe o nome do produto." })
    .max(200, { error: "Nome: no máximo 200 caracteres." }),
  brand: optionalText(80, "Marca"),
  description: optionalText(5000, "Descrição"),
});
export type ProductInput = z.infer<typeof productSchema>;

/** "cam-az m" -> "CAM-AZ M" is rejected (no spaces); "cam-az-m" -> "CAM-AZ-M". */
export function normalizeSkuCode(code: string): string {
  return code.trim().toUpperCase();
}

const VARIATION_SLOTS = [1, 2, 3] as const;
export type VariationAttribute = { name: string; value: string };

export const skuSchema = z
  .object({
    code: z
      .string()
      .transform(normalizeSkuCode)
      .pipe(
        z
          .string()
          .min(1, { error: "Informe o código SKU." })
          .max(60, { error: "SKU: no máximo 60 caracteres." })
          .regex(/^[A-Z0-9][A-Z0-9._\-/]*$/, {
            error: "SKU: use letras, números e - _ . / (sem espaços nem acentos).",
          }),
      ),
    ean: optionalDigits(isValidGtin, "EAN inválido: confira os números (8, 12, 13 ou 14 dígitos)."),
    variationName1: z.string().default(""),
    variationValue1: z.string().default(""),
    variationName2: z.string().default(""),
    variationValue2: z.string().default(""),
    variationName3: z.string().default(""),
    variationValue3: z.string().default(""),
    ncm: optionalDigits(isValidNcm, "NCM deve ter 8 dígitos."),
    cest: optionalDigits(isValidCest, "CEST deve ter 7 dígitos."),
    origin: z.string().transform((value, ctx) => {
      if (value === "") return null;
      if (!/^[0-8]$/.test(value)) {
        ctx.addIssue({ code: "custom", message: "Escolha a origem da lista." });
        return z.NEVER;
      }
      return Number(value);
    }),
    unit: z
      .string()
      .default("UN")
      .refine((value) => UNIT_CODES.has(value), { error: "Escolha a unidade da lista." }),
    defaultCfop: optionalDigits(isValidCfop, "CFOP deve ter 4 dígitos (ex.: 5102)."),
    weightGrams: optionalPositiveInt("Peso", 1_000_000),
    heightCm: optionalPositiveInt("Altura", 1000),
    widthCm: optionalPositiveInt("Largura", 1000),
    lengthCm: optionalPositiveInt("Comprimento", 1000),
    location: optionalText(60, "Localização"),
    cost: z
      .string()
      .optional()
      .transform((value, ctx) => {
        if (value === undefined || value.trim() === "") return null;
        const cents = parseBrlToCents(value);
        if (cents === null) {
          ctx.addIssue({ code: "custom", message: "Custo inválido. Exemplo: 12,50" });
          return z.NEVER;
        }
        return cents;
      }),
  })
  .transform((data, ctx) => {
    const variation: VariationAttribute[] = [];
    for (const slot of VARIATION_SLOTS) {
      const name = data[`variationName${slot}`].trim();
      const value = data[`variationValue${slot}`].trim();
      if (!name && !value) continue;
      if (!name || !value) {
        ctx.addIssue({
          code: "custom",
          message: "Preencha o nome e o valor da variação (ex.: Cor / Azul).",
          path: [`variationValue${slot}`],
        });
        return z.NEVER;
      }
      variation.push({ name: name.slice(0, 40), value: value.slice(0, 60) });
    }
    return {
      code: data.code,
      ean: data.ean,
      variation: variation.length ? variation : null,
      ncm: data.ncm,
      cest: data.cest,
      origin: data.origin,
      unit: data.unit,
      defaultCfop: data.defaultCfop,
      weightGrams: data.weightGrams,
      heightCm: data.heightCm,
      widthCm: data.widthCm,
      lengthCm: data.lengthCm,
      location: data.location,
      costCents: data.cost,
    };
  });
export type SkuInput = z.infer<typeof skuSchema>;

/** "Cor: Azul / Tamanho: M" (or "Sem variação") for lists. */
export function variationLabel(variation: unknown): string {
  if (!Array.isArray(variation) || variation.length === 0) return "Sem variação";
  return variation
    .map((attribute: Partial<VariationAttribute>) => `${attribute.name}: ${attribute.value}`)
    .join(" / ");
}
