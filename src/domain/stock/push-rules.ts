// What to do with a stock update for one marketplace listing (pure rules).

export type PushTarget = {
  /** Marketplace logistic; "fulfillment" = Full (stock managed by the marketplace). */
  logisticType: string | null;
  /** "" for the whole listing, variation id otherwise. */
  variationKey: string;
  accountMultiWarehouse: boolean;
};

export type PushPlan = { action: "send"; quantity: number } | { action: "skip"; reason: string };

export const SKIP_REASONS = {
  full: "Full: o estoque é gerenciado pelo Mercado Livre.",
  variation: "Variação de anúncio tradicional: envio de estoque ainda não suportado.",
  multiWarehouse: "Conta com multi origem: envio de estoque ainda não suportado.",
} as const;

export function planStockPush(target: PushTarget, stockOnHand: number): PushPlan {
  if (target.logisticType === "fulfillment") return { action: "skip", reason: SKIP_REASONS.full };
  if (target.accountMultiWarehouse) return { action: "skip", reason: SKIP_REASONS.multiWarehouse };
  if (target.variationKey !== "") return { action: "skip", reason: SKIP_REASONS.variation };
  // Negative ERP stock (sales beyond stock) is sent as 0.
  return { action: "send", quantity: Math.max(0, Math.trunc(stockOnHand)) };
}

/** Wait before the next attempt after `attempts` failures; null = give up. */
export function retryDelayMs(attempts: number): number | null {
  const minutes = [1, 5, 15, 60][attempts - 1];
  return minutes === undefined ? null : minutes * 60 * 1000;
}

export const MAX_PUSH_ATTEMPTS = 5;
