import "server-only";

import { createMercadoLivreInvoicer } from "@/connectors/mercadolivre/invoices";
import { MarketplaceApiError, MarketplaceAuthError, type MarketplaceId } from "@/connectors/types";
import {
  InvoiceRefusedError,
  type FiscalContext,
  type FiscalProvider,
  type InvoiceDocument,
  type InvoiceReadiness,
} from "@/fiscal/types";
import { db } from "@/server/db";
import {
  getAccessToken,
  ReconnectRequiredError,
  type TokenDeps,
} from "@/server/marketplaces/token-service";

import { Prisma } from "@/generated/prisma/client";

// Sale invoices (Phase 4A). Internal routine: unscoped `db`, always filtered by
// the organization. Safety against DUPLICATE invoices (an NF-e can't be undone):
// 1. before issuing, ask the provider whether the order already has one (it may
//    have been issued in the seller panel);
// 2. one request per cart at a time: an advisory lock + a "requesting" row;
// 3. the issue call is never retried automatically; when its answer is lost,
//    the provider is asked again instead of re-issuing;
// 4. a cart always goes complete (all its orders), as the provider requires.

export type FiscalDeps = TokenDeps & {
  providerFor?: (marketplace: MarketplaceId) => FiscalProvider;
};

export function getFiscalProvider(marketplace: MarketplaceId): FiscalProvider {
  switch (marketplace) {
    case "mercadolivre":
      return createMercadoLivreInvoicer();
  }
}

/** Which provider row type an account uses (only Mercado Livre for now). */
function providerOf(marketplace: MarketplaceId): "mercadolivre" {
  switch (marketplace) {
    case "mercadolivre":
      return "mercadolivre";
  }
}

/** A "requesting" row older than this is from a request that died midway. */
const REQUEST_STALE_MS = 5 * 60 * 1000;

type InvoiceAccount = {
  id: string;
  organizationId: string;
  marketplace: MarketplaceId;
  externalUserId: string;
};

function invoiceData(doc: InvoiceDocument) {
  return {
    externalId: doc.externalId,
    status: doc.status,
    number: doc.number,
    series: doc.series,
    accessKey: doc.accessKey,
    amountCents: doc.amountCents,
    issuedAt: doc.issuedAt,
    danfePath: doc.danfePath,
    xmlPath: doc.xmlPath,
    errorCode: null,
    errorMessage: null,
    raw: (doc.raw ?? {}) as Prisma.InputJsonValue,
  };
}

/** Saves an invoice found/issued at the provider and links the cart orders to it. */
async function saveInvoice(
  account: InvoiceAccount,
  packKey: string,
  orderIds: string[],
  doc: InvoiceDocument,
  requestId: string | null,
  requestedById: string | null,
) {
  const organizationId = account.organizationId;
  const data = invoiceData(doc);
  return db.$transaction(async (tx) => {
    const existing = await tx.invoice.findFirst({
      where: { organizationId, marketplaceAccountId: account.id, externalId: doc.externalId },
      select: { id: true },
    });
    let invoiceId: string;
    if (existing) {
      invoiceId = existing.id;
      await tx.invoice.update({ where: { id: invoiceId }, data });
      if (requestId && requestId !== invoiceId) {
        await tx.invoice.deleteMany({ where: { id: requestId, organizationId } });
      }
    } else if (requestId) {
      invoiceId = requestId;
      await tx.invoice.update({ where: { id: requestId }, data });
    } else {
      invoiceId = (
        await tx.invoice.create({
          data: {
            organizationId,
            marketplaceAccountId: account.id,
            provider: providerOf(account.marketplace),
            packKey,
            requestedById,
            ...data,
          },
          select: { id: true },
        })
      ).id;
    }
    await tx.order.updateMany({
      where: { organizationId, id: { in: orderIds } },
      data: { invoiceId, invoiceCheckedAt: new Date() },
    });
    return invoiceId;
  });
}

/** Orders of the same cart (pack), as stored. */
async function cartOrders(organizationId: string, accountId: string, packKey: string) {
  return db.order.findMany({
    where: {
      organizationId,
      marketplaceAccountId: accountId,
      OR: [{ packId: packKey }, { packId: null, externalId: packKey }],
    },
    select: { id: true, externalId: true, status: true, stage: true, invoiceId: true },
    orderBy: { externalId: "asc" },
  });
}

/**
 * Looks up (read only) the invoice of an order that has none in the ERP yet,
 * e.g. issued in the seller panel. Used when shipments are refreshed.
 */
export async function syncInvoiceForOrder(
  account: InvoiceAccount,
  accessToken: string,
  order: { id: string; externalId: string; packId: string | null },
  deps: FiscalDeps = {},
): Promise<boolean> {
  const provider = (deps.providerFor ?? getFiscalProvider)(account.marketplace);
  const ctx: FiscalContext = { accessToken, sellerId: account.externalUserId };
  const doc = await provider.findInvoiceForOrder(ctx, order.externalId);
  const packKey = order.packId ?? order.externalId;
  if (!doc) {
    await db.order.updateMany({
      where: { id: order.id, organizationId: account.organizationId },
      data: { invoiceCheckedAt: new Date() },
    });
    return false;
  }
  const orders = await cartOrders(account.organizationId, account.id, packKey);
  await saveInvoice(
    account,
    packKey,
    orders.map((row) => row.id),
    doc,
    null,
    null,
  );
  return true;
}

/** Stages after the invoice step: their invoice exists at the provider. */
const INVOICED_STAGES = ["ready_to_print", "printed", "shipped", "delivered"] as const;
/** Don't look up the same order again before this. */
const INVOICE_RECHECK_MS = 30 * 60 * 1000;

/**
 * After a shipment refresh: brings in the invoice of its orders when the
 * shipment is past the invoice step and the ERP has none yet (read only).
 */
export async function syncInvoicesForShipment(
  account: InvoiceAccount,
  accessToken: string,
  shippingId: string,
  deps: FiscalDeps = {},
): Promise<void> {
  const orders = await db.order.findMany({
    where: {
      organizationId: account.organizationId,
      marketplaceAccountId: account.id,
      shippingId,
      invoiceId: null,
      stage: { in: [...INVOICED_STAGES] },
      OR: [
        { invoiceCheckedAt: null },
        { invoiceCheckedAt: { lt: new Date(Date.now() - INVOICE_RECHECK_MS) } },
      ],
    },
    select: { id: true, externalId: true, packId: true },
  });
  const seen = new Set<string>();
  for (const order of orders) {
    const packKey = order.packId ?? order.externalId;
    if (seen.has(packKey)) continue;
    seen.add(packKey);
    await syncInvoiceForOrder(account, accessToken, order, deps);
  }
}

export type IssueOutcome =
  | { status: "issued" | "already_had"; packKey: string; number: number | null }
  | { status: "refused"; packKey: string; reason: string }
  | { status: "skipped"; packKey: string; reason: string }
  | { status: "unknown"; packKey: string; reason: string };

export type IssueResult =
  | { status: "done"; outcomes: IssueOutcome[] }
  | { status: "reconnect" | "not_found" | "many_accounts" };

const SKIP = {
  cancelled: "Pedido cancelado: não se emite NF.",
  notPending: "O envio não está aguardando NF.",
  busy: "Já existe uma emissão em andamento para este carrinho.",
} as const;

/**
 * Issues the invoices of the selected orders (one per cart). Every cart is
 * handled on its own: a refusal in one does not stop the others.
 */
export async function issueInvoices(
  organizationId: string,
  requestedById: string | null,
  orderIds: string[],
  deps: FiscalDeps = {},
): Promise<IssueResult> {
  const selected = await db.order.findMany({
    where: { organizationId, id: { in: orderIds } },
    select: {
      externalId: true,
      packId: true,
      marketplaceAccountId: true,
      account: {
        select: {
          id: true,
          organizationId: true,
          marketplace: true,
          externalUserId: true,
          status: true,
        },
      },
    },
  });
  if (selected.length === 0) return { status: "not_found" };
  const accountIds = new Set(selected.map((order) => order.marketplaceAccountId));
  if (accountIds.size > 1) return { status: "many_accounts" };
  const account = selected[0]!.account;
  const provider = (deps.providerFor ?? getFiscalProvider)(account.marketplace);

  let token: string;
  try {
    token = await getAccessToken(organizationId, account.id, deps);
  } catch (error) {
    if (error instanceof ReconnectRequiredError) return { status: "reconnect" };
    throw error;
  }
  const ctx: FiscalContext = { accessToken: token, sellerId: account.externalUserId };

  const packKeys = [...new Set(selected.map((order) => order.packId ?? order.externalId))];
  const outcomes: IssueOutcome[] = [];
  for (const packKey of packKeys) {
    try {
      outcomes.push(await issueCart(account, provider, ctx, packKey, requestedById));
    } catch (error) {
      if (error instanceof MarketplaceAuthError) return { status: "reconnect" };
      throw error;
    }
  }
  return { status: "done", outcomes };
}

async function issueCart(
  account: InvoiceAccount,
  provider: FiscalProvider,
  ctx: FiscalContext,
  packKey: string,
  requestedById: string | null,
): Promise<IssueOutcome> {
  const organizationId = account.organizationId;
  const orders = await cartOrders(organizationId, account.id, packKey);
  if (orders.length === 0) return { status: "skipped", packKey, reason: SKIP.notPending };
  if (orders.some((order) => order.status === "cancelled" || order.stage === "cancelled")) {
    return { status: "skipped", packKey, reason: SKIP.cancelled };
  }

  // 1. Already invoiced at the provider (ERP or seller panel)?
  const existing = await provider.findInvoiceForOrder(ctx, orders[0]!.externalId);
  if (existing) {
    await saveInvoice(
      account,
      packKey,
      orders.map((order) => order.id),
      existing,
      null,
      requestedById,
    );
    return { status: "already_had", packKey, number: existing.number };
  }
  if (!orders.some((order) => order.stage === "invoice_pending")) {
    return { status: "skipped", packKey, reason: SKIP.notPending };
  }

  // 2. Claim the cart: one request at a time.
  const requestId = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${account.id}:${packKey}`}))`;
    const open = await tx.invoice.findFirst({
      where: {
        organizationId,
        marketplaceAccountId: account.id,
        packKey,
        status: "requesting",
        createdAt: { gt: new Date(Date.now() - REQUEST_STALE_MS) },
      },
      select: { id: true },
    });
    if (open) return null;
    return (
      await tx.invoice.create({
        data: {
          organizationId,
          marketplaceAccountId: account.id,
          provider: providerOf(account.marketplace),
          status: "requesting",
          packKey,
          requestedById,
        },
        select: { id: true },
      })
    ).id;
  });
  if (!requestId) return { status: "skipped", packKey, reason: SKIP.busy };

  // 3. Issue (never retried automatically).
  try {
    const doc = await provider.issueForOrders(
      ctx,
      orders.map((order) => order.externalId),
    );
    await saveInvoice(
      account,
      packKey,
      orders.map((order) => order.id),
      doc,
      requestId,
      requestedById,
    );
    return { status: "issued", packKey, number: doc.number };
  } catch (error) {
    if (error instanceof InvoiceRefusedError) {
      await db.invoice.updateMany({
        where: { id: requestId, organizationId },
        data: { status: "error", errorCode: error.code, errorMessage: error.reason },
      });
      return { status: "refused", packKey, reason: error.reason };
    }
    if (error instanceof MarketplaceApiError) {
      // Lost answer: was it issued after all?
      const after = await provider
        .findInvoiceForOrder(ctx, orders[0]!.externalId)
        .catch(() => null);
      if (after) {
        await saveInvoice(
          account,
          packKey,
          orders.map((order) => order.id),
          after,
          requestId,
          requestedById,
        );
        return { status: "issued", packKey, number: after.number };
      }
      const reason =
        "O Mercado Livre não confirmou a emissão. Confira no painel do ML antes de tentar de novo.";
      await db.invoice.updateMany({
        where: { id: requestId, organizationId },
        data: { status: "error", errorMessage: reason },
      });
      return { status: "unknown", packKey, reason };
    }
    // Unexpected: release the claim so the user can check and retry.
    await db.invoice.deleteMany({ where: { id: requestId, organizationId } });
    throw error;
  }
}

export type ReadinessRow = {
  orderId: string;
  externalId: string;
  ready: boolean;
  problems: string[];
};

/** Checks (read only) whether the listings of the selected orders can be invoiced. */
export async function checkInvoiceReadiness(
  organizationId: string,
  orderIds: string[],
  deps: FiscalDeps = {},
): Promise<ReadinessRow[] | "reconnect"> {
  const orders = await db.order.findMany({
    where: { organizationId, id: { in: orderIds } },
    select: {
      id: true,
      externalId: true,
      marketplaceAccountId: true,
      account: { select: { marketplace: true, externalUserId: true } },
      items: {
        select: {
          externalItemId: true,
          variationKey: true,
        },
      },
    },
  });
  const cache = new Map<string, InvoiceReadiness>();
  const rows: ReadinessRow[] = [];
  for (const order of orders) {
    let token: string;
    try {
      token = await getAccessToken(organizationId, order.marketplaceAccountId, deps);
    } catch (error) {
      if (error instanceof ReconnectRequiredError) return "reconnect";
      throw error;
    }
    const provider = (deps.providerFor ?? getFiscalProvider)(order.account.marketplace);
    const ctx = { accessToken: token, sellerId: order.account.externalUserId };
    const problems: string[] = [];
    for (const item of order.items) {
      const key = `${item.externalItemId}:${item.variationKey}`;
      let readiness = cache.get(key);
      if (!readiness) {
        try {
          readiness = await provider.checkListing(
            ctx,
            item.externalItemId,
            item.variationKey || null,
          );
        } catch (error) {
          if (error instanceof MarketplaceAuthError) return "reconnect";
          readiness = { ok: false, restrictions: ["Não foi possível conferir no Mercado Livre."] };
        }
        cache.set(key, readiness);
      }
      if (!readiness.ok) {
        problems.push(
          `${item.externalItemId}: ${
            readiness.restrictions.join("; ") || "dados fiscais incompletos no Mercado Livre"
          }`,
        );
      }
    }
    rows.push({
      orderId: order.id,
      externalId: order.externalId,
      ready: problems.length === 0,
      problems,
    });
  }
  return rows;
}
