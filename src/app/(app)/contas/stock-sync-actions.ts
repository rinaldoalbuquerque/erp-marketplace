"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "@/server/auth/session";
import { enqueueAllForAccount } from "@/server/stock-sync/push-service";
import { processInBackground } from "@/server/stock-sync/schedule";
import { getTenantContext } from "@/server/tenant/tenant-db";

// Called from pages with maxDuration = 300 (Contas and the preview), so the
// background round may run up to ~4 minutes; what is left stays queued.
const LONG_ROUND_MS = 240_000;

const SYNC_OFF = "Sincronização de estoque desligada nesta conta.";

function refresh() {
  revalidatePath("/contas");
  revalidatePath("/estoque", "layout");
}

/** Turns stock sync on (after the preview) and sends every linked listing. */
export async function enableStockSyncAction(accountId: string) {
  const member = await requirePermission("marketplaceAccounts.manage");
  const { tdb } = await getTenantContext(member);
  const updated = await tdb.marketplaceAccount.updateMany({
    where: { id: accountId, status: "active", allowWrites: true },
    data: { stockSyncEnabled: true },
  });
  if (updated.count === 0) redirect("/contas?estoque=indisponivel");
  await enqueueAllForAccount(tdb, member.organizationId, accountId);
  processInBackground(member.organizationId, LONG_ROUND_MS);
  refresh();
  redirect("/contas?estoque=ligado");
}

export async function disableStockSyncAction(accountId: string) {
  const member = await requirePermission("marketplaceAccounts.manage");
  const { tdb } = await getTenantContext(member);
  await tdb.marketplaceAccount.updateMany({
    where: { id: accountId },
    data: { stockSyncEnabled: false },
  });
  // Nothing waiting is sent anymore.
  await tdb.stockPush.updateMany({
    where: { status: "pending", listing: { marketplaceAccountId: accountId } },
    data: { status: "skipped", skipReason: SYNC_OFF, claimToken: null, claimedUntil: null },
  });
  refresh();
  redirect("/contas?estoque=desligado");
}

/** Sends the current ERP stock of every linked listing again. */
export async function sendAllStockAction(accountId: string) {
  const member = await requirePermission("marketplaceAccounts.manage");
  const { tdb } = await getTenantContext(member);
  await enqueueAllForAccount(tdb, member.organizationId, accountId);
  processInBackground(member.organizationId, LONG_ROUND_MS);
  refresh();
  redirect("/contas?estoque=enviando");
}

/** Puts the failed sends of the account back in the queue. */
export async function retryFailedStockAction(accountId: string) {
  const member = await requirePermission("marketplaceAccounts.manage");
  const { tdb } = await getTenantContext(member);
  await tdb.stockPush.updateMany({
    where: { status: "failed", listing: { marketplaceAccountId: accountId } },
    data: {
      status: "pending",
      attempts: 0,
      nextAttemptAt: new Date(),
      claimToken: null,
      claimedUntil: null,
      lastError: null,
    },
  });
  processInBackground(member.organizationId, LONG_ROUND_MS);
  refresh();
  redirect("/contas?estoque=enviando");
}
