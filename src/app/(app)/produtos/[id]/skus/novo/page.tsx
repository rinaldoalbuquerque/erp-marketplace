import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/domain/auth/permissions";
import { requirePermission } from "@/server/auth/session";
import { getTenantContext } from "@/server/tenant/tenant-db";

import { createSkuAction } from "../../../actions";
import { SkuForm } from "../../../product-forms";

export const metadata: Metadata = { title: "Nova variação" };

export default function NewSkuPage({ params }: PageProps<"/produtos/[id]/skus/novo">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
      <NewSku params={params} />
    </Suspense>
  );
}

async function NewSku({ params }: Pick<PageProps<"/produtos/[id]/skus/novo">, "params">) {
  const member = await requirePermission("products.edit");
  const { tdb } = await getTenantContext(member);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const product = await tdb.product.findFirst({ where: { id }, select: { id: true, name: true } });
  if (!product) notFound();

  return (
    <>
      <PageHeader
        title="Nova variação"
        description={product.name}
        back={{ href: `/produtos/${product.id}`, label: product.name }}
      />
      <SkuForm
        action={createSkuAction.bind(null, product.id)}
        defaults={{}}
        canSeeCost={can(member.role, "financial.view")}
        showInitialStock={can(member.role, "stock.adjust")}
        submitLabel="Adicionar variação"
      />
    </>
  );
}
