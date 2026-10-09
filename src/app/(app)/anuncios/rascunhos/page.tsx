import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ButtonLink, PageHeader } from "@/components/ui/page-header";
import { formatCents } from "@/domain/products/money";
import { requirePermission } from "@/server/auth/session";
import { draftListing, listDrafts } from "@/server/listings/draft-service";
import { getTenantContext } from "@/server/tenant/tenant-db";

export const metadata: Metadata = { title: "Rascunhos de anúncio" };

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

export default function DraftsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
      <Drafts />
    </Suspense>
  );
}

async function Drafts() {
  const member = await requirePermission("listings.edit");
  const { tdb } = await getTenantContext(member);
  const drafts = await listDrafts(tdb);

  return (
    <>
      <PageHeader
        title="Rascunhos de anúncio"
        description="Anúncios em preparo, ainda não publicados."
        back={{ href: "/anuncios", label: "Anúncios" }}
        actions={
          <ButtonLink href="/anuncios/novo">
            <Plus className="size-4" aria-hidden="true" />
            Novo anúncio
          </ButtonLink>
        }
      />
      {drafts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center">
          <p className="font-display text-lg font-semibold text-ink">Nenhum rascunho</p>
          <p className="mt-1 text-sm text-muted">Comece um novo anúncio a partir de um SKU.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Anúncio</th>
                <th className="px-4 py-3 font-medium">Conta</th>
                <th className="px-4 py-3 text-right font-medium">Preço</th>
                <th className="px-4 py-3 font-medium">Situação</th>
                <th className="px-4 py-3 font-medium">Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((draft) => {
                const listing = draftListing(draft.content);
                const status = STATUS[draft.status];
                return (
                  <tr key={draft.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/anuncios/rascunhos/${draft.id}`}
                        className="font-medium text-ink hover:text-brand"
                      >
                        {listing.familyName || listing.title || "Sem nome"}
                      </Link>
                      <p className="text-xs text-muted">
                        {draft.sku ? `SKU ${draft.sku.code}` : "Sem SKU"}
                        {draft.status === "failed" && draft.lastErrors[0]
                          ? ` · ${draft.lastErrors[0]}`
                          : ""}
                      </p>
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
