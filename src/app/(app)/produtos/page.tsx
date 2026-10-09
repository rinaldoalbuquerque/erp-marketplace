import { FileText, PackagePlus, Plus, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ButtonLink, PageHeader } from "@/components/ui/page-header";
import { can } from "@/domain/auth/permissions";
import { missingFiscalFields } from "@/domain/products/fiscal";
import { requirePermission } from "@/server/auth/session";
import { listProducts } from "@/server/products/queries";
import { getTenantContext } from "@/server/tenant/tenant-db";

export const metadata: Metadata = { title: "Produtos" };

export default function ProductsPage({ searchParams }: PageProps<"/produtos">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
      <ProductList searchParams={searchParams} />
    </Suspense>
  );
}

function param(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

async function ProductList({ searchParams }: Pick<PageProps<"/produtos">, "searchParams">) {
  const member = await requirePermission("stock.view");
  const { tdb } = await getTenantContext(member);
  const params = await searchParams;
  const search = param(params.busca);
  const archived = param(params.arquivados) === "1";
  const page = Math.max(1, Number(param(params.pagina)) || 1);

  const { products, total, pageCount } = await listProducts(tdb, { search, page, archived });

  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (search) query.set("busca", search);
    if (archived) query.set("arquivados", "1");
    if (target > 1) query.set("pagina", String(target));
    const text = query.toString();
    return text ? `/produtos?${text}` : "/produtos";
  };

  return (
    <>
      <PageHeader
        title="Produtos"
        description={`${total} ${total === 1 ? "produto" : "produtos"}${archived ? " arquivados" : ""}`}
        actions={
          can(member.role, "products.edit") ? (
            <>
              <ButtonLink href="/produtos/fiscal" variant="secondary">
                <FileText className="size-4" aria-hidden="true" />
                Dados fiscais em massa
              </ButtonLink>
              <ButtonLink href="/produtos/criar-dos-anuncios" variant="secondary">
                <PackagePlus className="size-4" aria-hidden="true" />
                Criar a partir dos anúncios
              </ButtonLink>
              <ButtonLink href="/produtos/novo">
                <Plus className="size-4" aria-hidden="true" />
                Novo produto
              </ButtonLink>
            </>
          ) : null
        }
      />

      <form className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center" role="search">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            type="search"
            name="busca"
            defaultValue={search}
            placeholder="Buscar por nome, marca, SKU ou EAN"
            aria-label="Buscar produtos"
            className="h-10 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-ink outline-none focus:border-brand focus:ring-3 focus:ring-brand/20"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" name="arquivados" value="1" defaultChecked={archived} />
          Ver arquivados
        </label>
        <button
          type="submit"
          className="h-10 rounded-lg border border-border bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-2"
        >
          Buscar
        </button>
      </form>

      {products.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center">
          <p className="font-display text-lg font-semibold text-ink">
            {search ? "Nenhum produto encontrado" : "Nenhum produto cadastrado"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {search
              ? "Tente buscar por outro nome, SKU ou EAN."
              : "Cadastre seu primeiro produto para controlar o estoque por SKU."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Produto</th>
                <th className="px-4 py-3 font-medium">SKUs</th>
                <th className="px-4 py-3 text-right font-medium">Estoque</th>
                <th className="px-4 py-3 font-medium">Fiscal</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => {
                const stock = product.skus.reduce((sum, sku) => sum + sku.stockOnHand, 0);
                const incomplete = product.skus.filter(
                  (sku) => missingFiscalFields(sku).length > 0,
                ).length;
                return (
                  <tr key={product.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/produtos/${product.id}`}
                        className="font-medium text-ink hover:text-brand"
                      >
                        {product.name}
                      </Link>
                      {product.brand ? (
                        <span className="block text-xs text-muted">{product.brand}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {product.skus.length === 1
                        ? product.skus[0]?.code
                        : `${product.skus.length} variações`}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-medium tabular-nums ${
                        stock < 0 ? "text-signal-ink" : "text-ink"
                      }`}
                    >
                      {stock}
                    </td>
                    <td className="px-4 py-3">
                      {incomplete > 0 ? (
                        <span className="rounded-full bg-signal-soft px-2 py-0.5 text-xs font-medium text-signal-ink">
                          Incompleto
                        </span>
                      ) : (
                        <span className="text-xs text-success">Completo</span>
                      )}
                    </td>
                  </tr>
                );
              })}
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
