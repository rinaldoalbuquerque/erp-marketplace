import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { changes, stockSyncPreview } from "@/server/stock-sync/queries";
import { getTenantContext } from "@/server/tenant/tenant-db";

import { enableStockSyncAction } from "../../stock-sync-actions";

export const metadata: Metadata = { title: "Sincronizar estoque" };

// Enabling sends every linked listing in the background (`after`), which gets
// this page's max duration (Vercel Hobby limit: 300s).
export const maxDuration = 300;

export default function StockSyncPreviewPage({
  params,
}: PageProps<"/contas/[accountId]/sincronizar-estoque">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
      <Preview params={params} />
    </Suspense>
  );
}

async function Preview({
  params,
}: Pick<PageProps<"/contas/[accountId]/sincronizar-estoque">, "params">) {
  const member = await requirePermission("marketplaceAccounts.manage");
  const { tdb } = await getTenantContext(member);
  const { accountId } = await params;
  if (!z.uuid().safeParse(accountId).success) notFound();
  const account = await tdb.marketplaceAccount.findFirst({
    where: { id: accountId },
    select: { nickname: true, status: true, allowWrites: true, stockSyncEnabled: true },
  });
  if (!account) notFound();
  const rows = await stockSyncPreview(tdb, accountId);

  const toSend = rows.filter((row) => row.plan.action === "send");
  const changing = toSend.filter(changes);
  const zeroing = rows.filter((row) => row.willZero);
  const skipped = rows.filter((row) => row.plan.action === "skip");
  const canEnable = account.status === "active" && account.allowWrites && !account.stockSyncEnabled;

  return (
    <>
      <PageHeader
        title={`Sincronizar estoque: ${account.nickname}`}
        description="Prévia do que acontece no Mercado Livre ao ligar. Nada foi enviado ainda."
        back={{ href: "/contas", label: "Contas de marketplace" }}
      />

      <dl className="mb-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Summary label="Anúncios vinculados" value={rows.length} />
        <Summary label="Estoque vai mudar" value={changing.length} />
        <Summary label="Vão zerar (pausam)" value={zeroing.length} attention={zeroing.length > 0} />
        <Summary label="Ignorados" value={skipped.length} />
      </dl>

      {zeroing.length > 0 ? (
        <p className="mb-5 rounded-lg border-l-4 border-signal bg-signal-soft px-3 py-2 text-sm text-signal-ink">
          {zeroing.length === 1 ? "1 anúncio ativo vai" : `${zeroing.length} anúncios ativos vão`}{" "}
          ficar com estoque 0 e o Mercado Livre pausa anúncios zerados. Se o estoque do ERP estiver
          errado, ajuste em Estoque antes de ligar.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="mb-5 rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-muted">
          Nenhum anúncio desta conta está vinculado a um SKU. Vincule em{" "}
          <Link href="/mapeamento" className="text-brand hover:underline">
            Mapeamento
          </Link>{" "}
          primeiro.
        </p>
      ) : (
        <div className="mb-5 overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Anúncio</th>
                <th className="px-4 py-3 font-medium">SKU</th>
                <th className="px-4 py-3 text-right font-medium">No ML hoje</th>
                <th className="px-4 py-3 text-right font-medium">Vai ficar</th>
                <th className="px-4 py-3 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.listingId}:${row.variationKey}`}
                  className={`border-b border-border last:border-0 ${row.willZero ? "bg-signal-soft" : ""}`}
                >
                  <td className="px-4 py-3">
                    <p className="max-w-md truncate text-ink">{row.title}</p>
                    <p className="text-xs text-muted tabular-nums">{row.externalId}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/estoque/${row.skuId}`} className="text-ink hover:text-brand">
                      {row.skuCode}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right text-muted tabular-nums">
                    {row.marketplaceQuantity ?? "—"}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-medium tabular-nums ${
                      row.willZero ? "text-signal-ink" : "text-ink"
                    }`}
                  >
                    {row.plan.action === "send" ? row.plan.quantity : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {row.plan.action === "skip"
                      ? row.plan.reason
                      : row.willZero
                        ? "Vai zerar: o anúncio pausa"
                        : changes(row)
                          ? "Vai mudar"
                          : "Já está igual"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEnable ? (
        <form action={enableStockSyncAction.bind(null, accountId)} className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="inline-flex h-10 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-on-brand hover:bg-brand-hover"
          >
            Ligar e enviar {toSend.length} {toSend.length === 1 ? "anúncio" : "anúncios"}
          </button>
          <Link
            href="/contas"
            className="inline-flex h-10 items-center rounded-lg border border-border bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-2"
          >
            Cancelar
          </Link>
        </form>
      ) : (
        <p className="text-sm text-muted">
          {account.stockSyncEnabled
            ? "A sincronização já está ligada nesta conta."
            : "Para ligar, a conta precisa estar conectada e com alterações liberadas."}
        </p>
      )}
    </>
  );
}

function Summary({
  label,
  value,
  attention = false,
}: {
  label: string;
  value: number;
  attention?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        attention
          ? "border-signal bg-signal-soft text-signal-ink"
          : "border-border bg-surface text-ink"
      }`}
    >
      <dt className={attention ? "" : "text-muted"}>{label}</dt>
      <dd className="font-display text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
