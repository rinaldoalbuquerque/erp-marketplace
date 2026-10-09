import { RefreshCw, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { ITEM_STOCK_LABELS, orderStatusLabel } from "@/domain/orders/labels";
import type { ItemStockStatus } from "@/domain/orders/stock-rules";
import { requirePermission } from "@/server/auth/session";
import { listOrders, type OrderFilter } from "@/server/orders/queries";
import { catchUpInBackground } from "@/server/orders/schedule";
import { getTenantContext } from "@/server/tenant/tenant-db";

import { fetchOrdersNowAction } from "./actions";

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
  const filter: OrderFilter = param(params.filtro) === "sem-sku" ? "sem-sku" : "todos";
  const page = Math.max(1, Number(param(params.pagina)) || 1);
  const [{ orders, total, missingSku, pageCount }] = await Promise.all([
    listOrders(tdb, { search, filter, page }),
    catchUpInBackground(member.organizationId),
  ]);

  const href = (changes: { filtro?: OrderFilter; pagina?: number }) => {
    const query = new URLSearchParams();
    if (search) query.set("busca", search);
    const nextFilter = changes.filtro ?? filter;
    if (nextFilter !== "todos") query.set("filtro", nextFilter);
    const nextPage = changes.pagina ?? 1;
    if (nextPage > 1) query.set("pagina", String(nextPage));
    const text = query.toString();
    return text ? `/pedidos?${text}` : "/pedidos";
  };

  return (
    <>
      <PageHeader
        title="Pedidos"
        description="Vendas recebidas do Mercado Livre. Chegam sozinhas por aviso do ML; a lista também é conferida ao abrir esta tela."
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

      {missingSku > 0 ? (
        <p className="mb-5 rounded-lg border-l-4 border-signal bg-signal-soft px-3 py-2 text-sm text-signal-ink">
          {missingSku === 1 ? "1 pedido tem" : `${missingSku} pedidos têm`} anúncio sem SKU
          vinculado: o estoque não foi baixado.{" "}
          <Link href={href({ filtro: "sem-sku" })} className="font-medium underline">
            Ver
          </Link>{" "}
          e vincule em{" "}
          <Link href="/mapeamento" className="font-medium underline">
            Mapeamento
          </Link>
          .
        </p>
      ) : null}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <nav
          className="flex gap-1 rounded-lg border border-border bg-surface p-1 text-sm"
          aria-label="Filtro"
        >
          {(
            [
              ["todos", "Todos"],
              ["sem-sku", "Sem SKU"],
            ] as const
          ).map(([value, label]) => (
            <Link
              key={value}
              href={href({ filtro: value })}
              aria-current={filter === value ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 ${
                filter === value ? "bg-brand text-on-brand" : "text-muted hover:text-ink"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <form className="flex flex-1 gap-3" role="search">
          {filter !== "todos" ? <input type="hidden" name="filtro" value={filter} /> : null}
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <input
              type="search"
              name="busca"
              defaultValue={search}
              placeholder="Buscar por nº do pedido, comprador, anúncio"
              aria-label="Buscar pedidos"
              className="h-10 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-ink outline-none focus:border-brand focus:ring-3 focus:ring-brand/20"
            />
          </div>
          <button
            type="submit"
            className="h-10 rounded-lg border border-border bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-2"
          >
            Buscar
          </button>
        </form>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center">
          <p className="font-display text-lg font-semibold text-ink">
            {search || filter !== "todos" ? "Nenhum pedido encontrado" : "Nenhum pedido ainda"}
          </p>
          <p className="mt-1 text-sm text-muted">
            As vendas aparecem aqui assim que o Mercado Livre avisar. Na primeira vez, o ERP busca
            as vendas dos últimos 2 dias.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Data</th>
                <th className="px-4 py-3 font-medium">Pedido</th>
                <th className="px-4 py-3 font-medium">Itens</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b border-border align-top last:border-0">
                  <td className="px-4 py-3 whitespace-nowrap text-muted tabular-nums">
                    {DATE_TIME.format(order.dateCreated)}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink tabular-nums">#{order.externalId}</p>
                    <p className="text-xs text-muted">
                      {order.account.nickname}
                      {order.buyerNickname ? ` · ${order.buyerNickname}` : ""}
                      {order.logisticType === "fulfillment" ? " · Full" : ""}
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
                                <Link href={`/estoque/${item.sku.id}`} className="hover:text-brand">
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
                  <td className="px-4 py-3 text-right text-ink tabular-nums">
                    {order.totalCents !== null ? MONEY.format(order.totalCents / 100) : "—"}
                  </td>
                  <td className="px-4 py-3 text-ink">{orderStatusLabel(order.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2 text-xs text-muted">
        {total} {total === 1 ? "pedido" : "pedidos"}
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
