import { z } from "zod";

import {
  MarketplaceApiError,
  MarketplaceAuthError,
  MarketplaceValidationError,
  type LabelFile,
  type LabelFormat,
  type MarketplaceShipment,
  type ShipmentSla,
} from "../types";
import { ML_API_BASE, mlFetch, readErrorBody, type FetchFn } from "./http";

// Shipments and labels (Mercado Envios 2).
// Docs: https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-envios
// - GET /shipments/{id} with header "x-format-new: true" (mandatory): status,
//   substatus, logistic.{mode,type}, tracking_number, lead_time.buffering.date.
//   The new format no longer returns order_id: orders point to the shipment.
// - GET /shipments/{id}/sla: expected_date = dispatch deadline; not available
//   for cancelled or Fulfillment shipments.
// Labels: https://developers.mercadolivre.com.br/pt_br/mercado-envios-2
// - GET /shipment_labels?shipment_ids=1,2&response_type=pdf|zpl2, max 50 ids;
//   only status ready_to_ship + substatus ready_to_print (or printed, to reprint);
//   Fulfillment has no label (error invalid_shipment_ff_public).

export const LABELS_PER_CALL = 50;

const NEW_FORMAT = { "x-format-new": "true" };

async function request(
  fetchFn: FetchFn,
  url: string,
  accessToken: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const response = await mlFetch(fetchFn, url, {
    headers: { authorization: `Bearer ${accessToken}`, ...headers },
  });
  if (response.status === 401) {
    throw new MarketplaceAuthError("Mercado Livre rejected the access token.", "unauthorized");
  }
  return response;
}

async function fail(response: Response, what: string): Promise<never> {
  const body = await readErrorBody(response);
  if (response.status >= 400 && response.status < 500 && response.status !== 404) {
    // e.g. 400 not_printable_status, invalid_shipment_ff_public (documented label errors)
    throw new MarketplaceValidationError([
      body.message || body.error || `${what}: HTTP ${response.status}`,
    ]);
  }
  throw new MarketplaceApiError(`${what} failed.`, response.status, body.error ?? null);
}

const idSchema = z.union([z.number(), z.string()]).transform(String);

const shipmentSchema = z
  .object({
    id: idSchema,
    status: z.string().nullish(),
    substatus: z.string().nullish(),
    tracking_number: z.string().nullish(),
    logistic: z
      .object({ mode: z.string().nullish(), type: z.string().nullish() })
      .passthrough()
      .nullish(),
    lead_time: z
      .object({
        buffering: z.object({ date: z.string().nullish() }).passthrough().nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const date = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export function normalizeShipment(body: unknown): MarketplaceShipment {
  const parsed = shipmentSchema.safeParse(body);
  if (!parsed.success) throw new MarketplaceApiError("Unexpected shipment response.", 200);
  const shipment = parsed.data;
  return {
    externalId: shipment.id,
    status: shipment.status ?? null,
    substatus: shipment.substatus ?? null,
    mode: shipment.logistic?.mode ?? null,
    logisticType: shipment.logistic?.type ?? null,
    trackingNumber: shipment.tracking_number ?? null,
    labelAvailableAt: date(shipment.lead_time?.buffering?.date),
    raw: body,
  };
}

export async function getShipment(
  fetchFn: FetchFn,
  accessToken: string,
  externalShipmentId: string,
): Promise<MarketplaceShipment> {
  const url = `${ML_API_BASE}/shipments/${encodeURIComponent(externalShipmentId)}`;
  const response = await request(fetchFn, url, accessToken, NEW_FORMAT);
  if (!response.ok) await fail(response, "Shipment read");
  return normalizeShipment(await response.json());
}

const slaSchema = z
  .object({ status: z.string().nullish(), expected_date: z.string().nullish() })
  .passthrough();

export async function getShipmentSla(
  fetchFn: FetchFn,
  accessToken: string,
  externalShipmentId: string,
): Promise<ShipmentSla | null> {
  const url = `${ML_API_BASE}/shipments/${encodeURIComponent(externalShipmentId)}/sla`;
  const response = await request(fetchFn, url, accessToken);
  if (response.status === 404 || response.status === 400) return null; // no deadline for it
  if (!response.ok) await fail(response, "Shipment SLA read");
  const parsed = slaSchema.safeParse(await response.json());
  if (!parsed.success) return null;
  return { expectedDate: date(parsed.data.expected_date), status: parsed.data.status ?? null };
}

export async function getShippingLabels(
  fetchFn: FetchFn,
  accessToken: string,
  externalShipmentIds: string[],
  format: LabelFormat,
): Promise<LabelFile> {
  if (externalShipmentIds.length === 0 || externalShipmentIds.length > LABELS_PER_CALL) {
    throw new RangeError(`Labels: between 1 and ${LABELS_PER_CALL} shipments per call.`);
  }
  const params = new URLSearchParams({
    shipment_ids: externalShipmentIds.join(","),
    response_type: format === "pdf" ? "pdf" : "zpl2",
  });
  const response = await request(fetchFn, `${ML_API_BASE}/shipment_labels?${params}`, accessToken);
  if (!response.ok) await fail(response, "Shipping labels");
  return {
    contentType:
      response.headers.get("content-type") ??
      (format === "pdf" ? "application/pdf" : "application/octet-stream"),
    data: await response.arrayBuffer(),
  };
}
