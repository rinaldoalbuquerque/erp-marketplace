"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "@/server/auth/session";
import { catchUpInBackground } from "@/server/orders/schedule";

/** "Buscar vendas agora": searches every connected account in the background. */
export async function fetchOrdersNowAction() {
  const member = await requirePermission("orders.view");
  await catchUpInBackground(member.organizationId, true);
  revalidatePath("/pedidos");
  redirect("/pedidos?buscando=1");
}
