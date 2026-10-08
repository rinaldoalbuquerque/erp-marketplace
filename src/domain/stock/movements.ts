import { z } from "zod";

// Stock movement rules (pure). The database side lives in src/server/stock.

export type StockMovementType = "manual_in" | "manual_out" | "count" | "sale" | "sale_return";

export const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  manual_in: "Entrada",
  manual_out: "Saída",
  count: "Contagem",
  sale: "Venda",
  sale_return: "Devolução",
};

/** Movements that can't push stock below zero. Sales can (the sale already happened). */
export function allowsNegative(type: StockMovementType): boolean {
  return type === "sale";
}

/**
 * Signed change for a movement given a positive quantity.
 * "count" is not here: its change depends on the current balance.
 */
export function signedQuantity(
  type: Exclude<StockMovementType, "count">,
  quantity: number,
): number {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError("Quantity must be a positive whole number.");
  }
  return type === "manual_in" || type === "sale_return" ? quantity : -quantity;
}

/** Manual adjustment form (Estoque > Ajustar). */
export const stockAdjustmentSchema = z
  .object({
    skuId: z.uuid({ error: "SKU inválido." }),
    type: z.enum(["manual_in", "manual_out", "count"], { error: "Escolha o tipo de ajuste." }),
    quantity: z
      .string()
      .trim()
      .regex(/^\d+$/, { error: "Informe um número inteiro (sem vírgula)." })
      .transform(Number)
      .refine((value) => value <= 1_000_000, { error: "Quantidade muito alta." }),
    reason: z
      .string()
      .trim()
      .max(200, { error: "Motivo: no máximo 200 caracteres." })
      .transform((value) => value || null),
  })
  .refine((data) => data.type === "count" || data.quantity > 0, {
    error: "A quantidade precisa ser maior que zero.",
    path: ["quantity"],
  });
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
