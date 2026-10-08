import "server-only";

import type { TenantDb } from "@/server/tenant/tenant-db";

import type { Prisma } from "@/generated/prisma/client";

export const STOCK_PAGE_SIZE = 50;
export const HISTORY_SIZE = 100;

/** SKUs of active products, searchable by SKU code, EAN, product name or location. */
export async function listStock(
  tdb: TenantDb,
  { search = "", page = 1 }: { search?: string; page?: number },
) {
  const term = search.trim();
  const where: Prisma.SkuWhereInput = { product: { archivedAt: null } };
  if (term) {
    const conditions: Prisma.SkuWhereInput[] = [
      { code: { contains: term.toUpperCase() } },
      { product: { name: { contains: term, mode: "insensitive" } } },
      { location: { contains: term, mode: "insensitive" } },
    ];
    const digits = term.replace(/\D/g, "");
    if (digits) conditions.push({ ean: { startsWith: digits } });
    where.OR = conditions;
  }

  const [total, skus] = await Promise.all([
    tdb.sku.count({ where }),
    tdb.sku.findMany({
      where,
      orderBy: { code: "asc" },
      skip: (page - 1) * STOCK_PAGE_SIZE,
      take: STOCK_PAGE_SIZE,
      select: {
        id: true,
        code: true,
        variation: true,
        location: true,
        unit: true,
        stockOnHand: true,
        product: { select: { id: true, name: true } },
      },
    }),
  ]);
  return { total, skus, pageCount: Math.max(1, Math.ceil(total / STOCK_PAGE_SIZE)) };
}

/** SKU with its product and the latest movements (newest first). */
export async function getSkuStock(tdb: TenantDb, skuId: string) {
  const sku = await tdb.sku.findFirst({
    where: { id: skuId },
    select: {
      id: true,
      code: true,
      ean: true,
      variation: true,
      location: true,
      unit: true,
      stockOnHand: true,
      product: { select: { id: true, name: true, archivedAt: true } },
    },
  });
  if (!sku) return null;
  const movements = await tdb.stockMovement.findMany({
    where: { skuId },
    orderBy: { createdAt: "desc" },
    take: HISTORY_SIZE,
    select: {
      id: true,
      type: true,
      quantity: true,
      balanceAfter: true,
      reason: true,
      createdAt: true,
      createdBy: { select: { fullName: true } },
    },
  });
  return { sku, movements };
}
