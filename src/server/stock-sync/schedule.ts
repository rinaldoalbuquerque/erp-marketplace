import "server-only";

import { after } from "next/server";

import { db } from "@/server/db";

import { processStockPushes } from "./push-service";

/**
 * Time a background send may take after a response. Short on purpose: what is
 * left stays queued and is sent by the next round (page visit or button).
 */
const BACKGROUND_BUDGET_MS = 20_000;

/** Sends the queued stock updates after the response (next/server `after`). */
export function processInBackground(organizationId: string) {
  const deadline = new Date(Date.now() + BACKGROUND_BUDGET_MS);
  after(async () => {
    try {
      await processStockPushes(organizationId, deadline);
    } catch (error) {
      console.error("Stock sync round failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  });
}

/**
 * Queues stock updates after an ERP change and sends them in the background.
 * A queue failure never undoes the ERP change: it is logged and the listing can
 * be sent again from Contas ("Enviar todos agora").
 */
export async function queueStockSync(organizationId: string, enqueue: () => Promise<number>) {
  try {
    if ((await enqueue()) > 0) processInBackground(organizationId);
  } catch (error) {
    console.error("Stock sync enqueue failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

/** On page visits: if something is due (e.g. a retry), send it in the background. */
export async function processDueInBackground(organizationId: string) {
  const due = await db.stockPush.findFirst({
    where: { organizationId, status: "pending", nextAttemptAt: { lte: new Date() } },
    select: { id: true },
  });
  if (due) processInBackground(organizationId);
}
