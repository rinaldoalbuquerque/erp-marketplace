import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { ButtonLink, PageHeader } from "@/components/ui/page-header";
import { can } from "@/domain/auth/permissions";
import { toInput, type AttributeInput } from "@/domain/listings/attributes";
import { centsToInput } from "@/domain/products/money";
import { requirePermission } from "@/server/auth/session";
import { loadForEdit } from "@/server/listings/edit-service";
import { loadFamilyForEdit, type LoadFamilyResult } from "@/server/listings/family-edit-service";
import { getTenantContext } from "@/server/tenant/tenant-db";

import { EditListingForm, type EditFormInitial } from "./edit-form";
import { FamilyEditForm, type FamilyMemberInitial } from "./family-form";

export const metadata: Metadata = { title: "Editar anúncio" };

const DATE_TIME = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

const FIELD_LABELS: Record<string, string> = {
  title: "Título",
  familyName: "Nome da família",
  price: "Preço",
  status: "Status",
  description: "Descrição",
};

const EDIT_STATUS = {
  success: { label: "Salvo", className: "text-success" },
  partial: { label: "Salvo em parte", className: "text-signal-ink" },
  failed: { label: "Recusado", className: "text-danger" },
} as const;

export default function EditListingPage({ params }: PageProps<"/anuncios/[id]/editar">) {
  return (
    <Suspense
      fallback={<p className="text-sm text-muted">Buscando a versão atual no Mercado Livre…</p>}
    >
      <EditListing params={params} />
    </Suspense>
  );
}

async function EditListing({ params }: Pick<PageProps<"/anuncios/[id]/editar">, "params">) {
  const member = await requirePermission("listings.edit");
  const { tdb } = await getTenantContext(member);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  // A listing of a User Products family: every variant on this same page.
  const family = await loadFamilyForEdit(
    { tdb, organizationId: member.organizationId, userId: member.user.id },
    id,
  );
  if (family.status === "ok") {
    const skus = await tdb.sku.findMany({
      orderBy: { code: "asc" },
      take: 2000,
      select: { code: true },
    });
    return <FamilyPage listingId={id} family={family} skuCodes={skus.map((sku) => sku.code)} />;
  }

  const result = await loadForEdit(
    {
      tdb,
      organizationId: member.organizationId,
      userId: member.user.id,
      canClose: can(member.role, "listings.delete"),
    },
    id,
  );
  if (result.status === "not_found") notFound();
  if (result.status !== "ok") {
    const messages = {
      writes_disabled:
        "As alterações pelo ERP estão bloqueadas para esta conta. Libere em Contas de marketplace.",
      reconnect: "A conta precisa ser reconectada em Contas de marketplace.",
      marketplace_error: "Não foi possível buscar o anúncio no Mercado Livre agora. Tente de novo.",
    } as const;
    return (
      <>
        <PageHeader title="Editar anúncio" back={{ href: "/anuncios", label: "Anúncios" }} />
        <div className="rounded-xl border-l-4 border-signal bg-signal-soft p-5 text-sm text-signal-ink">
          <p>{messages[result.status]}</p>
          <div className="mt-3">
            <ButtonLink href="/contas" variant="secondary">
              Ir para Contas de marketplace
            </ButtonLink>
          </div>
        </div>
      </>
    );
  }

  const { editable, definitions } = result;
  const { listing } = editable;
  const byId = new Map(editable.attributes.map((value) => [value.id, value]));
  const attributeInputs: Record<string, AttributeInput> = {};
  const readOnlyValues: Record<string, string> = {};
  for (const definition of definitions) {
    const current = byId.get(definition.id);
    if (definition.readOnly) {
      if (current?.valueName) readOnlyValues[definition.id] = current.valueName;
    } else {
      attributeInputs[definition.id] = toInput(definition, current);
    }
  }
  const initial: EditFormInitial = {
    versionStamp: result.versionStamp,
    title: listing.title,
    familyName: listing.familyName ?? "",
    price: centsToInput(listing.priceCents),
    status: listing.status,
    description: editable.description ?? "",
    attributes: attributeInputs,
    readOnlyValues,
  };

  const history = await tdb.listingEdit.findMany({
    where: { listingId: id },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      createdAt: true,
      status: true,
      message: true,
      changes: true,
      user: { select: { fullName: true } },
    },
  });

  return (
    <>
      <PageHeader
        title="Editar anúncio"
        description={
          <span className="flex flex-wrap items-center gap-x-3">
            <span className="tabular-nums">{listing.externalId}</span>
            <span>Conta {result.accountNickname}</span>
            {listing.permalink ? (
              <a
                href={listing.permalink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-brand hover:underline"
              >
                Ver no Mercado Livre <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            ) : null}
          </span>
        }
        back={{ href: "/anuncios", label: "Anúncios" }}
      />

      <div className="mb-5 flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
        {listing.thumbnailUrl ? (
          // Marketplace CDN thumbnail (see /anuncios).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.thumbnailUrl}
            alt=""
            width={56}
            height={56}
            className="size-14 rounded-md border border-border bg-white object-contain"
          />
        ) : null}
        <div className="min-w-0">
          <p className="font-medium text-ink">{listing.title}</p>
          <p className="text-xs text-muted">
            {listing.listingModel === "user_products" ? "User Products" : "Tradicional"}
            {listing.soldQuantity ? `, ${listing.soldQuantity} vendidos` : ""}. Os dados abaixo
            vieram agora do Mercado Livre.
          </p>
        </div>
      </div>

      <EditListingForm
        listingId={id}
        initial={initial}
        definitions={definitions}
        rules={editable.rules}
        canClose={can(member.role, "listings.delete")}
      />

      {history[0] ? (
        <section className="mt-8 max-w-4xl text-sm">
          <h2 className="mb-3 text-xl font-semibold text-ink">Última alteração</h2>
          <EditEntry edit={history[0]} />
          {history.length > 1 ? (
            // Older edits stay recorded; collapsed so the screen shows only the latest.
            <details className="mt-2">
              <summary className="cursor-pointer text-muted hover:text-ink">
                Ver alterações anteriores ({history.length - 1})
              </summary>
              <ul className="mt-2 flex flex-col gap-2">
                {history.slice(1).map((edit) => (
                  <li key={edit.id}>
                    <EditEntry edit={edit} />
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

type EditRow = {
  createdAt: Date;
  status: keyof typeof EDIT_STATUS;
  message: string | null;
  changes: unknown;
  user: { fullName: string } | null;
};

function EditEntry({ edit }: { edit: EditRow }) {
  const changes = (Array.isArray(edit.changes) ? edit.changes : []) as Array<{ field: string }>;
  const fields = changes.map((change) =>
    change.field.startsWith("attribute:")
      ? change.field.slice("attribute:".length)
      : (FIELD_LABELS[change.field] ?? change.field),
  );
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <span className="text-muted tabular-nums">{DATE_TIME.format(edit.createdAt)}</span>{" "}
      <span className={`font-medium ${EDIT_STATUS[edit.status].className}`}>
        {EDIT_STATUS[edit.status].label}
      </span>
      {edit.user ? <span className="text-muted"> por {edit.user.fullName}</span> : null}
      <span className="block text-ink">{fields.join(", ") || "—"}</span>
      {edit.message ? <span className="block text-muted">{edit.message}</span> : null}
    </div>
  );
}

function FamilyPage({
  listingId,
  family,
  skuCodes,
}: {
  listingId: string;
  family: Extract<LoadFamilyResult, { status: "ok" }>;
  skuCodes: string[];
}) {
  const editableDefinitions = family.definitions.filter((definition) => !definition.readOnly);
  const members: FamilyMemberInitial[] = family.members.map((member) => {
    const byId = new Map(member.editable.attributes.map((value) => [value.id, value]));
    const label =
      family.varyingIds
        .map((attributeId) => byId.get(attributeId)?.valueName)
        .filter(Boolean)
        .join(" / ") || member.externalId;
    return {
      listingId: member.listingId,
      externalId: member.externalId,
      label,
      thumbnailUrl: member.editable.listing.thumbnailUrl,
      versionStamp: member.versionStamp,
      skuCode: member.sku?.code ?? null,
      stock: member.sku?.stockOnHand ?? null,
      price: centsToInput(member.editable.listing.priceCents),
      status: member.editable.listing.status,
      description: member.editable.description ?? "",
      attributes: Object.fromEntries(
        editableDefinitions.map((definition) => [
          definition.id,
          toInput(definition, byId.get(definition.id)),
        ]),
      ),
    };
  });
  const opened = family.members.find((member) => member.listingId === listingId);
  return (
    <>
      <PageHeader
        title="Editar anúncio"
        description={
          <span className="flex flex-wrap items-center gap-x-3">
            <span>Família com {members.length} variantes</span>
            <span>Conta {family.accountNickname}</span>
            {opened?.editable.listing.permalink ? (
              <a
                href={opened.editable.listing.permalink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-brand hover:underline"
              >
                Ver no Mercado Livre <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            ) : null}
          </span>
        }
        back={{ href: "/anuncios", label: "Anúncios" }}
      />
      <FamilyEditForm
        key={members.map((member) => member.versionStamp).join("|")}
        listingId={listingId}
        familyName={family.familyName}
        categoryLabel={family.members[0]?.editable.listing.categoryId ?? "—"}
        definitions={family.definitions}
        varyingIds={family.varyingIds}
        members={members}
        skuCodes={skuCodes}
      />
    </>
  );
}
