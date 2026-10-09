import { describe, expect, it } from "vitest";

import { fiscalSkuWhere } from "@/server/products/fiscal-bulk";

describe("fiscalSkuWhere", () => {
  it("always excludes archived products", () => {
    expect(fiscalSkuWhere({})).toEqual({ AND: [{ product: { archivedAt: null } }] });
  });

  it("'incomplete' means missing NCM, origin or CFOP", () => {
    expect(fiscalSkuWhere({ incompleteOnly: true }).AND).toContainEqual({
      OR: [{ ncm: null }, { origin: null }, { defaultCfop: null }],
    });
  });

  it("searches name, brand, code and (with digits) EAN and NCM", () => {
    const where = fiscalSkuWhere({ search: "caneca" });
    const search = (where.AND as Array<{ OR?: unknown[] }>).at(-1)?.OR;
    expect(search).toContainEqual({
      product: { name: { contains: "caneca", mode: "insensitive" } },
    });
    expect(search).toContainEqual({ code: { contains: "CANECA" } });
    expect(search).not.toContainEqual({ ean: { startsWith: "" } });

    const byNumber = (fiscalSkuWhere({ search: "7013" }).AND as Array<{ OR?: unknown[] }>).at(
      -1,
    )?.OR;
    expect(byNumber).toContainEqual({ ncm: { startsWith: "7013" } });
  });
});
