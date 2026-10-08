import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/domain/auth/permissions";
import { requirePermission } from "@/server/auth/session";

import { createProductAction } from "../actions";
import { NewProductForm } from "../product-forms";

export const metadata: Metadata = { title: "Novo produto" };

export default function NewProductPage() {
  return (
    <>
      <PageHeader
        title="Novo produto"
        description="Cadastre o produto e o primeiro SKU. Outras variações podem ser adicionadas depois."
        back={{ href: "/produtos", label: "Produtos" }}
      />
      <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
        <NewProduct />
      </Suspense>
    </>
  );
}

async function NewProduct() {
  const member = await requirePermission("products.edit");
  return (
    <NewProductForm
      action={createProductAction}
      canSeeCost={can(member.role, "financial.view")}
      canAdjustStock={can(member.role, "stock.adjust")}
    />
  );
}
