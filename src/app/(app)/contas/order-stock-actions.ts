"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "@/server/auth/session";
import { getTenantContext } from "@/server/tenant/tenant-db";

/**
 * Turns on/off "sales of this account lower ERP stock". Turning on records the
 * moment: only sales confirmed after it move stock (older ones were already
 * counted in the ERP balance).
 */
export async function setOrderStockAction(accountId: string, enable: boolean) {
  const member = await requirePermission("marketplaceAccounts.manage");
  const { tdb } = await getTenantContext(member);
  await tdb.marketplaceAccount.updateMany({
    where: { id: accountId, ...(enable ? { status: "active", orderStockEnabled: false } : {}) },
    data: enable
      ? { orderStockEnabled: true, orderStockSince: new Date() }
      : { orderStockEnabled: false },
  });
  revalidatePath("/contas");
  revalidatePath("/pedidos");
  redirect(`/contas?vendas=${enable ? "ligado" : "desligado"}`);
}
