import { ExternalLink, Pencil, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ButtonLink, PageHeader } from "@/components/ui/page-header";
import { can } from "@/domain/auth/permissions";
import { LISTING_MODEL_SHORT, listingStatusLabel, type StatusTone } from "@/domain/listings/labels";
import { formatCents } from "@/domain/products/money";
import { requirePermission } from "@/server/auth/session";
import {
  LISTING_STATUS_FILTERS,
  listingAccounts,
  listListings,
  type ListingStatusFilter,
} from "@/server/listings/queries";
import { getTenantContext } from "@/server/tenant/tenant-db";

export const metadata: Metadata = { title: "Anúncios" };

const DATE_TIME = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

const STATUS_OPTIONS: Array<{ value: ListingStatusFilter; label: string }> = [
  { value: "ativo", label: "Ativos" },
  { value: "pausado", label: "Pausados" },
  { value: "finalizado", label: "Finalizados" },
  { value: "em-revisao", label: "Em revisão" },
  { value: "sem-estoque", label: "Sem estoque" },
];

const TONE_CLASSES: Record<StatusTone, string> = {
  success: "bg-success-soft text-success",
  muted: "bg-surface-2 text-muted",
  signal: "bg-signal-soft text-signal-ink",
  danger: "bg-danger-soft text-danger",
};

export default function ListingsPage({ searchParams }: PageProps<"/anuncios">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
      <Listings searchParams={searchParams} />
    </Suspense>
  );
}

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : (value?.[0] ?? "");
const many = (value: string | string[] | undefined) =>
  typeof value === "string" ? [value] : (value ?? []);

async function Listings({ searchParams }: Pick<PageProps<"/anuncios">, "searchParams">) {
  const member = await requirePermission("listings.view");
  const canEdit = can(member.role, "listings.edit");
  const { tdb } = await getTenantContext(member);
  const params = await searchParams;

  const search = one(params.busca);
  const status = one(params.status);
  const accountIds = many(params.conta);
  const familyId = one(params.familia);
  const page = Math.max(1, Number(one(params.pagina)) || 1);
  const statusFilter =
    status in LISTING_STATUS_FILTERS ? (status as ListingStatusFilter) : undefined;

  const [accounts, result] = await Promise.all([
    listingAccounts(tdb),
    listListings(tdb, {
      search,
      status: statusFilter,
      accountIds,
      familyId: familyId || undefined,
      page,
    }),
  ]);

  const query = (overrides: Record<string, string | string[] | null>) => {
    const next = new URLSearchParams();
    const base: Record<string, string | string[]> = {
      busca: search,
      status: statusFilter ?? "",
      conta: accountIds,
      familia: familyId,
      pagina: page > 1 ? String(page) : "",
    };
    for (const [key, value] of Object.entries({ ...base, ...overrides })) {
      if (value === null) continue;
      for (const item of Array.isArray(value) ? value : [value]) if (item) next.append(key, item);
    }
    const text = next.toString();
    return text ? `/anuncios?${text}` : "/anuncios";
  };

  if (accounts.length === 0) {
    return (
      <>
        <PageHeader title="Anúncios" />
        <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center">
          <p className="font-display text-lg font-semibold text-ink">Nenhuma conta conectada</p>
          <p className="mt-1 text-sm text-muted">
            Conecte uma conta do Mercado Livre e importe os anúncios para vê-los aqui.
          </p>
          <div className="mt-4 flex justify-center">
            <ButtonLink href="/contas">Ir para Contas de marketplace</ButtonLink>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Anúncios"
        description={`${result.total} ${result.total === 1 ? "anúncio" : "anúncios"} encontrados.`}
        actions={
          <ButtonLink href="/contas" variant="secondary">
            Importar / atualizar
          </ButtonLink>
        }
      />

      <ul className="mb-4 flex flex-wrap gap-2 text-xs text-muted">
        {accounts.map((account) => (
          <li key={account.id} className="rounded-full border border-border bg-surface px-3 py-1">
            <span className="font-medium text-ink">{account.nickname}</span>: última sincronização{" "}
            {account.lastSyncAt ? DATE_TIME.format(account.lastSyncAt) : "nunca"}
          </li>
        ))}
      </ul>

      <form
        className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
        role="search"
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <input
              type="search"
              name="busca"
              defaultValue={search}
              placeholder="Título, SKU, família ou ID (MLB…)"
              aria-label="Buscar anúncios"
              className="h-10 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-ink outline-none focus:border-brand focus:ring-3 focus:ring-brand/20"
            />
          </div>
          <select
            name="status"
            defaultValue={statusFilter ?? ""}
            aria-label="Status"
            className="h-10 rounded-lg border border-border bg-surface px-3 text-ink"
          >
            <option value="">Todos os status</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
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
        {familyId ? (
          <p className="text-sm text-muted">
            Mostrando uma família.{" "}
            <Link
              href={query({ familia: null, pagina: null })}
              className="text-brand hover:underline"
            >
              Ver todas
            </Link>
          </p>
        ) : null}
      </form>

      {result.listings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center">
          <p className="font-display text-lg font-semibold text-ink">Nenhum anúncio encontrado</p>
          <p className="mt-1 text-sm text-muted">
            Ajuste os filtros, ou importe os anúncios em Contas de marketplace.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Anúncio</th>
                <th className="px-4 py-3 font-medium">Conta</th>
                <th className="px-4 py-3 text-right font-medium">Preço</th>
                <th className="px-4 py-3 text-right font-medium">Estoque</th>
                <th className="px-4 py-3 text-right font-medium">Vendidos</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">SKU do ERP</th>
              </tr>
            </thead>
            <tbody>
              {result.listings.map((listing) => {
                const statusInfo = listingStatusLabel(listing.status);
                return (
                  <tr key={listing.id} className="border-b border-border align-top last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex gap-3">
                        {listing.thumbnailUrl ? (
                          // Marketplace CDN thumbnails; next/image optimization would spend the
                          // hosting plan's image quota on hundreds of tiny previews.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={listing.thumbnailUrl}
                            alt=""
                            width={48}
                            height={48}
                            loading="lazy"
                            className="size-12 shrink-0 rounded-md border border-border bg-white object-contain"
                          />
                        ) : (
                          <span className="size-12 shrink-0 rounded-md border border-border bg-surface-2" />
                        )}
                        <div className="min-w-0">
                          <p className="line-clamp-2 font-medium text-ink">{listing.title}</p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                            <span className="tabular-nums">{listing.externalId}</span>
                            <span className="rounded bg-surface-2 px-1.5 py-px font-medium">
                              {LISTING_MODEL_SHORT[listing.listingModel]}
                            </span>
                            {listing.familyId && listing.familyName ? (
                              <Link
                                href={query({ familia: listing.familyId, pagina: null })}
                                className="hover:text-brand"
                                title="Ver todos os anúncios desta família"
                              >
                                Família: {listing.familyName}
                              </Link>
                            ) : null}
                            {listing._count.variations ? (
                              <span>{listing._count.variations} variações</span>
                            ) : null}
                            {listing.permalink ? (
                              <a
                                href={listing.permalink}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-0.5 hover:text-brand"
                              >
                                Ver no ML <ExternalLink className="size-3" aria-hidden="true" />
                              </a>
                            ) : null}
                            {canEdit && listing.account.allowWrites ? (
                              <Link
                                href={`/anuncios/${listing.id}/editar`}
                                className="inline-flex items-center gap-0.5 font-medium text-brand hover:underline"
                              >
                                <Pencil className="size-3" aria-hidden="true" />
                                Editar
                              </Link>
                            ) : null}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">{listing.account.nickname}</td>
                    <td className="px-4 py-3 text-right text-ink tabular-nums">
                      {listing.priceCents === null ? "—" : formatCents(listing.priceCents)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums ${
                        listing.availableQuantity === 0
                          ? "font-semibold text-signal-ink"
                          : "text-ink"
                      }`}
                    >
                      {listing.availableQuantity ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-muted tabular-nums">
                      {listing.soldQuantity ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TONE_CLASSES[statusInfo.tone]}`}
                      >
                        {statusInfo.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {listing._count.mappings > 0 ? (
                        <span className="text-xs text-success">Vinculado</span>
                      ) : (
                        <Link
                          href="/mapeamento"
                          className="text-xs text-signal-ink hover:underline"
                        >
                          Sem vínculo
                        </Link>
                      )}
                      {listing.sellerSku ? (
                        <span className="block text-xs text-muted">ML: {listing.sellerSku}</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {result.pageCount > 1 ? (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Paginação">
          {result.page > 1 ? (
            <Link
              href={query({ pagina: String(result.page - 1) })}
              className="text-brand hover:underline"
            >
              ‹ Anterior
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            Página {result.page} de {result.pageCount}
          </span>
          {result.page < result.pageCount ? (
            <Link
              href={query({ pagina: String(result.page + 1) })}
              className="text-brand hover:underline"
            >
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
