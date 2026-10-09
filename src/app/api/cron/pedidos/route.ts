import { db } from "@/server/db";
import { env } from "@/server/env";
import { catchUpOrders } from "@/server/orders/order-sync";
import { runOrderRound } from "@/server/orders/schedule";
import { processStockPushes } from "@/server/stock-sync/push-service";

// Daily safety net (vercel.json; Vercel Hobby allows one cron run per day):
// searches the orders changed since the last catch-up of every connected
// account, retries due notifications and sends queued stock.
// Vercel sends "Authorization: Bearer $CRON_SECRET" (https://vercel.com/docs/cron-jobs).

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const deadline = new Date(Date.now() + 240_000);
  const accounts = await db.marketplaceAccount.findMany({
    where: { status: "active" },
    select: { id: true, organizationId: true },
  });
  const organizations = new Set<string>();
  for (const account of accounts) {
    if (new Date() >= deadline) break;
    const result = await catchUpOrders(account.organizationId, account.id);
    if (result.status === "ok") organizations.add(account.organizationId);
  }
  await runOrderRound(deadline);
  for (const organizationId of organizations) {
    if (new Date() >= deadline) break;
    await processStockPushes(organizationId, deadline);
  }
  return Response.json({ accounts: accounts.length });
}
