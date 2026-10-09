import "server-only";

import {
  MarketplaceApiError,
  MarketplaceAuthError,
  MarketplaceValidationError,
  type LabelFile,
  type LabelFormat,
} from "@/connectors/types";
import { canPrintLabel } from "@/domain/orders/stage";
import { getConnector } from "@/server/marketplaces/config";
import { getAccessToken, ReconnectRequiredError } from "@/server/marketplaces/token-service";
import type { TenantDb } from "@/server/tenant/tenant-db";

import type { OrderSyncDeps } from "./order-sync";
import { refreshShipment } from "./shipment-service";

// Shipping labels for selected orders (Mercado Envios 2, max 50 shipments per
// call: https://developers.mercadolivre.com.br/pt_br/mercado-envios-2).
// Orders of one cart share one shipment -> one label.

export const MAX_LABELS = 50;

export type LabelResult =
  | { status: "ok"; file: LabelFile; labels: number; skipped: number }
  | { status: "none_printable" | "many_accounts" | "too_many" | "reconnect" | "marketplace_error" }
  | { status: "refused"; message: string };

export async function printLabels(
  tdb: TenantDb,
  organizationId: string,
  orderIds: string[],
  format: LabelFormat,
  deps: OrderSyncDeps = {},
): Promise<LabelResult> {
  const connectorFor = deps.connectorFor ?? getConnector;
  const orders = await tdb.order.findMany({
    where: { id: { in: orderIds } },
    select: {
      stage: true,
      shipmentMode: true,
      shippingId: true,
      marketplaceAccountId: true,
      account: { select: { marketplace: true } },
    },
  });
  const printable = orders.filter(canPrintLabel);
  if (printable.length === 0) return { status: "none_printable" };
  const accountIds = new Set(printable.map((order) => order.marketplaceAccountId));
  if (accountIds.size > 1) return { status: "many_accounts" };
  const shippingIds = [...new Set(printable.map((order) => order.shippingId!))];
  if (shippingIds.length > MAX_LABELS) return { status: "too_many" };

  const accountId = printable[0]!.marketplaceAccountId;
  const connector = connectorFor(printable[0]!.account.marketplace);
  try {
    const token = await getAccessToken(organizationId, accountId, deps);
    const file = await connector.getShippingLabels(token, shippingIds, format);
    // Printing moves the shipments to "printed": refresh them (best effort).
    const account = { id: accountId, organizationId };
    for (const shippingId of shippingIds) {
      try {
        await refreshShipment(account, connector, token, shippingId, new Date());
      } catch {
        // the next catch-up refreshes it
      }
    }
    return {
      status: "ok",
      file,
      labels: shippingIds.length,
      skipped: orders.length - printable.length,
    };
  } catch (error) {
    if (error instanceof ReconnectRequiredError || error instanceof MarketplaceAuthError) {
      return { status: "reconnect" };
    }
    if (error instanceof MarketplaceValidationError) {
      return { status: "refused", message: error.causes.join(" ") };
    }
    if (error instanceof MarketplaceApiError) return { status: "marketplace_error" };
    throw error;
  }
}
