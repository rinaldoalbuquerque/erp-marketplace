// Fiscal fields of a SKU (used later by the FiscalProvider to issue NF-e).
// Formats only: codes are not checked against the official NCM/CEST tables yet.

/**
 * "Origem da mercadoria" (NF-e field orig, table from Ajuste SINIEF / Manual de
 * Orientação do Contribuinte). Confirm the right code for each product with the
 * accountant.
 */
export const ORIGINS: ReadonlyArray<{ code: number; label: string }> = [
  { code: 0, label: "0 – Nacional, exceto as indicadas nos códigos 3, 4, 5 e 8" },
  { code: 1, label: "1 – Estrangeira, importação direta (exceto código 6)" },
  { code: 2, label: "2 – Estrangeira, adquirida no mercado interno (exceto código 7)" },
  { code: 3, label: "3 – Nacional, conteúdo de importação acima de 40% e até 70%" },
  { code: 4, label: "4 – Nacional, produzida conforme processos produtivos básicos (PPB)" },
  { code: 5, label: "5 – Nacional, conteúdo de importação até 40%" },
  { code: 6, label: "6 – Estrangeira, importação direta, sem similar nacional (lista CAMEX)" },
  {
    code: 7,
    label: "7 – Estrangeira, adquirida no mercado interno, sem similar nacional (lista CAMEX)",
  },
  { code: 8, label: "8 – Nacional, conteúdo de importação acima de 70%" },
];

/** Common commercial units (NF-e field uCom). */
export const UNITS: ReadonlyArray<{ code: string; label: string }> = [
  { code: "UN", label: "UN – Unidade" },
  { code: "PC", label: "PC – Peça" },
  { code: "PAR", label: "PAR – Par" },
  { code: "KIT", label: "KIT – Kit" },
  { code: "CJ", label: "CJ – Conjunto" },
  { code: "CX", label: "CX – Caixa" },
  { code: "DZ", label: "DZ – Dúzia" },
  { code: "KG", label: "KG – Quilograma" },
  { code: "G", label: "G – Grama" },
  { code: "M", label: "M – Metro" },
  { code: "M2", label: "M2 – Metro quadrado" },
  { code: "L", label: "L – Litro" },
  { code: "ML", label: "ML – Mililitro" },
  { code: "RL", label: "RL – Rolo" },
];

export const UNIT_CODES: ReadonlySet<string> = new Set(UNITS.map((unit) => unit.code));

/** Keeps digits only: "6109.10.00" -> "61091000". */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export const isValidNcm = (digits: string) => /^\d{8}$/.test(digits);
export const isValidCest = (digits: string) => /^\d{7}$/.test(digits);
/** CFOP: 4 digits, first one 1-3 (entries) or 5-7 (exits). */
export const isValidCfop = (digits: string) => /^[1-35-7]\d{3}$/.test(digits);

/** Fiscal fields still missing for issuing an NF-e (shown as a warning, not an error). */
export function missingFiscalFields(sku: {
  ncm: string | null;
  origin: number | null;
  defaultCfop: string | null;
}): string[] {
  const missing: string[] = [];
  if (!sku.ncm) missing.push("NCM");
  if (sku.origin === null) missing.push("origem");
  if (!sku.defaultCfop) missing.push("CFOP");
  return missing;
}
