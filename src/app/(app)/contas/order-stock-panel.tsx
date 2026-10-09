import { setOrderStockAction } from "./order-stock-actions";

const DATE_TIME = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

/** "Vendas baixam o estoque do ERP" part of an account card (Contas). */
export function OrderStockPanel({
  accountId,
  enabled,
  since,
}: {
  accountId: string;
  enabled: boolean;
  since: Date | null;
}) {
  return (
    <form
      action={setOrderStockAction.bind(null, accountId, !enabled)}
      className="flex flex-col gap-2 rounded-lg border border-border bg-bg p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="text-sm">
        <p className="font-medium text-ink">
          Vendas baixam o estoque do ERP: {enabled ? "ligado" : "desligado"}
        </p>
        <p className="text-muted">
          {enabled && since
            ? `Vendas confirmadas desde ${DATE_TIME.format(since)} baixam o estoque do SKU vinculado (Full não baixa). Cancelamentos devolvem.`
            : "Ao ligar, só as vendas confirmadas a partir de agora baixam estoque. Confira o saldo em Estoque antes."}
        </p>
      </div>
      <button
        type="submit"
        className="inline-flex h-9 shrink-0 items-center rounded-lg border border-border bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-2"
      >
        {enabled ? "Desligar" : "Ligar baixa por vendas"}
      </button>
    </form>
  );
}
