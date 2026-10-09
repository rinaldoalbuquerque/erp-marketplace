import { RefreshCw, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";

import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/domain/auth/permissions";
import { ITEM_STOCK_LABELS, orderStatusLabel } from "@/domain/orders/labels";
import { canPrintLabel, type OrderStage } from "@/domain/orders/stage";
import type { ItemStockStatus } from "@/domain/orders/stock-rules";
import { requirePermission } from "@/server/auth/session";
import { listOrders, ORDER_TABS, parseOrderTab, type OrderTab } from "@/server/orders/queries";
import { catchUpInBackground } from "@/server/orders/schedule";
import { getTenantContext } from "@/server/tenant/tenant-db";

import { fetchOrdersNowAction } from "./actions";
import { LABELS_FORM_ID, PrintLabelsBar } from "./print-labels-bar";

export const metadata: Metadata = { title: "Pedidos" };

// Visiting the page searches recent sales in the background (`after`), which
// gets the page's max duration.
export const maxDuration = 120;

const DATE_TIME = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});
const MONEY = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const STAGE_LABELS: Record<OrderStage, string> = {
  pending: "Em preparo",
  invoice_pending: "Aguardando NF",
  ready_to_print: "Pronto para imprimir",
  printed: "Etiqueta impressa",
  shipped: "Enviado",
  delivered: "Entregue",
  cancelled: "Cancelado",
  fulfillment: "Full (o ML envia)",
  other: "Sem envio do ML",
};

/** Tabs shown in this order; the rest stay reachable but secondary. */
const TAB_ORDER: OrderTab[] = [
  "para-imprimir",
  "aguardando-nf",
  "impressos",
  "em-preparo",
  "enviados",
  "entregues",
  "full",
  "cancelados",
  "outros",
  "sem-sku",
  "todos",
];

export default function OrdersPage({ searchParams }: PageProps<"/pedidos">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
      <Orders searchParams={searchParams} />
    </Suspense>
  );
}

function param(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

async function Orders({ searchParams }: Pick<PageProps<"/pedidos">, "searchParams">) {
  const member = await requirePermission("orders.view");
  const { tdb } = await getTenantContext(member);
  const params = await searchParams;
  const search = param(params.busca);
  const tab = parseOrderTab(param(params.aba));
  const accountParam = param(params.conta);
  const accountId = z.uuid().safeParse(accountParam).success ? accountParam : null;
  const page = Math.max(1, Number(param(params.pagina)) || 1);
  const [{ orders, total, tabCounts, accounts, pageCount, now }] = await Promise.all([
    listOrders(tdb, { search, tab, accountId, page }),
    catchUpInBackground(member.organizationId),
  ]);
  const canPrint = can(member.role, "orders.fulfill");

  const href = (changes: { aba?: OrderTab; pagina?: number; conta?: string | null }) => {
    const query = new URLSearchParams();
    if (search) query.set("busca", search);
    const nextTab = changes.aba ?? tab;
    if (nextTab !== "para-imprimir") query.set("aba", nextTab);
    const nextAccount = changes.conta === undefined ? accountId : changes.conta;
    if (nextAccount) query.set("conta", nextAccount);
    const nextPage = changes.pagina ?? 1;
    if (nextPage > 1) query.set("pagina", String(nextPage));
    const text = query.toString();
    return text ? `/pedidos?${text}` : "/pedidos";
  };
  const current = href({ pagina: page });
  const printable = (order: (typeof orders)[number]) => canPrint && canPrintLabel(order);
  const showPrintBar = canPrint && orders.some((order) => canPrintLabel(order));

  return (
    <>
      <PageHeader
        title="Pedidos"
        description="Vendas do Mercado Livre por etapa do envio. Chegam sozinhas por aviso do ML e são conferidas ao abrir esta tela."
        actions={
          <form action={fetchOrdersNowAction}>
            <button
              type="submit"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-2"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Buscar vendas agora
            </button>
          </form>
        }
      />

      {param(params.buscando) ? (
        <p
          role="status"
          className="mb-5 rounded-lg border-l-4 border-success bg-success-soft px-3 py-2 text-sm text-success"
        >
          Buscando vendas em segundo plano. Atualize a página em alguns segundos.
        </p>
      ) : null}
      {param(params["etiqueta-erro"]) ? (
        <p
          role="alert"
          className="mb-5 rounded-lg border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {param(params["etiqueta-erro"])}
        </p>
      ) : null}
      {tabCounts["sem-sku"] > 0 && tab !== "sem-sku" ? (
        <p className="mb-5 rounded-lg border-l-4 border-signal bg-signal-soft px-3 py-2 text-sm text-signal-ink">
          {tabCounts["sem-sku"] === 1 ? "1 pedido tem" : `${tabCounts["sem-sku"]} pedidos têm`}{" "}
          anúncio sem SKU vinculado: o estoque não foi baixado.{" "}
          <Link href={href({ aba: "sem-sku" })} className="font-medium underline">
            Ver
          </Link>
        </p>
      ) : null}

      <nav
        className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1 text-sm"
        aria-label="Etapas"
      >
        {TAB_ORDER.map((key) => (
          <Link
            key={key}
            href={href({ aba: key })}
            aria-current={tab === key ? "page" : undefined}
            className={`shrink-0 rounded-md px-3 py-1.5 whitespace-nowrap ${
              tab === key ? "bg-brand text-on-brand" : "text-muted hover:text-ink"
            }`}
          >
            {ORDER_TABS[key].label}
            <span className="ml-1.5 tabular-nums opacity-80">{tabCounts[key]}</span>
          </Link>
        ))}
      </nav>

      <form className="mb-4 flex flex-col gap-3 sm:flex-row" role="search">
        {tab !== "para-imprimir" ? <input type="hidden" name="aba" value={tab} /> : null}
        {accounts.length > 1 ? (
          <select
            name="conta"
            defaultValue={accountId ?? ""}
            aria-label="Conta"
            className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-ink"
          >
            <option value="">Todas as contas</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.nickname}
              </option>
            ))}
          </select>
        ) : null}
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            type="search"
            name="busca"
            defaultValue={search}
            placeholder="Buscar por nº do pedido, comprador, anúncio ou rastreio"
            aria-label="Buscar pedidos"
            className="h-10 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-ink outline-none focus:border-brand focus:ring-3 focus:ring-brand/20"
          />
        </div>
        <button
          type="submit"
          className="h-10 rounded-lg border border-border bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-2"
        >
          Filtrar
        </button>
      </form>

      {showPrintBar ? <PrintLabelsBar back={current} /> : null}

      {orders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center">
          <p className="font-display text-lg font-semibold text-ink">Nenhum pedido nesta etapa</p>
          <p className="mt-1 text-sm text-muted">
            As vendas aparecem assim que o Mercado Livre avisar. Veja as outras abas ou{" "}
            <Link href={href({ aba: "todos" })} className="text-brand hover:underline">
              todos os pedidos
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted">
              <tr>
                {showPrintBar ? (
                  <th className="w-10 px-4 py-3">
                    <span className="sr-only">Marcar</span>
                  </th>
                ) : null}
                <th className="px-4 py-3 font-medium">Pedido</th>
                <th className="px-4 py-3 font-medium">Itens</th>
                <th className="px-4 py-3 font-medium">Envio</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const late = order.dispatchBy !== null && order.dispatchBy.getTime() < now;
                const soon =
                  order.dispatchBy !== null &&
                  !late &&
                  order.dispatchBy.getTime() - now < 24 * 60 * 60 * 1000;
                return (
                  <tr key={order.id} className="border-b border-border align-top last:border-0">
                    {showPrintBar ? (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          name="orderIds"
                          value={order.id}
                          form={LABELS_FORM_ID}
                          disabled={!printable(order)}
                          aria-label={`Marcar pedido ${order.externalId}`}
                          className="size-4 accent-brand disabled:opacity-30"
                        />
                      </td>
                    ) : null}
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink tabular-nums">#{order.externalId}</p>
                      <p className="text-xs text-muted">
                        {DATE_TIME.format(order.dateCreated)} · {order.account.nickname}
                      </p>
                      <p className="text-xs text-muted">
                        {order.buyerNickname ?? ""}
                        {order.packId ? ` · carrinho ${order.packId}` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <ul className="flex flex-col gap-2">
                        {order.items.map((item) => (
                          <li key={item.id}>
                            <p className="max-w-md truncate text-ink">
                              {item.quantity}× {item.title}
                            </p>
                            <p className="text-xs text-muted">
                              {item.externalItemId}
                              {item.sku ? (
                                <>
                                  {" · "}
                                  <Link
                                    href={`/estoque/${item.sku.id}`}
                                    className="hover:text-brand"
                                  >
                                    {item.sku.code}
                                  </Link>
                                </>
                              ) : null}
                            </p>
                            <StockBadge status={item.stockStatus} note={item.stockNote} />
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-ink">{STAGE_LABELS[order.stage]}</p>
                      {order.status !== "paid" ? (
                        <p className="text-xs text-muted">{orderStatusLabel(order.status)}</p>
                      ) : null}
                      {order.dispatchBy ? (
                        <p
                          className={`text-xs ${
                            late || soon ? "font-medium text-signal-ink" : "text-muted"
                          }`}
                        >
                          {late ? "Atrasado: despachar até " : "Despachar até "}
                          {DATE_TIME.format(order.dispatchBy)}
                        </p>
                      ) : null}
                      {order.labelAvailableAt && order.labelAvailableAt.getTime() > now ? (
                        <p className="text-xs text-muted">
                          Etiqueta libera em {DATE_TIME.format(order.labelAvailableAt)}
                        </p>
                      ) : null}
                      {order.trackingNumber ? (
                        <p className="text-xs text-muted tabular-nums">
                          Rastreio {order.trackingNumber}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right text-ink tabular-nums">
                      {order.totalCents !== null ? MONEY.format(order.totalCents / 100) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2 text-xs text-muted">
        {total} {total === 1 ? "pedido" : "pedidos"} nesta aba
      </p>

      {pageCount > 1 ? (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Paginação">
          {page > 1 ? (
            <Link href={href({ pagina: page - 1 })} className="text-brand hover:underline">
              ‹ Anterior
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            Página {page} de {pageCount}
          </span>
          {page < pageCount ? (
            <Link href={href({ pagina: page + 1 })} className="text-brand hover:underline">
              Próxima ›
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </>
  );
}

function StockBadge({ status, note }: { status: ItemStockStatus; note: string | null }) {
  const styles: Record<ItemStockStatus, string> = {
    waiting: "bg-surface-2 text-muted",
    deducted: "bg-success-soft text-success",
    restored: "bg-surface-2 text-ink",
    not_applicable: "bg-surface-2 text-muted",
    missing_sku: "bg-signal-soft text-signal-ink",
  };
  return (
    <p className="mt-1 text-xs">
      <span className={`inline-block rounded-full px-2 py-0.5 font-medium ${styles[status]}`}>
        {ITEM_STOCK_LABELS[status]}
      </span>
      {status === "not_applicable" && note ? <span className="ml-2 text-muted">{note}</span> : null}
    </p>
  );
}
