import { z } from "zod";

import {
  InvoiceRefusedError,
  type FiscalContext,
  type FiscalFile,
  type FiscalProvider,
  type InvoiceDocument,
  type InvoiceReadiness,
} from "@/fiscal/types";

import { MarketplaceApiError, MarketplaceAuthError } from "../types";
import { ML_API_BASE, mlFetch, type FetchFn } from "./http";
import { toCents } from "./items";

// Mercado Livre's invoice issuer (Faturador) as a FiscalProvider.
// Docs: https://developers.mercadolivre.com.br/pt_br/api-fiscal-faturamento-de-venda
// - POST /users/{USER_ID}/invoices/orders {"orders":[id,...]}: issues ONE invoice;
//   a cart must list all its orders. Errors: { message, error_code }, readable
//   text at GET /users/invoices/errors/MLB/{error_code} (display_message).
// Consulting: https://developers.mercadolivre.com.br/pt_br/obtendo-nota-fiscal
// - GET /users/{USER_ID}/invoices/orders/{ORDER_ID}: the invoice of a sale
//   (seen on BELA 2026-10-09: 404 "Invoice not found" when there is none).
// - attributes.danfe_location / xml_location: paths to download the files.
// Readiness: https://developers.mercadolivre.com.br/pt_br/envio-dos-dados-fiscais
// - GET /can_invoice/items/{ITEM_ID}[/variations/{VARIATION_ID}]: { status, restrictions }.

const ORDER_ID = /^\d{1,30}$/;

async function call(fetchFn: FetchFn, accessToken: string, path: string, init: RequestInit = {}) {
  const response = await mlFetch(fetchFn, `${ML_API_BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) },
  });
  if (response.status === 401) {
    throw new MarketplaceAuthError("Mercado Livre rejected the access token.", "unauthorized");
  }
  return response;
}

async function json(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const idSchema = z.union([z.number(), z.string()]).transform(String);

const invoiceSchema = z
  .object({
    id: idSchema,
    status: z.string().nullish(),
    invoice_number: z.union([z.number(), z.string()]).nullish(),
    invoice_series: z.union([z.number(), z.string()]).nullish(),
    amount: z.number().nullish(),
    issued_date: z.string().nullish(),
    attributes: z
      .object({
        invoice_key: z.string().nullish(),
        authorization_date: z.string().nullish(),
        danfe_location: z.string().nullish(),
        xml_location: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

/**
 * The docs show dates without a time zone ("2020-03-06T17:52:05.269"); they are
 * read as Brasília time (-03:00). TO CONFIRM against the ML panel on a real invoice.
 */
function mlDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const withZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}-03:00`;
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeInvoice(body: unknown): InvoiceDocument {
  const parsed = invoiceSchema.safeParse(body);
  if (!parsed.success) throw new MarketplaceApiError("Unexpected invoice response.", 200);
  const invoice = parsed.data;
  const number = invoice.invoice_number == null ? null : Number(invoice.invoice_number);
  return {
    externalId: invoice.id,
    status: invoice.status ?? "unknown",
    number: Number.isFinite(number) ? number : null,
    series: invoice.invoice_series == null ? null : String(invoice.invoice_series),
    accessKey: invoice.attributes?.invoice_key ?? null,
    amountCents: toCents(invoice.amount),
    issuedAt: mlDate(invoice.attributes?.authorization_date ?? invoice.issued_date),
    danfePath: invoice.attributes?.danfe_location ?? null,
    xmlPath: invoice.attributes?.xml_location ?? null,
    raw: body,
  };
}

export async function findInvoiceForOrder(
  fetchFn: FetchFn,
  ctx: FiscalContext,
  externalOrderId: string,
): Promise<InvoiceDocument | null> {
  const path = `/users/${encodeURIComponent(ctx.sellerId)}/invoices/orders/${encodeURIComponent(externalOrderId)}`;
  const response = await call(fetchFn, ctx.accessToken, path);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new MarketplaceApiError("Invoice read failed.", response.status);
  }
  return normalizeInvoice(await response.json());
}

/** Readable text of an issuer error code (best effort). */
async function errorText(fetchFn: FetchFn, accessToken: string, code: string) {
  try {
    const response = await call(
      fetchFn,
      accessToken,
      `/users/invoices/errors/MLB/${encodeURIComponent(code)}`,
    );
    if (!response.ok) return null;
    const body = await json(response);
    return typeof body.display_message === "string" ? body.display_message : null;
  } catch {
    return null;
  }
}

export async function issueForOrders(
  fetchFn: FetchFn,
  ctx: FiscalContext,
  externalOrderIds: string[],
): Promise<InvoiceDocument> {
  if (externalOrderIds.length === 0 || !externalOrderIds.every((id) => ORDER_ID.test(id))) {
    throw new RangeError("Invoice: order ids must be numeric.");
  }
  // Order ids written as JSON numbers without going through JS numbers (no rounding).
  const body = `{"orders":[${externalOrderIds.join(",")}]}`;
  // NEVER retried automatically (unlike mlFetch): a retry after a lost answer
  // could issue a second invoice. On network errors the caller checks
  // findInvoiceForOrder to learn whether it was issued.
  let response: Response;
  try {
    response = await fetchFn(
      `${ML_API_BASE}/users/${encodeURIComponent(ctx.sellerId)}/invoices/orders`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${ctx.accessToken}`, "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(60_000),
      },
    );
  } catch (error) {
    throw new MarketplaceApiError(
      `Invoice issue: no answer (${error instanceof Error ? error.name : "network error"}).`,
      null,
    );
  }
  if (response.status === 401) {
    throw new MarketplaceAuthError("Mercado Livre rejected the access token.", "unauthorized");
  }
  const payload = await json(response);
  if (response.status >= 500) {
    throw new MarketplaceApiError("Invoice issue failed.", response.status);
  }
  if (!response.ok) {
    const code = payload.error_code == null ? null : String(payload.error_code);
    const message = typeof payload.message === "string" ? payload.message : null;
    const readable = (code && (await errorText(fetchFn, ctx.accessToken, code))) || message;
    throw new InvoiceRefusedError(code, readable ?? `HTTP ${response.status}`);
  }
  return normalizeInvoice(payload);
}

function restrictionText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["message", "description", "display_message", "reason", "code", "id"]) {
      if (typeof record[key] === "string") return record[key] as string;
    }
  }
  return JSON.stringify(value);
}

export async function checkListing(
  fetchFn: FetchFn,
  ctx: FiscalContext,
  externalItemId: string,
  variationId?: string | null,
): Promise<InvoiceReadiness> {
  const path = variationId
    ? `/can_invoice/items/${encodeURIComponent(externalItemId)}/variations/${encodeURIComponent(variationId)}`
    : `/can_invoice/items/${encodeURIComponent(externalItemId)}`;
  const response = await call(fetchFn, ctx.accessToken, path);
  if (!response.ok) throw new MarketplaceApiError("Invoice readiness failed.", response.status);
  const body = await json(response);
  const restrictions = Array.isArray(body.restrictions)
    ? body.restrictions.map(restrictionText)
    : [];
  return { ok: body.status === true, restrictions };
}

export async function download(
  fetchFn: FetchFn,
  ctx: FiscalContext,
  path: string,
): Promise<FiscalFile> {
  // Only the seller's own invoice documents (paths returned by the API).
  if (!path.startsWith(`/users/${ctx.sellerId}/invoices/`)) {
    throw new RangeError("Invoice: unexpected document path.");
  }
  const response = await call(fetchFn, ctx.accessToken, path);
  if (!response.ok) throw new MarketplaceApiError("Invoice download failed.", response.status);
  return {
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    data: await response.arrayBuffer(),
  };
}

export function createMercadoLivreInvoicer(fetchFn: FetchFn = fetch): FiscalProvider {
  return {
    id: "mercadolivre",
    findInvoiceForOrder: (ctx, orderId) => findInvoiceForOrder(fetchFn, ctx, orderId),
    issueForOrders: (ctx, orderIds) => issueForOrders(fetchFn, ctx, orderIds),
    checkListing: (ctx, itemId, variationId) => checkListing(fetchFn, ctx, itemId, variationId),
    download: (ctx, path) => download(fetchFn, ctx, path),
  };
}
