import { describe, expect, it } from "vitest";

import {
  BULK_SKIP,
  bulkOperationSchema,
  newPrice,
  planBulkItem,
  reverseChange,
} from "@/domain/listings/bulk-edit";

const active = { priceCents: 2990, status: "active", subStatus: [] };

describe("newPrice", () => {
  it("sets, adjusts by % or by R$, rounds to ,90 and never goes below R$ 1,00", () => {
    expect(newPrice({ kind: "price_set", cents: 4990, roundTo90: false }, 2990)).toBe(4990);
    expect(newPrice({ kind: "price_percent", percent: 8, roundTo90: false }, 2990)).toBe(3229);
    expect(newPrice({ kind: "price_percent", percent: 8, roundTo90: true }, 2990)).toBe(3290);
    expect(newPrice({ kind: "price_amount", cents: -200, roundTo90: false }, 2990)).toBe(2790);
    expect(newPrice({ kind: "price_amount", cents: -5000, roundTo90: false }, 2990)).toBe(100);
  });
});

describe("planBulkItem", () => {
  it("plans a price change and flags big changes", () => {
    expect(planBulkItem({ kind: "price_percent", percent: 10, roundTo90: false }, active)).toEqual({
      action: "change",
      change: { field: "price", from: 2990, to: 3289 },
      bigChange: false,
    });
    expect(
      planBulkItem({ kind: "price_set", cents: 9990, roundTo90: false }, active),
    ).toMatchObject({ bigChange: true });
  });

  it("skips what would not change or cannot change", () => {
    expect(planBulkItem({ kind: "price_set", cents: 2990, roundTo90: false }, active)).toEqual({
      action: "skip",
      reason: BULK_SKIP.samePrice,
    });
    expect(
      planBulkItem(
        { kind: "price_set", cents: 1000, roundTo90: false },
        { ...active, status: "closed" },
      ),
    ).toEqual({ action: "skip", reason: BULK_SKIP.closed });
    expect(
      planBulkItem(
        { kind: "price_set", cents: 1000, roundTo90: false },
        { ...active, priceCents: null },
      ),
    ).toEqual({ action: "skip", reason: BULK_SKIP.noPrice });
  });

  it("pauses active listings and reactivates paused ones (not when out of stock)", () => {
    expect(planBulkItem({ kind: "status", status: "paused" }, active)).toMatchObject({
      action: "change",
      change: { field: "status", from: "active", to: "paused" },
    });
    const paused = { ...active, status: "paused" };
    expect(planBulkItem({ kind: "status", status: "active" }, paused)).toMatchObject({
      action: "change",
    });
    expect(
      planBulkItem(
        { kind: "status", status: "active" },
        { ...paused, subStatus: ["out_of_stock"] },
      ),
    ).toEqual({ action: "skip", reason: BULK_SKIP.outOfStock });
    expect(planBulkItem({ kind: "status", status: "paused" }, paused)).toEqual({
      action: "skip",
      reason: BULK_SKIP.sameStatus,
    });
    expect(
      planBulkItem({ kind: "status", status: "active" }, { ...active, status: "under_review" }),
    ).toEqual({ action: "skip", reason: BULK_SKIP.notEditable });
  });

  it("reverses a change (undo)", () => {
    expect(reverseChange({ field: "price", from: 2990, to: 3290 })).toEqual({
      field: "price",
      from: 3290,
      to: 2990,
    });
    expect(reverseChange({ field: "status", from: "active", to: "paused" })).toEqual({
      field: "status",
      from: "paused",
      to: "active",
    });
  });

  it("validates operations coming from the browser", () => {
    expect(
      bulkOperationSchema.safeParse({ kind: "price_set", cents: 50, roundTo90: false }).success,
    ).toBe(false);
    expect(bulkOperationSchema.safeParse({ kind: "status", status: "closed" }).success).toBe(false);
  });
});
