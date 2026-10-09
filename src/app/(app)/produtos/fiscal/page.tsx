import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { listFiscalSkus } from "@/server/products/fiscal-bulk";
import { getTenantContext } from "@/server/tenant/tenant-db";

import { FiscalBulkForm } from "./fiscal-bulk-form";

export const metadata: Metadata = { title: "Dados fiscais em massa" };

export default function FiscalBulkPage({ searchParams }: PageProps<"/produtos/fiscal">) {
  return (
    <>
      <PageHeader
        title="Dados fiscais em massa"
        description="Preencha NCM, origem, CFOP e outros dados de vários SKUs de uma vez."
        back={{ href: "/produtos", label: "Produtos" }}
      />
      <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
        <FiscalBulk searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : (value?.[0] ?? "");

async function FiscalBulk({ searchParams }: Pick<PageProps<"/produtos/fiscal">, "searchParams">) {
  const member = await requirePermission("products.edit");
  const { tdb } = await getTenantContext(member);
  const params = await searchParams;
  const search = one(params.busca);
  const incompleteOnly = one(params.todos) !== "1";
  const page = Math.max(1, Number(one(params.pagina)) || 1);
  const result = await listFiscalSkus(tdb, { search, incompleteOnly }, page);

  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (search) query.set("busca", search);
    if (!incompleteOnly) query.set("todos", "1");
    if (target > 1) query.set("pagina", String(target));
    const text = query.toString();
    return text ? `/produtos/fiscal?${text}` : "/produtos/fiscal";
  };

  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-col gap-3 sm:flex-row sm:items-center" role="search">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            type="search"
            name="busca"
            defaultValue={search}
            placeholder="Nome, marca, SKU, EAN ou NCM (ex.: caneca)"
            aria-label="Buscar SKUs"
            className="h-10 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-ink outline-none focus:border-brand focus:ring-3 focus:ring-brand/20"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="todos" value="1" defaultChecked={!incompleteOnly} />
          Mostrar também os completos
        </label>
        <button
          type="submit"
          className="h-10 rounded-lg border border-border bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-2"
        >
          Buscar
        </button>
      </form>

      <p className="text-sm text-muted">
        {result.total} {result.total === 1 ? "SKU" : "SKUs"}
        {incompleteOnly ? " com dados fiscais incompletos" : ""}.
      </p>

      {result.skus.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center">
          <p className="font-display text-lg font-semibold text-ink">
            {incompleteOnly && !search ? "Tudo completo" : "Nenhum SKU encontrado"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {incompleteOnly && !search
              ? "Todos os SKUs têm NCM, origem e CFOP."
              : "Ajuste a busca ou os filtros."}
          </p>
        </div>
      ) : (
        <FiscalBulkForm
          key={`${search}|${incompleteOnly}|${result.page}`}
          rows={result.skus}
          total={result.total}
          filter={{ search, incompleteOnly }}
        />
      )}

      {result.pageCount > 1 ? (
        <nav className="flex items-center justify-between text-sm" aria-label="Paginação">
          {result.page > 1 ? (
            <Link href={pageHref(result.page - 1)} className="text-brand hover:underline">
              ‹ Anterior
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            Página {result.page} de {result.pageCount}
          </span>
          {result.page < result.pageCount ? (
            <Link href={pageHref(result.page + 1)} className="text-brand hover:underline">
              Próxima ›
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
