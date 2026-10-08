import "server-only";

import type { TenantDb } from "@/server/tenant/tenant-db";

import type { Prisma } from "@/generated/prisma/client";

export const PAGE_SIZE = 25;

/** Products whose name/brand, or one of whose SKU codes/EANs, matches `search`. */
function productSearchWhere(search: string, archived: boolean): Prisma.ProductWhereInput {
  const term = search.trim();
  const base: Prisma.ProductWhereInput = { archivedAt: archived ? { not: null } : null };
  if (!term) return base;
  const conditions: Prisma.ProductWhereInput[] = [
    { name: { contains: term, mode: "insensitive" } },
    { brand: { contains: term, mode: "insensitive" } },
    { skus: { some: { code: { contains: term.toUpperCase() } } } },
  ];
  // Only search EAN when the term has digits: an empty filter would match every SKU.
  const digits = term.replace(/\D/g, "");
  if (digits) conditions.push({ skus: { some: { ean: { startsWith: digits } } } });
  return { ...base, OR: conditions };
}

export async function listProducts(
  tdb: TenantDb,
  {
    search = "",
    page = 1,
    archived = false,
  }: { search?: string; page?: number; archived?: boolean },
) {
  const where = productSearchWhere(search, archived);
  const [total, products] = await Promise.all([
    tdb.product.count({ where }),
    tdb.product.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        brand: true,
        skus: {
          select: { code: true, stockOnHand: true, ncm: true, origin: true, defaultCfop: true },
          orderBy: { code: "asc" },
        },
      },
    }),
  ]);
  return { total, products, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getProductWithSkus(tdb: TenantDb, productId: string) {
  return tdb.product.findFirst({
    where: { id: productId },
    include: { skus: { orderBy: { code: "asc" } } },
  });
}

export async function getSku(tdb: TenantDb, productId: string, skuId: string) {
  return tdb.sku.findFirst({ where: { id: skuId, productId } });
}
