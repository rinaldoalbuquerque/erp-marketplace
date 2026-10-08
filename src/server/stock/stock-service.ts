import "server-only";

import { allowsNegative, signedQuantity, type StockMovementType } from "@/domain/stock/movements";
import type { TenantDb } from "@/server/tenant/tenant-db";

import { Prisma } from "@/generated/prisma/client";

// The ONLY place that changes Sku.stockOnHand. Every change writes a
// StockMovement in the same transaction (balance and history never diverge).
//
// Concurrency (CLAUDE.md: two simultaneous sales of the same SKU):
// - in/out/sale: one conditional UPDATE ("add X if the result stays >= 0"),
//   so concurrent requests queue on the row lock and can't overdraw.
// - count: optimistic update ("set to N only if the balance is still what I
//   read"), retried a few times if someone else changed it in between.
// Idempotency (CLAUDE.md: the same event twice can't move stock twice):
// a unique (organization_id, idempotency_key) index; duplicates roll back.

export type StockChange =
  | { type: Exclude<StockMovementType, "count">; quantity: number }
  | { type: "count"; countedQuantity: number };

export type AdjustStockInput = StockChange & {
  /** The member organization (the tenant client rejects any other). */
  organizationId: string;
  skuId: string;
  reason?: string | null;
  idempotencyKey?: string | null;
  createdById?: string | null;
};

export type AdjustStockResult =
  | { status: "applied"; movementId: string; balance: number; change: number }
  | { status: "duplicate"; movementId: string }
  | { status: "no_change"; balance: number }
  | { status: "insufficient"; balance: number }
  | { status: "not_found" };

const COUNT_RETRIES = 3;

class InsufficientStock extends Error {
  constructor(readonly balance: number) {
    super("insufficient stock");
  }
}
class SkuNotFound extends Error {}
class BalanceChanged extends Error {}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function adjustStock(
  tdb: TenantDb,
  input: AdjustStockInput,
): Promise<AdjustStockResult> {
  const key = input.idempotencyKey ?? null;

  for (let attempt = 1; attempt <= COUNT_RETRIES; attempt++) {
    try {
      return await tdb.$transaction(async (tx) => {
        if (key) {
          const existing = await tx.stockMovement.findFirst({
            where: { idempotencyKey: key },
            select: { id: true },
          });
          if (existing) return { status: "duplicate", movementId: existing.id } as const;
        }

        let change: number;
        if (input.type === "count") {
          if (!Number.isInteger(input.countedQuantity) || input.countedQuantity < 0) {
            throw new RangeError("Counted quantity must be a whole number >= 0.");
          }
          const sku = await tx.sku.findFirst({
            where: { id: input.skuId },
            select: { stockOnHand: true },
          });
          if (!sku) throw new SkuNotFound();
          change = input.countedQuantity - sku.stockOnHand;
          if (change === 0) return { status: "no_change", balance: sku.stockOnHand } as const;
          const updated = await tx.sku.updateMany({
            where: { id: input.skuId, stockOnHand: sku.stockOnHand },
            data: { stockOnHand: input.countedQuantity },
          });
          if (updated.count === 0) throw new BalanceChanged();
        } else {
          change = signedQuantity(input.type, input.quantity);
          const guard =
            change < 0 && !allowsNegative(input.type) ? { stockOnHand: { gte: -change } } : {};
          const updated = await tx.sku.updateMany({
            where: { id: input.skuId, ...guard },
            data: { stockOnHand: { increment: change } },
          });
          if (updated.count === 0) {
            const sku = await tx.sku.findFirst({
              where: { id: input.skuId },
              select: { stockOnHand: true },
            });
            if (!sku) throw new SkuNotFound();
            throw new InsufficientStock(sku.stockOnHand);
          }
        }

        // Our UPDATE holds the row lock until commit, so this read is our own result.
        const after = await tx.sku.findFirstOrThrow({
          where: { id: input.skuId },
          select: { stockOnHand: true },
        });
        const movement = await tx.stockMovement.create({
          data: {
            organizationId: input.organizationId,
            skuId: input.skuId,
            type: input.type,
            quantity: change,
            balanceAfter: after.stockOnHand,
            reason: input.reason ?? null,
            idempotencyKey: key,
            createdById: input.createdById ?? null,
          },
          select: { id: true },
        });
        return {
          status: "applied",
          movementId: movement.id,
          balance: after.stockOnHand,
          change,
        } as const;
      });
    } catch (error) {
      if (error instanceof InsufficientStock) {
        return { status: "insufficient", balance: error.balance };
      }
      if (error instanceof SkuNotFound) return { status: "not_found" };
      if (error instanceof BalanceChanged && attempt < COUNT_RETRIES) continue;
      if (key && isUniqueViolation(error)) {
        // Same key applied concurrently by another request: ours was rolled back.
        const existing = await tdb.stockMovement.findFirst({
          where: { idempotencyKey: key },
          select: { id: true },
        });
        if (existing) return { status: "duplicate", movementId: existing.id };
      }
      throw error;
    }
  }
  throw new Error("Stock count kept changing; try again.");
}
