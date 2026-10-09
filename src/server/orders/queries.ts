import "server-only";

import type { OrderStage } from "@/domain/orders/stage";
import type { TenantDb } from "@/server/tenant/tenant-db";

import type { Prisma } from "@/generated/prisma/client";

export const ORDERS_PAGE_SIZE = 50;

/** Tabs of the Orders screen (URL value -> stages). "sem-sku" is a stock filter. */
export const ORDER_TABS = {
  "aguardando-nf": { label: "Aguardando NF", stages: ["invoice_pending"] },
  "para-imprimir": { label: "Para imprimir", stages: ["ready_to_print"] },
  impressos: { label: "Impressos", stages: ["printed"] },
  "em-preparo": { label: "Em preparo", stages: ["pending"] },
  enviados: { label: "Enviados", stages: ["shipped"] },
  entregues: { label: "Entregues", stages: ["delivered"] },
  full: { label: "Full", stages: ["fulfillment"] },
  cancelados: { label: "Cancelados", stages: ["cancelled"] },
  outros: { label: "Outros", stages: ["other"] },
  todos: { label: "Todos", stages: null },
  "sem-sku": { label: "Sem SKU", stages: null },
} as const satisfies Record<string, { label: string; stages: readonly OrderStage[] | null }>;

export type OrderTab = keyof typeof ORDER_TABS;

export function parseOrderTab(value: string): OrderTab {
  return value in ORDER_TABS ? (value as OrderTab) : "para-imprimir";
}

export type OrderListInput = {
  search?: string;
  tab?: OrderTab;
  accountId?: string | null;
  page?: number;
};

/** Orders of a tab, newest first, plus counts per tab (same search and account). */
export async function listOrders(
  tdb: TenantDb,
  { search = "", tab = "para-imprimir", accountId = null, page = 1 }: OrderListInput,
) {
  const base: Prisma.OrderWhereInput[] = [];
  const term = search.trim();
  if (term) {
    base.push({
      OR: [
        { externalId: { contains: term } },
        { packId: { contains: term } },
        { buyerNickname: { contains: term, mode: "insensitive" } },
        { trackingNumber: { contains: term } },
        { items: { some: { title: { contains: term, mode: "insensitive" } } } },
        { items: { some: { externalItemId: { contains: term.toUpperCase() } } } },
      ],
    });
  }
  if (accountId) base.push({ marketplaceAccountId: accountId });

  const tabFilter: Prisma.OrderWhereInput =
    tab === "sem-sku"
      ? { items: { some: { stockStatus: "missing_sku" } } }
      : ORDER_TABS[tab].stages
        ? { stage: { in: [...ORDER_TABS[tab].stages] } }
        : {};
  const where: Prisma.OrderWhereInput = { AND: [...base, tabFilter] };
  const baseWhere: Prisma.OrderWhereInput = { AND: base };

  // Ready to print: most urgent dispatch first. Other tabs: newest first.
  const orderBy: Prisma.OrderOrderByWithRelationInput[] =
    tab === "para-imprimir" || tab === "aguardando-nf" || tab === "impressos"
      ? [{ dispatchBy: { sort: "asc", nulls: "last" } }, { dateCreated: "asc" }]
      : [{ dateCreated: "desc" }];

  const [total, byStage, missingSku, orders, accounts] = await Promise.all([
    tdb.order.count({ where }),
    tdb.order.groupBy({ by: ["stage"], where: baseWhere, _count: { _all: true } }),
    tdb.order.count({
      where: { AND: [...base, { items: { some: { stockStatus: "missing_sku" } } }] },
    }),
    tdb.order.findMany({
      where,
      orderBy,
      skip: (page - 1) * ORDERS_PAGE_SIZE,
      take: ORDERS_PAGE_SIZE,
      select: {
        id: true,
        externalId: true,
        packId: true,
        status: true,
        stage: true,
        totalCents: true,
        buyerNickname: true,
        logisticType: true,
        shippingId: true,
        shipmentMode: true,
        shipmentSubstatus: true,
        trackingNumber: true,
        labelAvailableAt: true,
        dispatchBy: true,
        slaStatus: true,
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
            sku: { select: { id: true, code: true } },
          },
        },
      },
    }),
    tdb.marketplaceAccount.findMany({
      orderBy: { nickname: "asc" },
      select: { id: true, nickname: true },
    }),
  ]);

  const stageCounts = new Map(byStage.map((row) => [row.stage, row._count._all]));
  const tabCounts = Object.fromEntries(
    (Object.keys(ORDER_TABS) as OrderTab[]).map((key) => {
      const stages = ORDER_TABS[key].stages;
      const count =
        key === "sem-sku"
          ? missingSku
          : stages
            ? stages.reduce((sum, stage) => sum + (stageCounts.get(stage) ?? 0), 0)
            : [...stageCounts.values()].reduce((sum, value) => sum + value, 0);
      return [key, count];
    }),
  ) as Record<OrderTab, number>;

  return {
    orders,
    total,
    tabCounts,
    accounts,
    /** Reference time for deadlines on the screen. */
    now: Date.now(),
    pageCount: Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE)),
  };
}
