import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";

import { ButtonLink, PageHeader } from "@/components/ui/page-header";
import { formatCents } from "@/domain/products/money";
import { requirePermission } from "@/server/auth/session";
import { draftListing, listDrafts } from "@/server/listings/draft-service";
import { getTenantContext } from "@/server/tenant/tenant-db";

import { DeleteDraftButton, PUBLISH_FORM_ID, PublishBar } from "./publish-bar";

export const metadata: Metadata = { title: "Rascunhos de anúncio" };

// Publishing batches started here run in the background (`after`) with this
// page's max duration (Vercel Hobby limit: 300s).
export const maxDuration = 300;

const DATE_TIME = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

const STATUS = {
  draft: { label: "Rascunho", className: "bg-surface-2 text-muted" },
  validated: { label: "Validado", className: "bg-success-soft text-success" },
  publishing: { label: "Publicando…", className: "bg-surface-2 text-ink" },
  published: { label: "Publicado", className: "bg-success-soft text-success" },
  failed: { label: "Recusado", className: "bg-signal-soft text-signal-ink" },
} as const;

const PUBLISHABLE = new Set(["draft", "validated", "failed"]);
const MLB = /^MLB\d{6,15}$/;

export default function DraftsPage({ searchParams }: PageProps<"/anuncios/rascunhos">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
      <Drafts searchParams={searchParams} />
    </Suspense>
  );
}

async function Drafts({ searchParams }: Pick<PageProps<"/anuncios/rascunhos">, "searchParams">) {
  const member = await requirePermission("listings.edit");
  const { tdb } = await getTenantContext(member);
  const params = await searchParams;
  const lote = typeof params.lote === "string" ? params.lote : "";
  const batchJobId = z.uuid().safeParse(lote).success ? lote : null;
  const drafts = await listDrafts(tdb, { batchJobId });
  const mlb = typeof params.mlb === "string" && MLB.test(params.mlb) ? params.mlb : null;
  const notice =
    params.aviso === "publicado"
      ? `Anúncio publicado${mlb ? `: ${mlb}` : ""}.`
      : params.aviso === "excluido"
        ? "Rascunho excluído."
        : null;

  return (
    <>
      <PageHeader
        title="Rascunhos de anúncio"
        description={
          batchJobId
            ? "Rascunhos criados por uma cópia em lote."
            : "Anúncios em preparo, ainda não publicados."
        }
        back={{ href: "/anuncios", label: "Anúncios" }}
        actions={
          <ButtonLink href="/anuncios/novo">
            <Plus className="size-4" aria-hidden="true" />
            Novo anúncio
          </ButtonLink>
        }
      />
      {batchJobId ? (
        <p className="mb-4 text-sm text-muted">
          Mostrando um lote.{" "}
          <Link href="/anuncios/rascunhos" className="text-brand hover:underline">
            Ver todos os rascunhos
          </Link>
        </p>
      ) : null}

      {typeof params.variacoes === "string" && /^\d+$/.test(params.variacoes) ? (
        <p
          role="status"
          className="mb-4 rounded-lg border-l-4 border-success bg-success-soft px-3 py-2 text-sm text-success"
        >
          O anúncio tinha variações: foram criados {params.variacoes} rascunhos, um por variação,
          todos com o mesmo nome de família. Revise cada um antes de publicar.
        </p>
      ) : null}

      {notice ? (
        <p
          role="status"
          className="mb-4 rounded-lg border-l-4 border-success bg-success-soft px-3 py-2 text-sm text-success"
        >
          {notice}
        </p>
      ) : null}

      {drafts.length ? <PublishBar /> : null}

      {drafts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center">
          <p className="font-display text-lg font-semibold text-ink">Nenhum rascunho</p>
          <p className="mt-1 text-sm text-muted">
            Comece um novo anúncio a partir de um SKU, ou copie anúncios na lista de Anúncios.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted">
              <tr>
                <th className="w-10 px-4 py-3">
                  <span className="sr-only">Marcar</span>
                </th>
                <th className="px-4 py-3 font-medium">Anúncio</th>
                <th className="px-4 py-3 font-medium">Conta</th>
                <th className="px-4 py-3 text-right font-medium">Preço</th>
                <th className="px-4 py-3 font-medium">Situação</th>
                <th className="px-4 py-3 font-medium">Atualizado</th>
                <th className="w-10 px-4 py-3">
                  <span className="sr-only">Excluir</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((draft) => {
                const listing = draftListing(draft.content);
                const status = STATUS[draft.status];
                return (
                  <tr key={draft.id} className="border-b border-border align-top last:border-0">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        name="draftId"
                        value={draft.id}
                        form={PUBLISH_FORM_ID}
                        data-publishable={PUBLISHABLE.has(draft.status) ? "1" : "0"}
                        disabled={draft.status === "publishing"}
                        aria-label="Marcar rascunho"
                        className="size-4 accent-brand disabled:opacity-30"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/anuncios/rascunhos/${draft.id}`}
                        className="font-medium text-ink hover:text-brand"
                      >
                        {listing.familyName || listing.title || "Sem nome"}
                      </Link>
                      <p className="text-xs text-muted">
                        {draft.sku ? `SKU ${draft.sku.code}` : "Sem SKU"}
                        {draft.sourceExternalId
                          ? ` · copiado de ${draft.sourceExternalId}${draft.sourceKind === "external" ? " (outro vendedor)" : ""}`
                          : ""}
                      </p>
                      {draft.status === "failed" && draft.lastErrors[0] ? (
                        <p className="text-xs text-signal-ink">{draft.lastErrors[0]}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-muted">{draft.account.nickname}</td>
                    <td className="px-4 py-3 text-right text-ink tabular-nums">
                      {listing.priceCents !== null ? formatCents(listing.priceCents) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted tabular-nums">
                      {DATE_TIME.format(draft.updatedAt)}
                    </td>
                    <td className="px-4 py-3">
                      {draft.status !== "publishing" ? (
                        <DeleteDraftButton
                          draftId={draft.id}
                          name={listing.familyName || listing.title || "Sem nome"}
                        />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
