import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { LISTING_MODEL_SHORT } from "@/domain/listings/labels";
import { variationLabel } from "@/domain/products/schemas";
import { requirePermission } from "@/server/auth/session";
import { getTenantContext } from "@/server/tenant/tenant-db";

import { createDraftAction } from "../rascunhos/actions";

export const metadata: Metadata = { title: "Novo anúncio" };

const ERRORS: Record<string, string> = {
  conta: "Escolha a conta onde o anúncio será publicado.",
  account_unavailable: "Essa conta não está conectada.",
  sku_not_found: "SKU não encontrado.",
};

export default function NewListingPage({ searchParams }: PageProps<"/anuncios/novo">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
      <NewListing searchParams={searchParams} />
    </Suspense>
  );
}

function param(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

async function NewListing({ searchParams }: Pick<PageProps<"/anuncios/novo">, "searchParams">) {
  const member = await requirePermission("listings.edit");
  const { tdb } = await getTenantContext(member);
  const params = await searchParams;
  const search = param(params.busca).trim();

  const [accounts, skus] = await Promise.all([
    tdb.marketplaceAccount.findMany({
      where: { status: "active" },
      orderBy: { nickname: "asc" },
      select: { id: true, nickname: true, listingModel: true, allowWrites: true },
    }),
    search
      ? tdb.sku.findMany({
          where: {
            product: { archivedAt: null },
            OR: [
              { code: { contains: search.toUpperCase() } },
              { ean: { startsWith: search.replace(/\D/g, "") || "-" } },
              { product: { name: { contains: search, mode: "insensitive" } } },
            ],
          },
          orderBy: { code: "asc" },
          take: 30,
          select: {
            id: true,
            code: true,
            variation: true,
            stockOnHand: true,
            product: { select: { name: true } },
            _count: { select: { listingMappings: true } },
          },
        })
      : Promise.resolve([]),
  ]);
  const error = ERRORS[param(params.erro)];

  return (
    <>
      <PageHeader
        title="Novo anúncio"
        description="Comece por um SKU do ERP: o anúncio já nasce com os dados do produto e vinculado ao estoque."
        back={{ href: "/anuncios", label: "Anúncios" }}
      />

      {error ? (
        <p
          role="alert"
          className="mb-5 rounded-lg border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      ) : null}

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
            placeholder="Buscar SKU por código, EAN ou nome do produto"
            aria-label="Buscar SKU"
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

      <form action={createDraftAction} className="flex flex-col gap-4">
        <section className="rounded-xl border border-border bg-surface p-5">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink">Publicar na conta</span>
            <select
              name="accountId"
              required
              defaultValue={accounts.length === 1 ? accounts[0]!.id : ""}
              className="h-10 rounded-lg border border-border bg-surface px-3 text-ink"
            >
              <option value="" disabled>
                Escolha…
              </option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.nickname} ({LISTING_MODEL_SHORT[account.listingModel]})
                  {account.allowWrites ? "" : " — alterações bloqueadas"}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted">
              Você pode montar o rascunho em qualquer conta; para publicar, a conta precisa estar
              com as alterações liberadas.
            </span>
          </label>
        </section>

        <section className="rounded-xl border border-border bg-surface p-5">
          <p className="mb-3 text-sm font-medium text-ink">SKU do anúncio</p>
          {!search ? (
            <p className="text-sm text-muted">Busque o SKU acima.</p>
          ) : skus.length === 0 ? (
            <p className="text-sm text-muted">
              Nenhum SKU encontrado.{" "}
              <Link href="/produtos/novo" className="text-brand hover:underline">
                Cadastrar produto
              </Link>
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {skus.map((sku, index) => (
                <li key={sku.id}>
                  <label className="flex cursor-pointer items-center gap-3 py-2 text-sm">
                    <input
                      type="radio"
                      name="skuId"
                      value={sku.id}
                      defaultChecked={index === 0}
                      className="size-4 accent-brand"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-ink">{sku.code}</span>{" "}
                      <span className="text-ink">{sku.product.name}</span>
                      <span className="block text-xs text-muted">
                        {variationLabel(sku.variation)} · estoque {sku.stockOnHand}
                        {sku._count.listingMappings
                          ? ` · já em ${sku._count.listingMappings} anúncio(s)`
                          : " · ainda sem anúncio"}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <label className="mt-3 flex items-center gap-2 text-sm text-muted">
            <input type="radio" name="skuId" value="" className="size-4 accent-brand" />
            Começar em branco (sem SKU)
          </label>
        </section>

        <div>
          <button
            type="submit"
            disabled={accounts.length === 0}
            className="inline-flex h-10 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
          >
            Criar rascunho
          </button>
        </div>
      </form>
    </>
  );
}
