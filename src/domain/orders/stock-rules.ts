// What a marketplace order does to ERP stock (pure rules). Decisions approved by the owner:
// - Full sales never move ERP stock (the goods are in the marketplace warehouse);
// - only sales confirmed after the account switch was turned on move stock;
// - a cancelled order gives the stock back; partial refunds/claims do not (the
//   product may not have come back: the owner records an entry when it arrives).

export type ItemStockStatus =
  "waiting" | "deducted" | "restored" | "not_applicable" | "missing_sku";

export type ItemStockInput = {
  current: ItemStockStatus;
  orderStatus: string;
  /** Sale confirmed by the marketplace (it discounted its own stock). */
  dateClosed: Date | null;
  logisticType: string | null;
  account: { orderStockEnabled: boolean; orderStockSince: Date | null };
  hasSku: boolean;
};

export type ItemStockDecision =
  | { action: "deduct" }
  | { action: "restore" }
  | { action: "mark"; status: ItemStockStatus; note: string | null }
  | { action: "none" };

/** Statuses where the sale did not happen (ML: cancelled, invalid). */
const CANCELLED = new Set(["cancelled", "invalid"]);

export const STOCK_NOTES = {
  full: "Venda Full: o estoque é do armazém do Mercado Livre.",
  off: "Baixa de estoque com vendas desligada nesta conta.",
  beforeSwitch: "Venda confirmada antes de ligar a baixa de estoque.",
  missingSku: "Anúncio sem SKU vinculado: estoque não baixado.",
  cancelledBefore: "Cancelado antes da baixa.",
} as const;

export function decideItemStock(input: ItemStockInput): ItemStockDecision {
  const cancelled = CANCELLED.has(input.orderStatus);

  if (input.current === "deducted") return cancelled ? { action: "restore" } : { action: "none" };
  if (input.current === "restored" || input.current === "not_applicable") return { action: "none" };

  // waiting or missing_sku from here on
  if (cancelled) {
    return { action: "mark", status: "not_applicable", note: STOCK_NOTES.cancelledBefore };
  }
  if (!input.dateClosed) return { action: "none" }; // not confirmed yet

  if (input.logisticType === "fulfillment") {
    return { action: "mark", status: "not_applicable", note: STOCK_NOTES.full };
  }
  const { orderStockEnabled, orderStockSince } = input.account;
  if (!orderStockEnabled || !orderStockSince) {
    return { action: "mark", status: "not_applicable", note: STOCK_NOTES.off };
  }
  if (input.dateClosed < orderStockSince) {
    return { action: "mark", status: "not_applicable", note: STOCK_NOTES.beforeSwitch };
  }
  if (!input.hasSku) {
    return input.current === "missing_sku"
      ? { action: "none" }
      : { action: "mark", status: "missing_sku", note: STOCK_NOTES.missingSku };
  }
  return { action: "deduct" };
}
