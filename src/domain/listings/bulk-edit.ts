import { z } from "zod";

import { MIN_PRICE_CENTS, roundTo90 } from "./copying";

// Bulk edit of listings (pure rules). The final value of every listing is
// computed BEFORE the batch starts and sent as an absolute value, so a resumed
// or repeated batch never applies "+8%" twice.

export const bulkOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("price_set"),
    cents: z.number().int().min(MIN_PRICE_CENTS).max(1_000_000_000),
    roundTo90: z.boolean(),
  }),
  z.object({
    kind: z.literal("price_percent"),
    percent: z.number().min(-90).max(500),
    roundTo90: z.boolean(),
  }),
  z.object({
    kind: z.literal("price_amount"),
    /** signed: -200 = minus R$ 2,00 */
    cents: z.number().int().min(-100_000_000).max(100_000_000),
    roundTo90: z.boolean(),
  }),
  z.object({ kind: z.literal("status"), status: z.enum(["paused", "active"]) }),
]);

export type BulkOperation = z.infer<typeof bulkOperationSchema>;

export type BulkItemInput = {
  priceCents: number | null;
  /** Marketplace status (ML: active, paused, closed, under_review...) */
  status: string;
  subStatus: string[];
};

/** What changes on one listing; values are absolute (price in cents or status). */
export type BulkChange =
  | { field: "price"; from: number; to: number }
  | { field: "status"; from: string; to: "paused" | "active" };

export type BulkPlan =
  { action: "change"; change: BulkChange; bigChange: boolean } | { action: "skip"; reason: string };

export const BULK_SKIP = {
  closed: "Anúncio finalizado: não pode ser alterado.",
  noPrice: "Anúncio sem preço conhecido.",
  samePrice: "Já está nesse preço.",
  sameStatus: "Já está com esse status.",
  outOfStock: "Pausado por falta de estoque: volta sozinho quando houver estoque.",
  notEditable: "Status atual não permite essa mudança.",
} as const;

/** Price changes above this fraction are highlighted in the preview. */
export const BIG_CHANGE = 0.3;

export function newPrice(operation: BulkOperation, current: number): number {
  let next: number;
  switch (operation.kind) {
    case "price_set":
      next = operation.cents;
      break;
    case "price_percent":
      next = Math.round(current * (1 + operation.percent / 100));
      break;
    case "price_amount":
      next = current + operation.cents;
      break;
    case "status":
      return current;
  }
  return Math.max(MIN_PRICE_CENTS, operation.roundTo90 ? roundTo90(next) : next);
}

export function planBulkItem(operation: BulkOperation, item: BulkItemInput): BulkPlan {
  if (item.status === "closed") return { action: "skip", reason: BULK_SKIP.closed };

  if (operation.kind === "status") {
    if (item.status === operation.status) return { action: "skip", reason: BULK_SKIP.sameStatus };
    if (operation.status === "active") {
      if (item.status !== "paused") return { action: "skip", reason: BULK_SKIP.notEditable };
      // ML: a listing paused for lack of stock can't be activated; it returns with stock.
      if (item.subStatus.includes("out_of_stock")) {
        return { action: "skip", reason: BULK_SKIP.outOfStock };
      }
    } else if (item.status !== "active") {
      return { action: "skip", reason: BULK_SKIP.notEditable };
    }
    return {
      action: "change",
      change: { field: "status", from: item.status, to: operation.status },
      bigChange: false,
    };
  }

  if (item.priceCents === null) return { action: "skip", reason: BULK_SKIP.noPrice };
  const to = newPrice(operation, item.priceCents);
  if (to === item.priceCents) return { action: "skip", reason: BULK_SKIP.samePrice };
  return {
    action: "change",
    change: { field: "price", from: item.priceCents, to },
    bigChange: Math.abs(to - item.priceCents) / item.priceCents > BIG_CHANGE,
  };
}

/** The change that undoes another one. */
export function reverseChange(change: BulkChange): BulkChange {
  return change.field === "price"
    ? { field: "price", from: change.to, to: change.from }
    : {
        field: "status",
        from: change.to,
        to: change.from === "active" ? "active" : "paused",
      };
}
