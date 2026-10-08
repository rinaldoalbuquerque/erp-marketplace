import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { variationLabel } from "@/domain/products/schemas";
import { requirePermission } from "@/server/auth/session";
import { listStock } from "@/server/stock/queries";
import { getTenantContext } from "@/server/tenant/tenant-db";

export const metadata: Metadata = { title: "Estoque" };

export default function StockPage({ searchParams }: PageProps<"/estoque">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
      <StockList searchParams={searchParams} />
    </Suspense>
  );
}

function param(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

async function StockList({ searchParams }: Pick<PageProps<"/estoque">, "searchParams">) {
  const member = await requirePermission("stock.view");
  const { tdb } = await getTenantContext(member);
  const params = await searchParams;
  const search = param(params.busca);
  const page = Math.max(1, Number(param(params.pagina)) || 1);
  const { skus, total, pageCount } = await listStock(tdb, { search, page });

  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (search) query.set("busca", search);
    if (target > 1) query.set("pagina", String(target));
    const text = query.toString();
    return text ? `/estoque?${text}` : "/estoque";
  };

  return (
    <>
      <PageHeader
        title="Estoque"
        description={`${total} ${total === 1 ? "SKU" : "SKUs"} de produtos ativos. Clique num SKU para ver o histórico e ajustar.`}
      />

      <form className="mb-4 flex gap-3" role="search">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            type="search"
            name="busca"
            defaultValue={search}
            placeholder="Buscar por SKU, EAN, produto ou localização"
            aria-label="Buscar no estoque"
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

      {skus.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center">
          <p className="font-display text-lg font-semibold text-ink">
            {search ? "Nenhum SKU encontrado" : "Nenhum SKU cadastrado"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {search ? (
              "Tente buscar por outro código, EAN, produto ou localização."
            ) : (
              <>
                O estoque é controlado por SKU.{" "}
                <Link href="/produtos/novo" className="text-brand hover:underline">
                  Cadastre um produto
                </Link>{" "}
                para começar.
              </>
            )}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">SKU</th>
                <th className="px-4 py-3 font-medium">Produto</th>
                <th className="px-4 py-3 font-medium">Local</th>
                <th className="px-4 py-3 text-right font-medium">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {skus.map((sku) => (
                <tr key={sku.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/estoque/${sku.id}`}
                      className="font-medium text-ink hover:text-brand"
                    >
                      {sku.code}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-ink">{sku.product.name}</span>
                    <span className="block text-xs text-muted">
                      {variationLabel(sku.variation)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted">{sku.location ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {sku.stockOnHand <= 0 ? (
                      <span className="rounded-full bg-signal-soft px-2 py-0.5 font-semibold text-signal-ink">
                        {sku.stockOnHand} {sku.unit}
                      </span>
                    ) : (
                      <span className="font-semibold text-ink">
                        {sku.stockOnHand} {sku.unit}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 ? (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Paginação">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="text-brand hover:underline">
              ‹ Anterior
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            Página {page} de {pageCount}
          </span>
          {page < pageCount ? (
            <Link href={pageHref(page + 1)} className="text-brand hover:underline">
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
