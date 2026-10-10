import { Archive, ArchiveRestore, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { ButtonLink, PageHeader } from "@/components/ui/page-header";
import { can } from "@/domain/auth/permissions";
import { missingFiscalFields } from "@/domain/products/fiscal";
import { variationLabel } from "@/domain/products/schemas";
import { requirePermission } from "@/server/auth/session";
import { getProductWithSkus } from "@/server/products/queries";
import { getTenantContext } from "@/server/tenant/tenant-db";

import { setProductArchivedAction, updateProductAction } from "../actions";
import { DeleteProductButton } from "../product-delete";
import { EditProductForm } from "../product-forms";

export const metadata: Metadata = { title: "Produto" };

export default function ProductPage({ params, searchParams }: PageProps<"/produtos/[id]">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
      <ProductDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ProductDetail({
  params,
  searchParams,
}: Pick<PageProps<"/produtos/[id]">, "params" | "searchParams">) {
  const member = await requirePermission("stock.view");
  const { tdb } = await getTenantContext(member);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const product = await getProductWithSkus(tdb, id);
  if (!product) notFound();

  const query = await searchParams;
  const notice =
    query.criado === "1" ? "Produto criado." : query["sku-salvo"] === "1" ? "SKU salvo." : null;
  const canEdit = can(member.role, "products.edit");
  const canArchive = can(member.role, "products.archive");
  const archived = product.archivedAt !== null;

  return (
    <>
      <PageHeader
        title={product.name}
        description={
          archived ? "Produto arquivado: não aparece na lista principal." : product.brand
        }
        back={{ href: "/produtos", label: "Produtos" }}
        actions={
          canArchive ? (
            <div className="flex flex-wrap gap-2">
              <DeleteProductButton productId={product.id} name={product.name} label="Excluir" />
              <form action={setProductArchivedAction.bind(null, product.id, !archived)}>
                <button
                  type="submit"
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-2"
                >
                  {archived ? (
                    <ArchiveRestore className="size-4" aria-hidden="true" />
                  ) : (
                    <Archive className="size-4" aria-hidden="true" />
                  )}
                  {archived ? "Reativar" : "Arquivar"}
                </button>
              </form>
            </div>
          ) : null
        }
      />

      {notice ? (
        <p
          role="status"
          className="mb-5 rounded-lg border-l-4 border-success bg-success-soft px-3 py-2 text-sm text-success"
        >
          {notice}
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section>
          {canEdit ? (
            <EditProductForm
              action={updateProductAction.bind(null, product.id)}
              defaults={{
                name: product.name,
                brand: product.brand ?? "",
                description: product.description ?? "",
              }}
            />
          ) : (
            <div className="rounded-xl border border-border bg-surface p-5 text-sm text-ink">
              <p className="whitespace-pre-line">{product.description || "Sem descrição."}</p>
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-ink">Variações (SKUs)</h2>
            {canEdit ? (
              <ButtonLink href={`/produtos/${product.id}/skus/novo`} variant="secondary">
                <Plus className="size-4" aria-hidden="true" />
                Adicionar variação
              </ButtonLink>
            ) : null}
          </div>
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">SKU</th>
                  <th className="px-4 py-3 font-medium">Variação</th>
                  <th className="px-4 py-3 text-right font-medium">Estoque</th>
                  <th className="px-4 py-3 font-medium">Local</th>
                  <th className="px-4 py-3 font-medium">Fiscal</th>
                </tr>
              </thead>
              <tbody>
                {product.skus.map((sku) => {
                  const missing = missingFiscalFields(sku);
                  return (
                    <tr key={sku.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        {canEdit ? (
                          <Link
                            href={`/produtos/${product.id}/skus/${sku.id}`}
                            className="font-medium text-ink hover:text-brand"
                          >
                            {sku.code}
                          </Link>
                        ) : (
                          <span className="font-medium text-ink">{sku.code}</span>
                        )}
                        {sku.ean ? (
                          <span className="block text-xs text-muted tabular-nums">{sku.ean}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-muted">{variationLabel(sku.variation)}</td>
                      <td
                        className={`px-4 py-3 text-right font-medium tabular-nums ${
                          sku.stockOnHand < 0 ? "text-signal-ink" : "text-ink"
                        }`}
                      >
                        {sku.stockOnHand} {sku.unit}
                      </td>
                      <td className="px-4 py-3 text-muted">{sku.location ?? "—"}</td>
                      <td className="px-4 py-3">
                        {missing.length ? (
                          <span
                            className="rounded-full bg-signal-soft px-2 py-0.5 text-xs font-medium text-signal-ink"
                            title={`Falta: ${missing.join(", ")}`}
                          >
                            Falta {missing.join(", ")}
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
        </section>
      </div>
    </>
  );
}
