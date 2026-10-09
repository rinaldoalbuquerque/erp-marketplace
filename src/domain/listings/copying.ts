// Pure helpers for copying listings (Phase 2D).

/**
 * Listing id from what the user pasted: "MLB123", "mlb-123" or a listing URL
 * (https://produto.mercadolivre.com.br/MLB-123-nome-do-produto-_JM). Null if none.
 */
export function parseListingRef(input: string): string | null {
  const match = /\bMLB-?(\d{6,15})\b/i.exec(input.trim());
  return match ? `MLB${match[1]}` : null;
}

export type PriceOptions = {
  /** e.g. 10 = +10%, -5 = -5% */
  percent: number;
  /** Round to the nearest ,90 (32,47 -> 32,90; 32,95 -> 32,90) */
  roundTo90: boolean;
};

/** Nearest price ending in ,90 (32,47 -> 32,90; 32,95 -> 32,90; 33,45 -> 33,90). */
export function roundTo90(cents: number): number {
  const reais = Math.floor(cents / 100);
  const candidates = [reais - 1, reais, reais + 1].map((value) => value * 100 + 90);
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate - cents) < Math.abs(best - cents) ? candidate : best,
  );
}

/** Lowest price the ERP sends (R$ 1,00). */
export const MIN_PRICE_CENTS = 100;

/** New price for a copy. Never below R$ 1,00. */
export function adjustPrice(cents: number, options: PriceOptions): number {
  const next = Math.round(cents * (1 + options.percent / 100));
  return Math.max(MIN_PRICE_CENTS, options.roundTo90 ? roundTo90(next) : next);
}
