import "server-only";

import { z } from "zod";

import {
  MarketplaceApiError,
  MarketplaceAuthError,
  MarketplaceValidationError,
  type MarketplaceConnector,
  type MarketplaceId,
} from "@/connectors/types";
import { retryDelayMs } from "@/domain/stock/push-rules";
import { db } from "@/server/db";
import { getConnector } from "@/server/marketplaces/config";
import { getAccessToken, ReconnectRequiredError } from "@/server/marketplaces/token-service";
import { enqueueForSkus } from "@/server/stock-sync/push-service";
import { tenantDb } from "@/server/tenant/tenant-db";

import { syncInvoicesForShipment, type FiscalDeps } from "@/server/fiscal/invoice-service";

import { saveOrder, type OrderAccount } from "./order-service";
import { refreshShipment, shipmentsToRefresh } from "./shipment-service";

// Receiving sales (Phase 3A). Internal routine: unscoped `db`, always filtering
// by the account's organization.
// Notifications docs: https://developers.mercadolivre.com.br/pt_br/produto-receba-notificacoes
// - ML POSTs { resource: "/orders/{id}", user_id, topic: "orders_v2", ... } and
//   wants HTTP 200 within 500 ms, else it retries for 1 hour and may turn the
//   topics off. So the endpoint only records it; the order is fetched later.
// - The body is never trusted as data: only `resource` says what to fetch, with
//   our own token, and only for accounts connected to the ERP.

export type OrderSyncDeps = FiscalDeps & {
  now?: () => Date;
  connectorFor?: (marketplace: MarketplaceId) => MarketplaceConnector;
};

const ORDER_TOPIC = "orders_v2";
const ORDER_RESOURCE = /^\/orders\/(\d{1,30})$/;
/** Topic "shipments": resource /shipments/{id} (same docs page). */
const SHIPMENT_TOPIC = "shipments";
const SHIPMENT_RESOURCE = /^\/shipments\/(\d{1,30})$/;
/** Each catch-up also refreshes up to this many open shipments not read recently. */
const SHIPMENTS_PER_CATCH_UP = 60;
const SHIPMENT_STALE_MS = 15 * 60 * 1000;
const MAX_TRIES = 5;
const CLAIM_MS = 2 * 60 * 1000;
/** First catch-up of an account looks back this far. */
const FIRST_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;
/** Each catch-up re-reads a little before the cursor (saving is idempotent). */
const CURSOR_OVERLAP_MS = 10 * 60 * 1000;

export const notificationSchema = z.object({
  topic: z.string().min(1).max(100),
  resource: z.string().min(1).max(300),
  user_id: z.union([z.number(), z.string()]).transform(String),
});

/** Records (or re-opens) a notification. One upsert: fast enough for the 500 ms limit. */
export async function recordNotification(
  marketplace: MarketplaceId,
  body: z.infer<typeof notificationSchema>,
) {
  await db.marketplaceNotification.upsert({
    where: {
      marketplace_topic_resource: { marketplace, topic: body.topic, resource: body.resource },
    },
    create: {
      marketplace,
      topic: body.topic,
      resource: body.resource,
      externalUserId: body.user_id,
    },
    update: {
      externalUserId: body.user_id,
      status: "pending",
      version: { increment: 1 },
      tries: 0,
      nextAttemptAt: new Date(),
      lastError: null,
      receivedAt: new Date(),
    },
  });
}

const ACCOUNT_SELECT = {
  id: true,
  organizationId: true,
  marketplace: true,
  externalUserId: true,
  orderStockEnabled: true,
  orderStockSince: true,
} as const;

/** Saves the order and sends the new stock of affected SKUs to the other listings. */
async function applyOrder(
  account: OrderAccount,
  order: Parameters<typeof saveOrder>[1],
  now: Date,
) {
  const { changedSkuIds } = await saveOrder(account, order, now);
  if (changedSkuIds.length > 0) {
    await enqueueForSkus(tenantDb(account.organizationId), account.organizationId, changedSkuIds);
  }
  return changedSkuIds.length > 0;
}

/** Shipment refresh, then its invoice when the shipment is past the invoice step. */
async function refreshShipmentAndInvoice(
  account: OrderAccount & { externalUserId: string },
  connector: MarketplaceConnector,
  token: string,
  shippingId: string,
  now: Date,
  deps: OrderSyncDeps,
) {
  await refreshShipment(account, connector, token, shippingId, now);
  try {
    await syncInvoicesForShipment(account, token, shippingId, deps);
  } catch (error) {
    // The invoice is looked up again later; only a lost authorization stops here.
    if (!(error instanceof MarketplaceApiError)) throw error;
  }
}

export type NotificationRoundResult = {
  done: number;
  ignored: number;
  failed: number;
  retrying: number;
  /** Organizations whose stock changed (their stock queue should run). */
  organizations: string[];
  timedOut: boolean;
};

async function claimNextNotification(now: Date) {
  for (let tries = 0; tries < 5; tries++) {
    const candidate = await db.marketplaceNotification.findFirst({
      where: {
        status: "pending",
        nextAttemptAt: { lte: now },
        OR: [{ claimedUntil: null }, { claimedUntil: { lt: now } }],
      },
      orderBy: { nextAttemptAt: "asc" },
      select: {
        id: true,
        version: true,
        claimedUntil: true,
        topic: true,
        resource: true,
        externalUserId: true,
        marketplace: true,
        tries: true,
      },
    });
    if (!candidate) return null;
    const claimed = await db.marketplaceNotification.updateMany({
      where: {
        id: candidate.id,
        version: candidate.version,
        status: "pending",
        claimedUntil: candidate.claimedUntil,
      },
      data: { claimedUntil: new Date(now.getTime() + CLAIM_MS) },
    });
    if (claimed.count === 1) return candidate;
  }
  return null;
}

/** Processes due notifications (all organizations) until none is left or `deadline`. */
export async function processNotifications(
  deadline: Date,
  deps: OrderSyncDeps = {},
): Promise<NotificationRoundResult> {
  const now = deps.now ?? (() => new Date());
  const connectorFor = deps.connectorFor ?? getConnector;
  const result: NotificationRoundResult = {
    done: 0,
    ignored: 0,
    failed: 0,
    retrying: 0,
    organizations: [],
    timedOut: false,
  };
  const organizations = new Set<string>();

  while (true) {
    if (now() >= deadline) {
      result.timedOut = true;
      break;
    }
    const note = await claimNextNotification(now());
    if (!note) break;
    // Only this version: a newer notification for the same order stays pending.
    const finish = (data: Record<string, unknown>) =>
      db.marketplaceNotification.updateMany({
        where: { id: note.id, version: note.version },
        data: { ...data, claimedUntil: null },
      });

    const match =
      note.topic === ORDER_TOPIC
        ? ORDER_RESOURCE.exec(note.resource)
        : note.topic === SHIPMENT_TOPIC
          ? SHIPMENT_RESOURCE.exec(note.resource)
          : null;
    const account = match
      ? await db.marketplaceAccount.findFirst({
          where: {
            marketplace: note.marketplace,
            externalUserId: note.externalUserId,
            status: "active",
          },
          select: ACCOUNT_SELECT,
        })
      : null;
    if (!match || !account) {
      await finish({
        status: "ignored",
        processedAt: now(),
        lastError: match ? "Conta não conectada ao ERP." : "Tópico não usado.",
      });
      result.ignored++;
      continue;
    }

    try {
      const token = await getAccessToken(account.organizationId, account.id, deps);
      const connector = connectorFor(account.marketplace);
      if (note.topic === SHIPMENT_TOPIC) {
        await refreshShipmentAndInvoice(account, connector, token, match[1]!, now(), deps);
      } else {
        const order = await connector.getOrder(token, match[1]!);
        if (await applyOrder(account, order, now())) organizations.add(account.organizationId);
        if (order.shippingId) {
          await refreshShipmentAndInvoice(account, connector, token, order.shippingId, now(), deps);
        }
      }
      await finish({ status: "done", processedAt: now(), lastError: null });
      result.done++;
    } catch (error) {
      const tries = note.tries + 1;
      const reconnect =
        error instanceof ReconnectRequiredError || error instanceof MarketplaceAuthError;
      if (!reconnect && !(error instanceof MarketplaceApiError)) {
        console.error("Order notification failed", {
          notificationId: note.id,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
      const wait = !reconnect && tries < MAX_TRIES ? retryDelayMs(tries) : null;
      if (wait === null) {
        await finish({
          status: "failed",
          tries,
          lastError: reconnect
            ? "O Mercado Livre não aceita mais a autorização. Reconecte a conta."
            : "Não foi possível ler a venda no Mercado Livre.",
        });
        result.failed++;
      } else {
        await finish({
          tries,
          nextAttemptAt: new Date(now().getTime() + wait),
          lastError: "O Mercado Livre não respondeu. Nova tentativa em instantes.",
        });
        result.retrying++;
      }
    }
  }
  result.organizations = [...organizations];
  return result;
}

export type CatchUpResult =
  | { status: "ok"; orders: number; stockChanged: boolean }
  | { status: "reconnect" | "marketplace_error" | "not_found" };

/**
 * Reinforcement for missed notifications: fetches the orders changed since the
 * last catch-up of the account and applies them (idempotent).
 */
export async function catchUpOrders(
  organizationId: string,
  accountId: string,
  deps: OrderSyncDeps = {},
): Promise<CatchUpResult> {
  const now = deps.now ?? (() => new Date());
  const connectorFor = deps.connectorFor ?? getConnector;
  const account = await db.marketplaceAccount.findFirst({
    where: { id: accountId, organizationId, status: "active" },
    select: { ...ACCOUNT_SELECT, ordersSyncedAt: true },
  });
  if (!account) return { status: "not_found" };

  const to = now();
  const from = account.ordersSyncedAt
    ? new Date(account.ordersSyncedAt.getTime() - CURSOR_OVERLAP_MS)
    : new Date(to.getTime() - FIRST_LOOKBACK_MS);
  try {
    const token = await getAccessToken(organizationId, accountId, deps);
    const orders = await connectorFor(account.marketplace).searchOrdersUpdated(
      token,
      account.externalUserId,
      from,
      to,
    );
    let stockChanged = false;
    for (const order of orders) {
      if (await applyOrder(account, order, to)) stockChanged = true;
    }
    // Shipments of the changed orders, plus open ones not read for a while
    // (a shipment can change without its order changing).
    const stale = await shipmentsToRefresh(account, {
      staleBefore: new Date(to.getTime() - SHIPMENT_STALE_MS),
      limit: SHIPMENTS_PER_CATCH_UP,
    });
    const shippingIds = new Set([
      ...orders.flatMap((order) => (order.shippingId ? [order.shippingId] : [])),
      ...stale,
    ]);
    const connector = connectorFor(account.marketplace);
    for (const shippingId of shippingIds) {
      try {
        await refreshShipmentAndInvoice(account, connector, token, shippingId, to, deps);
      } catch (error) {
        // One unreadable shipment must not stop the catch-up; auth problems do.
        if (!(
          error instanceof MarketplaceApiError || error instanceof MarketplaceValidationError
        )) {
          throw error;
        }
      }
    }
    await db.marketplaceAccount.updateMany({
      where: { id: accountId, organizationId },
      data: { ordersSyncedAt: to },
    });
    return { status: "ok", orders: orders.length, stockChanged };
  } catch (error) {
    if (error instanceof ReconnectRequiredError || error instanceof MarketplaceAuthError) {
      return { status: "reconnect" };
    }
    if (error instanceof MarketplaceApiError) return { status: "marketplace_error" };
    throw error;
  }
}
