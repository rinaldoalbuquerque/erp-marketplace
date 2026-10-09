import { z } from "zod";

import { isValidCest, isValidCfop, isValidNcm, onlyDigits, UNIT_CODES } from "./fiscal";

// Bulk fiscal form: only the fields the user fills in are applied; empty
// fields leave each SKU's current value untouched.

export type FiscalPatch = Partial<{
  ncm: string;
  cest: string;
  origin: number;
  unit: string;
  defaultCfop: string;
}>;

const digitsField = (isValid: (digits: string) => boolean, message: string) =>
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      const digits = onlyDigits(value ?? "");
      if (!digits) return undefined;
      if (!isValid(digits)) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return digits;
    });

export const bulkFiscalSchema = z
  .object({
    ncm: digitsField(isValidNcm, "NCM deve ter 8 dígitos."),
    cest: digitsField(isValidCest, "CEST deve ter 7 dígitos."),
    origin: z
      .string()
      .optional()
      .transform((value, ctx) => {
        if (!value) return undefined;
        if (!/^[0-8]$/.test(value)) {
          ctx.addIssue({ code: "custom", message: "Escolha a origem da lista." });
          return z.NEVER;
        }
        return Number(value);
      }),
    unit: z
      .string()
      .optional()
      .transform((value, ctx) => {
        if (!value) return undefined;
        if (!UNIT_CODES.has(value)) {
          ctx.addIssue({ code: "custom", message: "Escolha a unidade da lista." });
          return z.NEVER;
        }
        return value;
      }),
    defaultCfop: digitsField(isValidCfop, "CFOP deve ter 4 dígitos (ex.: 5102)."),
  })
  .transform((data, ctx): FiscalPatch => {
    const patch = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    ) as FiscalPatch;
    if (Object.keys(patch).length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Preencha pelo menos um campo para aplicar.",
        path: ["form"],
      });
      return z.NEVER;
    }
    return patch;
  });

/** "NCM 70133700, origem 0" (for the confirmation message). */
export function describePatch(patch: FiscalPatch): string {
  const parts: string[] = [];
  if (patch.ncm) parts.push(`NCM ${patch.ncm}`);
  if (patch.cest) parts.push(`CEST ${patch.cest}`);
  if (patch.origin !== undefined) parts.push(`origem ${patch.origin}`);
  if (patch.unit) parts.push(`unidade ${patch.unit}`);
  if (patch.defaultCfop) parts.push(`CFOP ${patch.defaultCfop}`);
  return parts.join(", ");
}
