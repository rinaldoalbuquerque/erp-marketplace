import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/domain/auth/permissions";
import { variationLabel } from "@/domain/products/schemas";
import { MOVEMENT_LABELS } from "@/domain/stock/movements";
import { requirePermission } from "@/server/auth/session";
import { getSkuStock, HISTORY_SIZE } from "@/server/stock/queries";
import { getTenantContext } from "@/server/tenant/tenant-db";

import { AdjustStockForm } from "../adjust-form";

export const metadata: Metadata = { title: "Estoque do SKU" };

const DATE_TIME = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

export default function SkuStockPage({ params }: PageProps<"/estoque/[skuId]">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
      <SkuStock params={params} />
    </Suspense>
  );
}

async function SkuStock({ params }: Pick<PageProps<"/estoque/[skuId]">, "params">) {
  const member = await requirePermission("stock.view");
  const { tdb } = await getTenantContext(member);
  const { skuId } = await params;
  if (!z.uuid().safeParse(skuId).success) notFound();
  const data = await getSkuStock(tdb, skuId);
  if (!data) notFound();
  const { sku, movements } = data;
  const negative = sku.stockOnHand < 0;

  return (
    <>
      <PageHeader
        title={sku.code}
        description={
          <>
            <Link href={`/produtos/${sku.product.id}`} className="hover:text-brand">
              {sku.product.name}
            </Link>
            . {variationLabel(sku.variation)}
            {sku.location ? `. Local: ${sku.location}` : ""}
          </>
        }
        back={{ href: "/estoque", label: "Estoque" }}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <section
            className={`rounded-xl border p-5 ${
              negative ? "border-signal bg-signal-soft" : "border-border bg-surface"
            }`}
          >
            <p className="text-sm text-muted">Saldo atual</p>
            <p
              className={`font-display text-5xl font-semibold tabular-nums ${
                negative ? "text-signal-ink" : "text-ink"
              }`}
            >
              {sku.stockOnHand}
              <span className="ml-2 text-lg font-medium text-muted">{sku.unit}</span>
            </p>
            {negative ? (
              <p className="mt-2 text-sm text-signal-ink">
                Saldo negativo: vendas registradas além do estoque. Faça uma contagem para corrigir.
              </p>
            ) : null}
          </section>

          {can(member.role, "stock.adjust") ? (
            <AdjustStockForm skuId={sku.id} unit={sku.unit} />
          ) : null}
        </div>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-ink">Histórico</h2>
          {movements.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-muted">
              Nenhuma movimentação ainda.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-surface">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">Quando</th>
                    <th className="px-4 py-3 font-medium">Tipo</th>
                    <th className="px-4 py-3 text-right font-medium">Qtd.</th>
                    <th className="px-4 py-3 text-right font-medium">Saldo</th>
                    <th className="px-4 py-3 font-medium">Motivo</th>
                    <th className="px-4 py-3 font-medium">Por</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((movement) => (
                    <tr key={movement.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 whitespace-nowrap text-muted tabular-nums">
                        {DATE_TIME.format(movement.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-ink">{MOVEMENT_LABELS[movement.type]}</td>
                      <td
                        className={`px-4 py-3 text-right font-medium tabular-nums ${
                          movement.quantity > 0 ? "text-success" : "text-danger"
                        }`}
                      >
                        {movement.quantity > 0 ? `+${movement.quantity}` : movement.quantity}
                      </td>
                      <td className="px-4 py-3 text-right text-ink tabular-nums">
                        {movement.balanceAfter}
                      </td>
                      <td className="px-4 py-3 text-muted">{movement.reason ?? "—"}</td>
                      <td className="px-4 py-3 text-muted">
                        {movement.createdBy?.fullName ?? "Sistema"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {movements.length === HISTORY_SIZE ? (
            <p className="mt-2 text-xs text-muted">
              Mostrando as {HISTORY_SIZE} movimentações mais recentes.
            </p>
          ) : null}
        </section>
      </div>
    </>
  );
}
