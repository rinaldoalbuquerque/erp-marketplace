import "server-only";

import type { TenantDb } from "@/server/tenant/tenant-db";

import type { Prisma } from "@/generated/prisma/client";

export const ORDERS_PAGE_SIZE = 50;

export type OrderFilter = "todos" | "sem-sku";

/** Orders, newest first, searchable by order number, buyer, listing title or id. */
export async function listOrders(
  tdb: TenantDb,
  {
    search = "",
    filter = "todos",
    page = 1,
  }: { search?: string; filter?: OrderFilter; page?: number },
) {
  const term = search.trim();
  const conditions: Prisma.OrderWhereInput[] = [];
  if (term) {
    conditions.push({
      OR: [
        { externalId: { contains: term } },
        { packId: { contains: term } },
        { buyerNickname: { contains: term, mode: "insensitive" } },
        { items: { some: { title: { contains: term, mode: "insensitive" } } } },
        { items: { some: { externalItemId: { contains: term.toUpperCase() } } } },
      ],
    });
  }
  if (filter === "sem-sku") conditions.push({ items: { some: { stockStatus: "missing_sku" } } });
  const where: Prisma.OrderWhereInput = conditions.length ? { AND: conditions } : {};

  const [total, missingSku, orders] = await Promise.all([
    tdb.order.count({ where }),
    tdb.order.count({ where: { items: { some: { stockStatus: "missing_sku" } } } }),
    tdb.order.findMany({
      where,
      orderBy: { dateCreated: "desc" },
      skip: (page - 1) * ORDERS_PAGE_SIZE,
      take: ORDERS_PAGE_SIZE,
      select: {
        id: true,
        externalId: true,
        packId: true,
        status: true,
        totalCents: true,
        currency: true,
        buyerNickname: true,
        logisticType: true,
        dateCreated: true,
        account: { select: { nickname: true } },
        items: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            title: true,
            externalItemId: true,
            quantity: true,
            stockStatus: true,
            stockNote: true,
            listingId: true,
            sku: { select: { id: true, code: true } },
          },
        },
      },
    }),
  ]);
  return {
    orders,
    total,
    missingSku,
    pageCount: Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE)),
  };
}
