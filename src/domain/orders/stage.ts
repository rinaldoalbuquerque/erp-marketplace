// Shipping stage of an order (pure). Statuses/substatuses from ML /shipment_statuses:
// https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-envios
// Label rule (https://developers.mercadolivre.com.br/pt_br/mercado-envios-2): printable
// only in ready_to_ship + ready_to_print; reprint in printed; never for Fulfillment.

export type OrderStage =
  | "pending"
  | "invoice_pending"
  | "ready_to_print"
  | "printed"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "fulfillment"
  | "other";

export type StageInput = {
  orderStatus: string;
  hasShipment: boolean;
  logisticType: string | null;
  shipmentStatus: string | null;
  shipmentSubstatus: string | null;
};

const CANCELLED_ORDER = new Set(["cancelled", "invalid"]);
/** After the label: collected or on the way to the marketplace network. */
const PICKED_UP = new Set(["picked_up"]);

export function orderStage(input: StageInput): OrderStage {
  if (CANCELLED_ORDER.has(input.orderStatus)) return "cancelled";
  if (input.shipmentStatus === "cancelled") return "cancelled";
  if (input.logisticType === "fulfillment") return "fulfillment";
  if (!input.hasShipment) return input.orderStatus === "paid" ? "other" : "pending";

  switch (input.shipmentStatus) {
    case null:
    case "pending":
      return "pending";
    case "to_be_agreed":
      return "other";
    case "handling":
      return input.shipmentSubstatus === "invoice_pending" ? "invoice_pending" : "pending";
    case "ready_to_ship":
      if (input.shipmentSubstatus === "invoice_pending") return "invoice_pending";
      if (input.shipmentSubstatus === "ready_to_print") return "ready_to_print";
      if (input.shipmentSubstatus && PICKED_UP.has(input.shipmentSubstatus)) return "shipped";
      return "printed"; // printed, in_pickup_list, ready_for_pickup, ready_for_dropoff...
    case "shipped":
      return "shipped";
    case "delivered":
      return "delivered";
    default:
      return "other"; // not_delivered, not_verified...
  }
}

/** Label can be (re)printed now (by the marketplace rule above). */
export function canPrintLabel(input: {
  stage: OrderStage;
  shipmentMode: string | null;
  shippingId: string | null;
}): boolean {
  return (
    input.shippingId !== null &&
    input.shipmentMode === "me2" &&
    (input.stage === "ready_to_print" || input.stage === "printed")
  );
}

/** Stages whose shipment still changes (worth refreshing). */
export const OPEN_STAGES: readonly OrderStage[] = [
  "pending",
  "invoice_pending",
  "ready_to_print",
  "printed",
  "shipped",
];

/** Stages where the dispatch deadline matters (SLA). */
export const DEADLINE_STAGES: readonly OrderStage[] = [
  "pending",
  "invoice_pending",
  "ready_to_print",
  "printed",
];
