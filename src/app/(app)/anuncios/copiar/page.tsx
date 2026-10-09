import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { getTenantContext } from "@/server/tenant/tenant-db";

import { copyOneAction } from "../copy-actions";

export const metadata: Metadata = { title: "Copiar anúncio" };

const ERRORS: Record<string, string> = {
  link: "Não encontrei um código de anúncio (MLB…) no que foi colado.",
  conta: "Escolha a conta onde o rascunho será criado.",
  duplicate: "Esse anúncio já foi copiado.",
  has_variations: "Anúncio com variações: ainda não é copiado.",
  not_found: "Anúncio não encontrado no Mercado Livre.",
  account_unavailable: "A conta de destino não está conectada.",
  reconnect: "A conta precisa ser reconectada em Contas de marketplace.",
  marketplace_error: "O Mercado Livre não respondeu. Tente de novo.",
};

export default function CopyListingPage({ searchParams }: PageProps<"/anuncios/copiar">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
      <CopyListing searchParams={searchParams} />
    </Suspense>
  );
}

function param(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

async function CopyListing({ searchParams }: Pick<PageProps<"/anuncios/copiar">, "searchParams">) {
  const member = await requirePermission("listings.edit");
  const { tdb } = await getTenantContext(member);
  const params = await searchParams;
  const accounts = await tdb.marketplaceAccount.findMany({
    where: { status: "active" },
    orderBy: { nickname: "asc" },
    select: { id: true, nickname: true },
  });
  const error = ERRORS[param(params.erro)];

  return (
    <>
      <PageHeader
        title="Copiar anúncio"
        description="Cole o link ou o código (MLB…) de qualquer anúncio do Mercado Livre — seu ou de outro vendedor. Ele vira um rascunho para você revisar."
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

      <p className="mb-5 rounded-lg border-l-4 border-signal bg-signal-soft px-3 py-2 text-sm text-signal-ink">
        Fotos e textos de outros vendedores podem ter direitos autorais. O Mercado Livre pode pausar
        ou cancelar anúncios denunciados por isso. Antes de publicar, prefira trocar as fotos e
        reescrever a descrição.
      </p>

      <form action={copyOneAction} className="flex max-w-2xl flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink">Link ou código do anúncio</span>
          <input
            name="ref"
            required
            defaultValue={param(params.ref)}
            placeholder="https://produto.mercadolivre.com.br/MLB-… ou MLB123456789"
            className="h-10 rounded-lg border border-border bg-surface px-3 text-ink outline-none focus:border-brand focus:ring-3 focus:ring-brand/20"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink">Criar o rascunho na conta</span>
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
                {account.nickname}
              </option>
            ))}
          </select>
        </label>
        <div>
          <button
            type="submit"
            className="inline-flex h-10 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-on-brand hover:bg-brand-hover"
          >
            Copiar para rascunho
          </button>
        </div>
        <p className="text-xs text-muted">
          Anúncios seus já vinculados a um SKU levam o vínculo junto. Anúncios com variações ainda
          não são copiados.
        </p>
      </form>
    </>
  );
}
