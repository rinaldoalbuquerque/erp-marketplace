"use server";

import { revalidatePath } from "next/cache";

import { stockAdjustmentSchema } from "@/domain/stock/movements";
import { readFields, type FormState } from "@/lib/auth/form-state";
import { fieldErrors } from "@/lib/auth/schemas";
import { requirePermission } from "@/server/auth/session";
import { adjustStock } from "@/server/stock/stock-service";
import { getTenantContext } from "@/server/tenant/tenant-db";

/** Manual stock adjustment (Estoque > SKU). Checks permission and validates again. */
export async function adjustStockAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const member = await requirePermission("stock.adjust");
  const { tdb } = await getTenantContext(member);

  const raw = readFields(formData, ["skuId", "type", "quantity", "reason"]);
  const parsed = stockAdjustmentSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrors(parsed.error), values: raw };
  }
  const { skuId, type, quantity, reason } = parsed.data;

  const common = {
    organizationId: member.organizationId,
    skuId,
    reason,
    createdById: member.user.id,
  };
  const result =
    type === "count"
      ? await adjustStock(tdb, { ...common, type, countedQuantity: quantity })
      : await adjustStock(tdb, { ...common, type, quantity });

  revalidatePath(`/estoque/${skuId}`);
  revalidatePath("/estoque");

  switch (result.status) {
    case "applied": {
      const sign = result.change > 0 ? "+" : "";
      return {
        status: "success",
        message: `Estoque ajustado (${sign}${result.change}). Saldo agora: ${result.balance}.`,
      };
    }
    case "no_change":
      return {
        status: "success",
        message: `A contagem confere com o saldo (${result.balance}). Nada foi alterado.`,
      };
    case "insufficient":
      return {
        status: "error",
        message: `Estoque insuficiente: há ${result.balance} no momento. Para corrigir o saldo, use “Contagem”.`,
        values: raw,
      };
    case "not_found":
      return { status: "error", message: "SKU não encontrado." };
    case "duplicate":
      return { status: "success", message: "Este ajuste já tinha sido registrado." };
  }
}
