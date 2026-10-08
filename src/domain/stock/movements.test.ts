import { describe, expect, it } from "vitest";

import { allowsNegative, signedQuantity, stockAdjustmentSchema } from "@/domain/stock/movements";

describe("signedQuantity", () => {
  it("adds for entries and returns, subtracts for exits and sales", () => {
    expect(signedQuantity("manual_in", 5)).toBe(5);
    expect(signedQuantity("sale_return", 1)).toBe(1);
    expect(signedQuantity("manual_out", 5)).toBe(-5);
    expect(signedQuantity("sale", 2)).toBe(-2);
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects quantity %s", (quantity) => {
    expect(() => signedQuantity("manual_in", quantity)).toThrow(RangeError);
  });
});

describe("allowsNegative", () => {
  it("only sales can push stock below zero", () => {
    expect(allowsNegative("sale")).toBe(true);
    expect(allowsNegative("manual_out")).toBe(false);
    expect(allowsNegative("count")).toBe(false);
  });
});

describe("stockAdjustmentSchema", () => {
  const skuId = "8b0f3f8e-1d7c-4b8a-9a52-1b0c7c1a2f10";

  it("parses an entry", () => {
    expect(
      stockAdjustmentSchema.parse({ skuId, type: "manual_in", quantity: " 12 ", reason: "" }),
    ).toEqual({ skuId, type: "manual_in", quantity: 12, reason: null });
  });

  it("allows counting zero units", () => {
    expect(
      stockAdjustmentSchema.parse({ skuId, type: "count", quantity: "0", reason: "Inventário" })
        .quantity,
    ).toBe(0);
  });

  it.each([
    { type: "manual_in", quantity: "0" },
    { type: "manual_out", quantity: "2,5" },
    { type: "manual_out", quantity: "-3" },
    { type: "sale", quantity: "1" },
  ])("rejects %j", (fields) => {
    expect(stockAdjustmentSchema.safeParse({ skuId, reason: "", ...fields }).success).toBe(false);
  });
});
