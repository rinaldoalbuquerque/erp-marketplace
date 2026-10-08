// Money is stored as integer cents (no floating-point rounding errors).

/**
 * Parses a Brazilian amount typed by the user into cents.
 * "12,5" -> 1250, "1.234,56" -> 123456, "R$ 10" -> 1000. Returns null if invalid.
 */
export function parseBrlToCents(input: string): number | null {
  const cleaned = input.replace(/R\$/i, "").replace(/\s/g, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(cleaned)) return null;
  const [integerPart = "0", decimalPart = ""] = cleaned.replace(/\./g, "").split(",");
  return Number(integerPart) * 100 + Number(decimalPart.padEnd(2, "0"));
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** 123456 -> "R$ 1.234,56" */
export function formatCents(cents: number): string {
  return BRL.format(cents / 100);
}

/** 123456 -> "1.234,56" (for form inputs) */
export function centsToInput(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
