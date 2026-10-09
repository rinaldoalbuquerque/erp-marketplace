"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "@/server/auth/session";
import { disconnectAccount, testConnection } from "@/server/marketplaces/accounts";
import { getTenantContext } from "@/server/tenant/tenant-db";

export async function testConnectionAction(accountId: string) {
  const member = await requirePermission("marketplaceAccounts.manage");
  const { tdb } = await getTenantContext(member);
  const result = await testConnection(member, tdb, accountId);
  revalidatePath("/contas");
  redirect(
    result.status === "ok"
      ? `/contas?teste=ok&conta=${encodeURIComponent(result.nickname)}`
      : `/contas?teste=${result.status}`,
  );
}

/** Turns on/off "the ERP may change listings of this account" (off by default). */
export async function setAllowWritesAction(accountId: string, allow: boolean) {
  const member = await requirePermission("marketplaceAccounts.manage");
  const { tdb } = await getTenantContext(member);
  await tdb.marketplaceAccount.updateMany({
    where: { id: accountId },
    data: { allowWrites: allow },
  });
  revalidatePath("/contas");
  revalidatePath("/anuncios");
  redirect(`/contas?alteracoes=${allow ? "ligadas" : "desligadas"}`);
}

export async function disconnectAccountAction(accountId: string) {
  const member = await requirePermission("marketplaceAccounts.manage");
  const { tdb } = await getTenantContext(member);
  await disconnectAccount(tdb, accountId);
  revalidatePath("/contas");
  redirect("/contas?desconectada=1");
}
