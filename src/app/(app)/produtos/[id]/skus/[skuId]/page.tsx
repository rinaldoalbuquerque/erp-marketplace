import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/domain/auth/permissions";
import { skuToFormValues } from "@/domain/products/form-values";
import { requirePermission } from "@/server/auth/session";
import { getSku } from "@/server/products/queries";
import { getTenantContext } from "@/server/tenant/tenant-db";

import { updateSkuAction } from "../../../actions";
import { SkuForm } from "../../../product-forms";

export const metadata: Metadata = { title: "Editar variação" };

export default function EditSkuPage({ params }: PageProps<"/produtos/[id]/skus/[skuId]">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
      <EditSku params={params} />
    </Suspense>
  );
}

async function EditSku({ params }: Pick<PageProps<"/produtos/[id]/skus/[skuId]">, "params">) {
  const member = await requirePermission("products.edit");
  const { tdb } = await getTenantContext(member);
  const { id, skuId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(skuId).success) notFound();
  const [product, sku] = await Promise.all([
    tdb.product.findFirst({ where: { id }, select: { id: true, name: true } }),
    getSku(tdb, id, skuId),
  ]);
  if (!product || !sku) notFound();

  const canSeeCost = can(member.role, "financial.view");
  const defaults = skuToFormValues(sku);
  if (!canSeeCost) delete defaults.cost;

  return (
    <>
      <PageHeader
        title={sku.code}
        description={
          <>
            {product.name}. Estoque atual: <strong className="text-ink">{sku.stockOnHand}</strong>{" "}
            {sku.unit}.{" "}
            <Link href={`/estoque/${sku.id}`} className="text-brand hover:underline">
              Ver histórico e ajustar
            </Link>
          </>
        }
        back={{ href: `/produtos/${product.id}`, label: product.name }}
      />
      <SkuForm
        action={updateSkuAction.bind(null, product.id, sku.id)}
        defaults={defaults}
        canSeeCost={canSeeCost}
        showInitialStock={false}
        submitLabel="Salvar variação"
      />
    </>
  );
}
