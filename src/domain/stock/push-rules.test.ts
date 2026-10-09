import { describe, expect, it } from "vitest";

import { planStockPush, retryDelayMs, SKIP_REASONS } from "@/domain/stock/push-rules";

const normal = { logisticType: "xd_drop_off", variationKey: "", accountMultiWarehouse: false };

describe("planStockPush", () => {
  it("sends the ERP stock to a normal listing", () => {
    expect(planStockPush(normal, 12)).toEqual({ action: "send", quantity: 12 });
  });

  it("sends 0 when the ERP stock is negative", () => {
    expect(planStockPush(normal, -3)).toEqual({ action: "send", quantity: 0 });
  });

  it("skips Full listings (stock managed by Mercado Livre)", () => {
    expect(planStockPush({ ...normal, logisticType: "fulfillment" }, 5)).toEqual({
      action: "skip",
      reason: SKIP_REASONS.full,
    });
  });

  it("skips multi-origin accounts and traditional variations (not supported yet)", () => {
    expect(planStockPush({ ...normal, accountMultiWarehouse: true }, 5)).toMatchObject({
      action: "skip",
    });
    expect(planStockPush({ ...normal, variationKey: "V1" }, 5)).toEqual({
      action: "skip",
      reason: SKIP_REASONS.variation,
    });
  });
});

describe("retryDelayMs", () => {
  it("waits longer after each failure and gives up after 4 retries", () => {
    expect([1, 2, 3, 4].map((attempts) => retryDelayMs(attempts))).toEqual([
      60_000, 300_000, 900_000, 3_600_000,
    ]);
    expect(retryDelayMs(5)).toBeNull();
  });
});
