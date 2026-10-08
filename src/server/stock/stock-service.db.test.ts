import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { adjustStock } from "@/server/stock/stock-service";
import { tenantDb } from "@/server/tenant/tenant-db";

// Runs against the real database (`npm run test:db`) inside a TEMPORARY
// organization created here and deleted at the end (cascade). Never touches
// real data.

let organizationId: string;
let otherOrganizationId: string;
let productId: string;
let skuId: string;

const tdb = () => tenantDb(organizationId);
const balance = async () => (await db.sku.findUniqueOrThrow({ where: { id: skuId } })).stockOnHand;
const movementCount = () => db.stockMovement.count({ where: { skuId } });

beforeAll(async () => {
  organizationId = (await db.organization.create({ data: { name: "[teste] estoque" } })).id;
  otherOrganizationId = (await db.organization.create({ data: { name: "[teste] outra" } })).id;
  productId = (await db.product.create({ data: { organizationId, name: "Produto de teste" } })).id;
});

afterAll(async () => {
  await db.organization.deleteMany({
    where: { id: { in: [organizationId, otherOrganizationId] } },
  });
  await db.$disconnect();
});

beforeEach(async () => {
  // A fresh SKU per test, starting at 10 units (set through the service itself).
  skuId = (
    await db.sku.create({
      data: { organizationId, productId, code: `TESTE-${randomUUID().slice(0, 8)}` },
    })
  ).id;
  await adjustStock(tdb(), { organizationId, skuId, type: "manual_in", quantity: 10 });
});

describe("adjustStock against the database", () => {
  it("applies an entry and records the movement with the balance after", async () => {
    const result = await adjustStock(tdb(), {
      organizationId,
      skuId,
      type: "manual_in",
      quantity: 5,
      reason: "Compra",
    });
    expect(result).toMatchObject({ status: "applied", balance: 15, change: 5 });
    const last = await db.stockMovement.findFirstOrThrow({
      where: { skuId },
      orderBy: { createdAt: "desc" },
    });
    expect(last).toMatchObject({
      type: "manual_in",
      quantity: 5,
      balanceAfter: 15,
      reason: "Compra",
    });
  });

  it("refuses a manual exit that would go below zero, changing nothing", async () => {
    const result = await adjustStock(tdb(), {
      organizationId,
      skuId,
      type: "manual_out",
      quantity: 11,
    });
    expect(result).toEqual({ status: "insufficient", balance: 10 });
    expect(await balance()).toBe(10);
    expect(await movementCount()).toBe(1);
  });

  it("lets a sale go below zero (the sale already happened)", async () => {
    const result = await adjustStock(tdb(), { organizationId, skuId, type: "sale", quantity: 12 });
    expect(result).toMatchObject({ status: "applied", balance: -2 });
  });

  it("count sets the balance to the counted amount", async () => {
    const result = await adjustStock(tdb(), {
      organizationId,
      skuId,
      type: "count",
      countedQuantity: 7,
    });
    expect(result).toMatchObject({ status: "applied", balance: 7, change: -3 });
    expect(
      await adjustStock(tdb(), { organizationId, skuId, type: "count", countedQuantity: 7 }),
    ).toEqual({ status: "no_change", balance: 7 });
  });

  it("20 simultaneous exits of 1 unit on a stock of 10: exactly 10 succeed", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        adjustStock(tdb(), { organizationId, skuId, type: "manual_out", quantity: 1 }),
      ),
    );
    expect(results.filter((result) => result.status === "applied")).toHaveLength(10);
    expect(results.filter((result) => result.status === "insufficient")).toHaveLength(10);
    expect(await balance()).toBe(0);
    expect(await movementCount()).toBe(11); // initial entry + 10 exits
  });

  it("10 simultaneous sales: none lost, balance and history agree", async () => {
    await Promise.all(
      Array.from({ length: 10 }, () =>
        adjustStock(tdb(), { organizationId, skuId, type: "sale", quantity: 1 }),
      ),
    );
    expect(await balance()).toBe(0);
    const balances = (
      await db.stockMovement.findMany({
        where: { skuId, type: "sale" },
        select: { balanceAfter: true },
      })
    )
      .map((movement) => movement.balanceAfter)
      .sort((a, b) => a - b);
    expect(balances).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("the same idempotency key is applied once, even concurrently", async () => {
    const key = `sale-${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        adjustStock(tdb(), {
          organizationId,
          skuId,
          type: "sale",
          quantity: 1,
          idempotencyKey: key,
        }),
      ),
    );
    expect(results.filter((result) => result.status === "applied")).toHaveLength(1);
    expect(results.filter((result) => result.status === "duplicate")).toHaveLength(4);
    expect(await balance()).toBe(9);
  });

  it("another organization can't touch this SKU", async () => {
    const result = await adjustStock(tenantDb(otherOrganizationId), {
      organizationId: otherOrganizationId,
      skuId,
      type: "manual_out",
      quantity: 1,
    });
    expect(result).toEqual({ status: "not_found" });
    expect(await balance()).toBe(10);
  });

  it("the database rejects a SKU pointing to another organization's product", async () => {
    await expect(
      db.sku.create({
        data: { organizationId: otherOrganizationId, productId, code: "INVASOR" },
      }),
    ).rejects.toThrow();
  });
});
