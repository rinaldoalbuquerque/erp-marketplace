import { describe, expect, it } from "vitest";

import { canPrintLabel, orderStage, type StageInput } from "@/domain/orders/stage";

const base: StageInput = {
  orderStatus: "paid",
  hasShipment: true,
  logisticType: "xd_drop_off",
  shipmentStatus: "ready_to_ship",
  shipmentSubstatus: "ready_to_print",
};

describe("orderStage", () => {
  it("follows the shipment flow", () => {
    const cases: Array<[string | null, string | null, string]> = [
      ["pending", "buffered", "pending"],
      ["handling", "invoice_pending", "invoice_pending"],
      ["ready_to_ship", "invoice_pending", "invoice_pending"],
      ["ready_to_ship", "ready_to_print", "ready_to_print"],
      ["ready_to_ship", "printed", "printed"],
      ["ready_to_ship", "ready_for_dropoff", "printed"],
      ["ready_to_ship", "picked_up", "shipped"],
      ["shipped", null, "shipped"],
      ["delivered", null, "delivered"],
      ["cancelled", null, "cancelled"],
      ["not_delivered", null, "other"],
    ];
    for (const [shipmentStatus, shipmentSubstatus, stage] of cases) {
      expect(orderStage({ ...base, shipmentStatus, shipmentSubstatus })).toBe(stage);
    }
  });

  it("cancelled orders and Full come first", () => {
    expect(orderStage({ ...base, orderStatus: "cancelled" })).toBe("cancelled");
    expect(orderStage({ ...base, logisticType: "fulfillment" })).toBe("fulfillment");
  });

  it("paid order without marketplace shipping is 'other'", () => {
    expect(orderStage({ ...base, hasShipment: false })).toBe("other");
    expect(orderStage({ ...base, hasShipment: false, orderStatus: "payment_required" })).toBe(
      "pending",
    );
  });
});

describe("canPrintLabel", () => {
  it("only me2 shipments ready to print or already printed", () => {
    const ok = { stage: "ready_to_print" as const, shipmentMode: "me2", shippingId: "1" };
    expect(canPrintLabel(ok)).toBe(true);
    expect(canPrintLabel({ ...ok, stage: "printed" })).toBe(true);
    expect(canPrintLabel({ ...ok, stage: "invoice_pending" })).toBe(false);
    expect(canPrintLabel({ ...ok, shipmentMode: "me1" })).toBe(false);
    expect(canPrintLabel({ ...ok, shippingId: null })).toBe(false);
  });
});
