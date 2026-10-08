import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ButtonLink, PageHeader } from "@/components/ui/page-header";
import { can } from "@/domain/auth/permissions";
import { requirePermission } from "@/server/auth/session";
import { getProductProposal } from "@/server/products/from-listings-service";
import { getTenantContext } from "@/server/tenant/tenant-db";

import { ReviewForm } from "./review-form";

export const metadata: Metadata = { title: "Criar produtos a partir dos anúncios" };

// Creating hundreds of products + stock entries runs in the Server Action:
// allow the hosting maximum (Vercel Hobby: 300s).
export const maxDuration = 300;

export default function CreateFromListingsPage() {
  return (
    <>
      <PageHeader
        title="Criar produtos a partir dos anúncios"
        description="Revise o que o ERP propõe a partir dos anúncios importados. Nada é criado até você confirmar."
        back={{ href: "/produtos", label: "Produtos" }}
      />
      <Suspense fallback={<p className="text-sm text-muted">Montando a proposta…</p>}>
        <Proposal />
      </Suspense>
    </>
  );
}

async function Proposal() {
  const member = await requirePermission("products.edit");
  const { tdb } = await getTenantContext(member);
  const proposal = await getProductProposal(tdb, member.organizationId);
  const skuCount = proposal.products.reduce((sum, product) => sum + product.skus.length, 0);

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-3 sm:grid-cols-3">
        <Stat value={skuCount} label="SKUs novos propostos" />
        <Stat
          value={proposal.existingCodes.length}
          label="já existem no ERP (serão só vinculados)"
        />
        <Stat value={proposal.withoutSku.length} label="anúncios sem SKU no Mercado Livre" />
      </section>

      {skuCount === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center">
          <p className="font-display text-lg font-semibold text-ink">Nada novo para criar</p>
          <p className="mt-1 text-sm text-muted">
            Todos os SKUs dos anúncios importados já existem no ERP.
          </p>
          <div className="mt-4 flex justify-center">
            <ButtonLink href="/mapeamento">Ir para Mapeamento</ButtonLink>
          </div>
        </div>
      ) : (
        <ReviewForm
          products={proposal.products}
          canAdjustStock={can(member.role, "stock.adjust")}
        />
      )}

      {proposal.withoutSku.length ? (
        <details className="rounded-xl border border-border bg-surface p-4">
          <summary className="cursor-pointer font-medium text-ink">
            Anúncios sem SKU no Mercado Livre ({proposal.withoutSku.length})
          </summary>
          <p className="mt-2 text-sm text-muted">
            Estes não viram produtos. Cadastre o SKU no Mercado Livre e importe de novo, ou cadastre
            o produto à mão e vincule em{" "}
            <Link href="/mapeamento" className="text-brand hover:underline">
              Mapeamento
            </Link>
            .
          </p>
          <ul className="mt-3 flex flex-col gap-1 text-sm">
            {proposal.withoutSku.map((item) => (
              <li key={item.listingId} className="flex flex-wrap gap-x-2">
                <span className="text-muted tabular-nums">{item.externalId}</span>
                <span className="text-ink">{item.title}</span>
                {item.reason === "variations_without_sku" ? (
                  <span className="text-xs text-signal-ink">(variações sem SKU)</span>
                ) : null}
                {item.permalink ? (
                  <a
                    href={item.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-xs text-brand hover:underline"
                  >
                    Ver no ML <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="font-display text-3xl font-semibold text-ink tabular-nums">{value}</p>
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}
