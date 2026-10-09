import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { applyFiscalPatch, listFiscalSkus } from "@/server/products/fiscal-bulk";
import { tenantDb } from "@/server/tenant/tenant-db";

// Real database (`npm run test:db`) in a TEMPORARY organization deleted at the end.

let organizationId: string;
const ids: Record<string, string> = {};
const tdb = () => tenantDb(organizationId);
const sku = (code: string) => db.sku.findFirstOrThrow({ where: { organizationId, code } });

beforeAll(async () => {
  organizationId = (await db.organization.create({ data: { name: "[teste] fiscal" } })).id;
  const canecas = await db.product.create({ data: { organizationId, name: "Caneca chope" } });
  const garrafa = await db.product.create({ data: { organizationId, name: "Garrafa térmica" } });
  const antiga = await db.product.create({
    data: { organizationId, name: "Caneca antiga", archivedAt: new Date() },
  });
  for (const [code, productId, extra] of [
    ["CAN-1", canecas.id, {}],
    ["CAN-2", canecas.id, {}],
    ["GAR-1", garrafa.id, { ncm: "96170010", origin: 0, defaultCfop: "5102" }],
    ["OLD-1", antiga.id, {}],
  ] as const) {
    ids[code] = (
      await db.sku.create({
        data: { organizationId, productId, code, stockOnHand: 7, costCents: 1000, ...extra },
      })
    ).id;
  }
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

describe("bulk fiscal against the database", () => {
  it("lists only incomplete SKUs of active products", async () => {
    const result = await listFiscalSkus(tdb(), { incompleteOnly: true }, 1);
    expect(result.skus.map((row) => row.code)).toEqual(["CAN-1", "CAN-2"]);
  });

  it("applies only the filled fields to the selected SKUs, nothing else changes", async () => {
    const count = await applyFiscalPatch(
      tdb(),
      { ncm: "70133700" },
      {
        mode: "selected",
        skuIds: [ids["CAN-1"] as string],
      },
    );
    expect(count).toBe(1);
    const changed = await sku("CAN-1");
    expect(changed).toMatchObject({
      ncm: "70133700",
      origin: null,
      stockOnHand: 7,
      costCents: 1000,
      code: "CAN-1",
    });
    expect((await sku("CAN-2")).ncm).toBeNull();
  });

  it("'all matching the filter' re-runs the search on the server", async () => {
    const count = await applyFiscalPatch(
      tdb(),
      { origin: 0, defaultCfop: "5102" },
      {
        mode: "filter",
        filter: { search: "caneca", incompleteOnly: true },
      },
    );
    expect(count).toBe(2); // CAN-1, CAN-2 (the archived "Caneca antiga" is excluded)
    expect((await sku("OLD-1")).origin).toBeNull();
    expect((await sku("GAR-1")).defaultCfop).toBe("5102");
    expect(await sku("CAN-2")).toMatchObject({ origin: 0, defaultCfop: "5102" });
  });

  it("never touches archived products or another organization", async () => {
    expect(
      await applyFiscalPatch(
        tdb(),
        { ncm: "11111111" },
        {
          mode: "selected",
          skuIds: [ids["OLD-1"] as string],
        },
      ),
    ).toBe(0);
    expect(
      await applyFiscalPatch(
        tenantDb(randomUUID()),
        { ncm: "11111111" },
        {
          mode: "selected",
          skuIds: [ids["CAN-1"] as string],
        },
      ),
    ).toBe(0);
    expect((await sku("CAN-1")).ncm).toBe("70133700");
  });
});
