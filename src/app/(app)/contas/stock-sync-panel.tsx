import Link from "next/link";

import type { PushCounts } from "@/server/stock-sync/queries";

import {
  disableStockSyncAction,
  retryFailedStockAction,
  sendAllStockAction,
} from "./stock-sync-actions";

const SMALL_BUTTON =
  "inline-flex h-9 shrink-0 items-center rounded-lg border border-border bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-2";

/** "Estoque no Mercado Livre" part of an account card (Contas). */
export function StockSyncPanel({
  accountId,
  allowWrites,
  enabled,
  multiWarehouse,
  counts,
}: {
  accountId: string;
  allowWrites: boolean;
  enabled: boolean;
  multiWarehouse: boolean;
  counts: PushCounts | null;
}) {
  if (!enabled) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <p className="font-medium text-ink">Estoque do ERP no Mercado Livre: desligado</p>
          <p className="text-muted">
            {allowWrites
              ? "Ao ligar, os anúncios vinculados passam a mostrar o estoque do ERP. Você vê uma prévia antes."
              : "Libere as alterações pelo ERP para poder ligar."}
          </p>
          {multiWarehouse ? (
            <p className="mt-1 text-signal-ink">
              Esta conta usa multi origem: o envio de estoque ainda não é suportado.
            </p>
          ) : null}
        </div>
        {allowWrites ? (
          <Link href={`/contas/${accountId}/sincronizar-estoque`} className={SMALL_BUTTON}>
            Ver prévia e ligar
          </Link>
        ) : null}
      </div>
    );
  }

  const c = counts ?? { pending: 0, sent: 0, skipped: 0, failed: 0 };
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-bg p-4">
      <div className="text-sm">
        <p className="font-medium text-ink">Estoque do ERP no Mercado Livre: ligado</p>
        <p className="text-muted">
          Cada ajuste de estoque é enviado aos anúncios vinculados desta conta.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Count label="Enviados" value={c.sent} />
        <Count label="Na fila" value={c.pending} />
        <Count label="Ignorados" value={c.skipped} hint="Full, variações, sem vínculo" />
        <Count label="Com erro" value={c.failed} attention={c.failed > 0} />
      </dl>
      <div className="flex flex-wrap gap-2">
        <form action={sendAllStockAction.bind(null, accountId)}>
          <button type="submit" className={SMALL_BUTTON}>
            Enviar todos agora
          </button>
        </form>
        {c.failed > 0 ? (
          <form action={retryFailedStockAction.bind(null, accountId)}>
            <button type="submit" className={SMALL_BUTTON}>
              Reenviar os com erro
            </button>
          </form>
        ) : null}
        <form action={disableStockSyncAction.bind(null, accountId)}>
          <button type="submit" className={SMALL_BUTTON}>
            Desligar
          </button>
        </form>
      </div>
    </div>
  );
}

function Count({
  label,
  value,
  hint,
  attention = false,
}: {
  label: string;
  value: number;
  hint?: string;
  attention?: boolean;
}) {
  return (
    <div
      className={`rounded-lg px-3 py-2 ${attention ? "bg-signal-soft text-signal-ink" : "bg-surface text-ink"}`}
      title={hint}
    >
      <dt className={attention ? "" : "text-muted"}>{label}</dt>
      <dd className="font-display text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
