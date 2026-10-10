import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/domain/auth/permissions";
import { requirePermission } from "@/server/auth/session";
import { variationLabel } from "@/domain/products/schemas";
import {
  draftCategoryAttributes,
  draftFamily,
  draftSkuOptions,
  loadDraft,
} from "@/server/listings/draft-service";
import { getTenantContext } from "@/server/tenant/tenant-db";

import { deleteDraftAction, setDraftSkuAction } from "../actions";
import { DraftEditor } from "./draft-editor";

export const metadata: Metadata = { title: "Rascunho de anúncio" };

const STATUS_LABELS = {
  draft: "Rascunho",
  validated: "Validado pelo Mercado Livre",
  publishing: "Publicando…",
  published: "Publicado",
  failed: "Recusado na última tentativa",
} as const;

export default function DraftPage({ params, searchParams }: PageProps<"/anuncios/rascunhos/[id]">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
      <Draft params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const CODE = /^MLBd{6,15}$/;

async function Draft({
  params,
  searchParams,
}: Pick<PageProps<"/anuncios/rascunhos/[id]">, "params" | "searchParams">) {
  const member = await requirePermission("listings.edit");
  const { tdb } = await getTenantContext(member);
  const { id } = await params;
  const query = await searchParams;
  const catalog =
    typeof query.catalogo === "string" && CODE.test(query.catalogo) ? query.catalogo : null;
  if (!z.uuid().safeParse(id).success) notFound();
  const draft = await loadDraft(tdb, id);
  if (!draft) notFound();

  // Technical sheet of the chosen category (cached 24h).
  let definitions = null;
  let sheetError = false;
  if (draft.listing.categoryId && draft.editable) {
    const result = await draftCategoryAttributes(
      { tdb, organizationId: member.organizationId, userId: member.user.id },
      id,
      draft.listing.categoryId,
    );
    if (result.status === "ok") definitions = result.definitions;
    else sheetError = true;
  }
  const ctx = { tdb, organizationId: member.organizationId, userId: member.user.id };
  const [family, skuOptions] = await Promise.all([
    draft.editable ? draftFamily(ctx, id) : Promise.resolve(null),
    draft.editable ? draftSkuOptions(tdb, id) : Promise.resolve([]),
  ]);
  const newVariation = query["nova-variacao"] === "1";
  const canSeeCost = can(member.role, "financial.view");
  const name = draft.listing.familyName || draft.listing.title || "Sem nome";

  return (
    <>
      <PageHeader
        title={name}
        description={
          <>
            {STATUS_LABELS[draft.status]} · conta {draft.account.nickname}
            {draft.account.listingModel === "user_products" ? " (User Products)" : ""}
            {draft.sku ? ` · SKU ${draft.sku.code}` : " · sem SKU"}
            {draft.sourceExternalId
              ? ` · copiado de ${draft.sourceExternalId}${draft.sourceKind === "external" ? " (outro vendedor)" : ""}`
              : ""}
          </>
        }
        back={{ href: "/anuncios/rascunhos", label: "Rascunhos" }}
        actions={
          draft.editable ? (
            <form action={deleteDraftAction.bind(null, draft.id)}>
              <button
                type="submit"
                className="h-10 rounded-lg border border-border bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-2"
              >
                Excluir rascunho
              </button>
            </form>
          ) : null
        }
      />

      {draft.status === "published" ? (
        <p
          role="status"
          className="mb-5 rounded-lg border-l-4 border-success bg-success-soft px-3 py-2 text-sm text-success"
        >
          Publicado como {draft.externalId}.{" "}
          {draft.listingId ? (
            <Link href={`/anuncios/${draft.listingId}/editar`} className="font-medium underline">
              Abrir a edição do anúncio
            </Link>
          ) : null}
        </p>
      ) : null}
      {catalog ? (
        <p
          role="status"
          className="mb-5 rounded-lg border-l-4 border-success bg-success-soft px-3 py-2 text-sm text-success"
        >
          Rascunho criado a partir do produto {catalog} do catálogo do Mercado Livre: nome, fotos,
          ficha técnica e descrição vieram do catálogo. Defina o preço e confira a categoria antes
          de publicar.
        </p>
      ) : null}
      {draft.sourceKind === "external" && draft.editable ? (
        <p className="mb-5 rounded-lg border-l-4 border-signal bg-signal-soft px-3 py-2 text-sm text-signal-ink">
          Copiado de outro vendedor: antes de publicar, troque as fotos e reescreva a descrição para
          evitar denúncias por direitos autorais.
        </p>
      ) : null}
      {newVariation && draft.editable ? (
        <p
          role="status"
          className="mb-5 rounded-lg border-l-4 border-success bg-success-soft px-3 py-2 text-sm text-success"
        >
          Nova variação da família “{family?.familyName ?? draft.listing.familyName}”: preencha o
          que muda nesta variação{family?.childAttributeIds.length ? " (em destaque abaixo)" : ""},
          as fotos, o código de barras (GTIN) e o SKU desta variação. O restante veio do anúncio
          original.
        </p>
      ) : null}

      {draft.editable ? (
        <form
          action={setDraftSkuAction.bind(null, draft.id)}
          className="mb-5 flex max-w-4xl flex-col gap-2 rounded-xl border border-border bg-surface p-4 text-sm sm:flex-row sm:items-end"
        >
          <label className="flex flex-1 flex-col gap-1">
            <span className="font-medium text-ink">SKU do ERP deste anúncio</span>
            <select
              name="skuId"
              defaultValue={draft.sku?.id ?? ""}
              className="h-10 rounded-lg border border-border bg-surface px-3 text-ink"
            >
              <option value="">Sem SKU (vincular depois em Mapeamento)</option>
              {draft.sku && !skuOptions.some((sku) => sku.id === draft.sku!.id) ? (
                <option value={draft.sku.id}>{draft.sku.code}</option>
              ) : null}
              {skuOptions.map((sku) => (
                <option key={sku.id} value={sku.id}>
                  {sku.code} · {variationLabel(sku.variation)} · estoque {sku.stockOnHand}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted">
              {skuOptions.length
                ? "Mostrando os SKUs do mesmo produto. Ao publicar, o anúncio fica vinculado a este SKU."
                : "Ao publicar, o anúncio fica vinculado a este SKU."}
            </span>
          </label>
          <button
            type="submit"
            className="h-10 rounded-lg border border-border bg-surface px-4 font-medium text-ink hover:bg-surface-2"
          >
            Salvar SKU
          </button>
        </form>
      ) : null}

      {sheetError ? (
        <p className="mb-5 rounded-lg border-l-4 border-signal bg-signal-soft px-3 py-2 text-sm text-signal-ink">
          Não foi possível carregar a ficha técnica da categoria agora. Recarregue a página.
        </p>
      ) : null}

      <DraftEditor
        draftId={draft.id}
        model={draft.model}
        editable={draft.editable}
        allowWrites={draft.account.allowWrites}
        initial={draft.listing}
        initialDefinitions={definitions}
        lastErrors={draft.status === "failed" ? draft.lastErrors : []}
        varyingIds={family?.childAttributeIds ?? []}
        sku={
          draft.sku
            ? {
                code: draft.sku.code,
                stockOnHand: draft.sku.stockOnHand,
                costCents: canSeeCost ? draft.sku.costCents : null,
              }
            : null
        }
      />
    </>
  );
}
