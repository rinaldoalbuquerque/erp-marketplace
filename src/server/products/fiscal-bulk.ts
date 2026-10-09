import "server-only";

import type { FiscalPatch } from "@/domain/products/bulk-fiscal";
import type { TenantDb } from "@/server/tenant/tenant-db";

import type { Prisma } from "@/generated/prisma/client";

export const FISCAL_PAGE_SIZE = 100;

export type FiscalFilter = { search?: string; incompleteOnly?: boolean };

/** SKUs of active products matching the bulk fiscal screen filter. */
export function fiscalSkuWhere(filter: FiscalFilter): Prisma.SkuWhereInput {
  const conditions: Prisma.SkuWhereInput[] = [{ product: { archivedAt: null } }];
  if (filter.incompleteOnly) {
    conditions.push({ OR: [{ ncm: null }, { origin: null }, { defaultCfop: null }] });
  }
  const term = filter.search?.trim();
  if (term) {
    const search: Prisma.SkuWhereInput[] = [
      { product: { name: { contains: term, mode: "insensitive" } } },
      { product: { brand: { contains: term, mode: "insensitive" } } },
      { code: { contains: term.toUpperCase() } },
    ];
    const digits = term.replace(/\D/g, "");
    if (digits) search.push({ ean: { startsWith: digits } }, { ncm: { startsWith: digits } });
    conditions.push({ OR: search });
  }
  return { AND: conditions };
}

export async function listFiscalSkus(tdb: TenantDb, filter: FiscalFilter, page: number) {
  const where = fiscalSkuWhere(filter);
  const current = Math.max(1, page);
  const [total, skus] = await Promise.all([
    tdb.sku.count({ where }),
    tdb.sku.findMany({
      where,
      orderBy: [{ product: { name: "asc" } }, { code: "asc" }],
      skip: (current - 1) * FISCAL_PAGE_SIZE,
      take: FISCAL_PAGE_SIZE,
      select: {
        id: true,
        code: true,
        variation: true,
        ncm: true,
        cest: true,
        origin: true,
        unit: true,
        defaultCfop: true,
        product: { select: { id: true, name: true } },
      },
    }),
  ]);
  return {
    total,
    skus,
    page: current,
    pageCount: Math.max(1, Math.ceil(total / FISCAL_PAGE_SIZE)),
  };
}

export type FiscalTarget =
  | { mode: "selected"; skuIds: string[] }
  /** Every SKU matching the filter: the server runs the search again. */
  | { mode: "filter"; filter: FiscalFilter };

/** Applies the filled fiscal fields to the target SKUs. Only fiscal columns change. */
export async function applyFiscalPatch(
  tdb: TenantDb,
  patch: FiscalPatch,
  target: FiscalTarget,
): Promise<number> {
  const where =
    target.mode === "selected"
      ? { AND: [fiscalSkuWhere({}), { id: { in: target.skuIds } }] }
      : fiscalSkuWhere(target.filter);
  if (target.mode === "selected" && target.skuIds.length === 0) return 0;
  const data: Prisma.SkuUpdateManyMutationInput = {};
  if (patch.ncm !== undefined) data.ncm = patch.ncm;
  if (patch.cest !== undefined) data.cest = patch.cest;
  if (patch.origin !== undefined) data.origin = patch.origin;
  if (patch.unit !== undefined) data.unit = patch.unit;
  if (patch.defaultCfop !== undefined) data.defaultCfop = patch.defaultCfop;
  const result = await tdb.sku.updateMany({ where, data });
  return result.count;
}
