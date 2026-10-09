import { describe, expect, it } from "vitest";

import { decideItemStock, STOCK_NOTES, type ItemStockInput } from "@/domain/orders/stock-rules";

const since = new Date("2026-10-09T12:00:00.000Z");
const paid: ItemStockInput = {
  current: "waiting",
  orderStatus: "paid",
  dateClosed: new Date("2026-10-09T13:00:00.000Z"),
  logisticType: "xd_drop_off",
  account: { orderStockEnabled: true, orderStockSince: since },
  hasSku: true,
};

describe("decideItemStock", () => {
  it("deducts a confirmed sale of a linked listing", () => {
    expect(decideItemStock(paid)).toEqual({ action: "deduct" });
  });

  it("waits while the sale is not confirmed", () => {
    expect(
      decideItemStock({ ...paid, orderStatus: "payment_in_process", dateClosed: null }),
    ).toEqual({ action: "none" });
  });

  it("never deducts Full, switch off, or sales before the switch", () => {
    expect(decideItemStock({ ...paid, logisticType: "fulfillment" })).toMatchObject({
      status: "not_applicable",
      note: STOCK_NOTES.full,
    });
    expect(
      decideItemStock({ ...paid, account: { orderStockEnabled: false, orderStockSince: since } }),
    ).toMatchObject({ status: "not_applicable", note: STOCK_NOTES.off });
    expect(
      decideItemStock({ ...paid, dateClosed: new Date("2026-10-09T11:59:00.000Z") }),
    ).toMatchObject({ status: "not_applicable", note: STOCK_NOTES.beforeSwitch });
  });

  it("flags a sale without SKU once, and deducts if the SKU is linked later", () => {
    expect(decideItemStock({ ...paid, hasSku: false })).toMatchObject({ status: "missing_sku" });
    expect(decideItemStock({ ...paid, current: "missing_sku", hasSku: false })).toEqual({
      action: "none",
    });
    expect(decideItemStock({ ...paid, current: "missing_sku" })).toEqual({ action: "deduct" });
  });

  it("gives stock back only for a cancelled order that was deducted", () => {
    const cancelled = { ...paid, orderStatus: "cancelled" };
    expect(decideItemStock({ ...cancelled, current: "deducted" })).toEqual({ action: "restore" });
    expect(decideItemStock(cancelled)).toMatchObject({
      status: "not_applicable",
      note: STOCK_NOTES.cancelledBefore,
    });
    expect(decideItemStock({ ...cancelled, current: "restored" })).toEqual({ action: "none" });
  });

  it("partial refunds keep the deduction (entry is recorded manually)", () => {
    expect(
      decideItemStock({ ...paid, orderStatus: "partially_refunded", current: "deducted" }),
    ).toEqual({ action: "none" });
  });
});
