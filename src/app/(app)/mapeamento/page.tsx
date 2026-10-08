import { Search, Unlink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/domain/auth/permissions";
import { variationLabel } from "@/domain/products/schemas";
import { requirePermission } from "@/server/auth/session";
import { listMappingRows } from "@/server/listings/mapping-service";
import { listingAccounts } from "@/server/listings/queries";
import { getTenantContext } from "@/server/tenant/tenant-db";

import { unlinkAction } from "./actions";
import { AutoMatchButton, LinkSkuForm, SkuCodeList } from "./mapping-controls";

export const metadata: Metadata = { title: "Mapeamento" };

export default function MappingPage({ searchParams }: PageProps<"/mapeamento">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
      <Mapping searchParams={searchParams} />
    </Suspense>
  );
}

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : (value?.[0] ?? "");
const many = (value: string | string[] | undefined) =>
  typeof value === "string" ? [value] : (value ?? []);

type MappingInfo = {
  id: string;
  sku: { id: string; code: string; product: { id: string; name: string } };
};

async function Mapping({ searchParams }: Pick<PageProps<"/mapeamento">, "searchParams">) {
  const member = await requirePermission("listings.view");
  const { tdb } = await getTenantContext(member);
  const params = await searchParams;
  const search = one(params.busca);
  const accountIds = many(params.conta);
  const showMapped = one(params.todos) === "1";
  const page = Math.max(1, Number(one(params.pagina)) || 1);
  const canEdit = can(member.role, "listings.edit");

  const [accounts, result, skus] = await Promise.all([
    listingAccounts(tdb),
    listMappingRows(tdb, { search, accountIds, showMapped, page }),
    tdb.sku.findMany({ select: { code: true }, orderBy: { code: "asc" } }),
  ]);

  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (search) query.set("busca", search);
    accountIds.forEach((id) => query.append("conta", id));
    if (showMapped) query.set("todos", "1");
    if (target > 1) query.set("pagina", String(target));
    const text = query.toString();
    return text ? `/mapeamento?${text}` : "/mapeamento";
  };

  const linkCell = (
    listingId: string,
    variationId: string | null,
    mapping: MappingInfo | undefined,
    suggestion: string | null,
  ) =>
    mapping ? (
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/produtos/${mapping.sku.product.id}`}
          className="rounded-md bg-success-soft px-2 py-1 text-xs font-semibold text-success hover:underline"
          title={mapping.sku.product.name}
        >
          {mapping.sku.code}
        </Link>
        {canEdit ? (
          <form action={unlinkAction.bind(null, mapping.id)}>
            <button
              type="submit"
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-danger"
              title="Desvincular"
            >
              <Unlink className="size-3.5" aria-hidden="true" />
              Desvincular
            </button>
          </form>
        ) : null}
      </div>
    ) : canEdit ? (
      <LinkSkuForm listingId={listingId} variationId={variationId} suggestion={suggestion} />
    ) : (
      <span className="text-xs text-signal-ink">Sem vínculo</span>
    );

  return (
    <>
      <PageHeader
        title="Mapeamento"
        description="Ligue cada anúncio (ou variação) a um SKU do ERP. É por esse vínculo que o estoque do ERP vai para os anúncios."
      />

      {skus.length === 0 ? (
        <p className="mb-5 rounded-lg border-l-4 border-signal bg-signal-soft px-3 py-2 text-sm text-signal-ink">
          Ainda não há SKUs no ERP.{" "}
          <Link href="/produtos/novo" className="font-medium underline">
            Cadastre produtos
          </Link>{" "}
          para poder vinculá-los aos anúncios.
        </p>
      ) : canEdit ? (
        <div className="mb-5 rounded-xl border border-border bg-surface p-4">
          <AutoMatchButton />
        </div>
      ) : null}

      <form
        className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
        role="search"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <input
              type="search"
              name="busca"
              defaultValue={search}
              placeholder="Título, SKU do ML ou ID (MLB…)"
              aria-label="Buscar anúncios"
              className="h-10 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-ink outline-none focus:border-brand focus:ring-3 focus:ring-brand/20"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="todos" value="1" defaultChecked={showMapped} />
            Mostrar também os já vinculados
          </label>
          <button
            type="submit"
            className="h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-on-brand hover:bg-brand-hover"
          >
            Filtrar
          </button>
        </div>
        {accounts.length > 1 ? (
          <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <legend className="sr-only">Contas</legend>
            <span className="text-muted">Contas:</span>
            {accounts.map((account) => (
              <label key={account.id} className="flex items-center gap-1.5 text-ink">
                <input
                  type="checkbox"
                  name="conta"
                  value={account.id}
                  defaultChecked={accountIds.includes(account.id)}
                />
                {account.nickname}
              </label>
            ))}
          </fieldset>
        ) : null}
      </form>

      <p className="mb-3 text-sm text-muted">
        {result.total}{" "}
        {showMapped
          ? result.total === 1
            ? "anúncio"
            : "anúncios"
          : result.total === 1
            ? "anúncio com algo sem vínculo"
            : "anúncios com algo sem vínculo"}
        .
      </p>

      <SkuCodeList codes={skus.map((sku) => sku.code)} />

      {result.listings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center">
          <p className="font-display text-lg font-semibold text-ink">
            {showMapped || search ? "Nada encontrado" : "Tudo vinculado"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {showMapped || search
              ? "Ajuste os filtros."
              : "Todos os anúncios importados estão ligados a um SKU do ERP."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Anúncio / variação</th>
                <th className="px-4 py-3 font-medium">Conta</th>
                <th className="px-4 py-3 font-medium">SKU no ML</th>
                <th className="px-4 py-3 font-medium">SKU do ERP</th>
              </tr>
            </thead>
            <tbody>
              {result.listings.map((listing) => {
                const listingMapping = listing.mappings.find(
                  (mapping) => mapping.variationKey === "",
                );
                const header = (
                  <div className="flex gap-3">
                    {listing.thumbnailUrl ? (
                      // Marketplace CDN thumbnail (see /anuncios).
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={listing.thumbnailUrl}
                        alt=""
                        width={40}
                        height={40}
                        loading="lazy"
                        className="size-10 shrink-0 rounded-md border border-border bg-white object-contain"
                      />
                    ) : (
                      <span className="size-10 shrink-0 rounded-md border border-border bg-surface-2" />
                    )}
                    <div className="min-w-0">
                      <p className="line-clamp-2 font-medium text-ink">{listing.title}</p>
                      <p className="text-xs text-muted tabular-nums">{listing.externalId}</p>
                    </div>
                  </div>
                );

                if (listing.variations.length === 0) {
                  return (
                    <tr key={listing.id} className="border-b border-border align-top last:border-0">
                      <td className="px-4 py-3">{header}</td>
                      <td className="px-4 py-3 text-muted">{listing.account.nickname}</td>
                      <td className="px-4 py-3 text-muted">{listing.sellerSku ?? "—"}</td>
                      <td className="px-4 py-3">
                        {linkCell(listing.id, null, listingMapping, listing.sellerSku)}
                      </td>
                    </tr>
                  );
                }

                return [
                  <tr key={listing.id} className="border-t border-border align-top">
                    <td className="px-4 pt-3 pb-1" colSpan={4}>
                      {header}
                    </td>
                  </tr>,
                  ...listing.variations.map((variation) => {
                    const mapping = listing.mappings.find(
                      (item) => item.variationKey === variation.id,
                    );
                    return (
                      <tr key={variation.id} className="align-top">
                        <td className="py-2 pr-4 pl-17 text-ink">
                          {variationLabel(variation.attributes)}
                        </td>
                        <td className="px-4 py-2 text-muted">{listing.account.nickname}</td>
                        <td className="px-4 py-2 text-muted">{variation.sellerSku ?? "—"}</td>
                        <td className="px-4 py-2">
                          {linkCell(listing.id, variation.id, mapping, variation.sellerSku)}
                        </td>
                      </tr>
                    );
                  }),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}

      {result.pageCount > 1 ? (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Paginação">
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
    </>
  );
}
