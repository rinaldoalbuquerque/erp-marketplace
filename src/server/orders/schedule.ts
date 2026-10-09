import "server-only";

import { after } from "next/server";

import { db } from "@/server/db";
import { processStockPushes } from "@/server/stock-sync/push-service";

import { catchUpOrders, processNotifications } from "./order-sync";

/**
 * One background round: due notifications, then the stock queue of every
 * organization whose stock changed (new balance to the other listings).
 */
export async function runOrderRound(deadline: Date) {
  const result = await processNotifications(deadline);
  for (const organizationId of result.organizations) {
    await processStockPushes(organizationId, deadline);
  }
  return result;
}

function logged(label: string, task: () => Promise<unknown>) {
  return async () => {
    try {
      await task();
    } catch (error) {
      console.error(label, { error: error instanceof Error ? error.message : "unknown" });
    }
  };
}

/** Runs a round after the response (next/server `after`). */
export function processOrdersInBackground(budgetMs = 20_000) {
  const deadline = new Date(Date.now() + budgetMs);
  after(logged("Order round failed", () => runOrderRound(deadline)));
}

/** Minimum time between two automatic catch-ups of the same account (page visits). */
const CATCH_UP_EVERY_MS = 5 * 60 * 1000;

/**
 * On page visits: catch up accounts not searched recently and process due
 * notifications, all after the response.
 */
export async function catchUpInBackground(organizationId: string, force = false) {
  const staleBefore = new Date(Date.now() - CATCH_UP_EVERY_MS);
  const accounts = await db.marketplaceAccount.findMany({
    where: {
      organizationId,
      status: "active",
      ...(force ? {} : { OR: [{ ordersSyncedAt: null }, { ordersSyncedAt: { lt: staleBefore } }] }),
    },
    select: { id: true },
  });
  const deadline = new Date(Date.now() + 60_000);
  after(
    logged("Order catch-up failed", async () => {
      let stockChanged = false;
      for (const account of accounts) {
        const result = await catchUpOrders(organizationId, account.id);
        if (result.status === "ok" && result.stockChanged) stockChanged = true;
      }
      await runOrderRound(deadline);
      if (stockChanged) await processStockPushes(organizationId, deadline);
    }),
  );
}
