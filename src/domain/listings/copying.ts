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

/** New price for a copy. Never below R$ 1,00. */
export function adjustPrice(cents: number, { percent, roundTo90 }: PriceOptions): number {
  let next = Math.round(cents * (1 + percent / 100));
  if (roundTo90) {
    const reais = Math.floor(next / 100);
    const candidates = [reais - 1, reais, reais + 1].map((value) => value * 100 + 90);
    next = candidates.reduce((best, candidate) =>
      Math.abs(candidate - next) < Math.abs(best - next) ? candidate : best,
    );
  }
  return Math.max(100, next);
}
