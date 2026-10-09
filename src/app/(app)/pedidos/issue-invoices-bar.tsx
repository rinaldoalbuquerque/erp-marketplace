"use client";

import { FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { IssueOutcome, ReadinessRow } from "@/server/fiscal/invoice-service";

import { checkInvoicesAction, issueInvoicesAction } from "./invoice-actions";

export const INVOICE_FORM_ID = "invoice-form";

function selectedIds() {
  return [
    ...document.querySelectorAll<HTMLInputElement>(
      `input[form="${INVOICE_FORM_ID}"][name="orderIds"]:checked`,
    ),
  ].map((box) => box.value);
}

const OUTCOME_TEXT: Record<IssueOutcome["status"], string> = {
  issued: "NF emitida",
  already_had: "Já tinha NF (nada foi emitido de novo)",
  refused: "Recusada",
  skipped: "Não emitida",
  unknown: "Sem confirmação",
};

/**
 * "Emitir NF" for the checked orders: 1) checks (read only) whether the listings
 * have fiscal data, 2) asks for confirmation (an NF-e has fiscal effect and can't
 * be deleted), 3) issues and shows the result of each cart.
 */
export function IssueInvoicesBar() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [check, setCheck] = useState<ReadinessRow[] | null>(null);
  const [outcomes, setOutcomes] = useState<IssueOutcome[] | null>(null);

  const ready = check?.filter((row) => row.ready) ?? [];
  const blocked = check?.filter((row) => !row.ready) ?? [];

  const start = () => {
    const ids = selectedIds();
    setOutcomes(null);
    setCheck(null);
    if (ids.length === 0) {
      setMessage("Marque os pedidos que quer faturar.");
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await checkInvoicesAction(ids);
      if (!result.ok) setMessage(result.message);
      else setCheck(result.rows);
    });
  };

  const issue = () => {
    const ids = ready.map((row) => row.orderId);
    startTransition(async () => {
      const result = await issueInvoicesAction(ids);
      setCheck(null);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setOutcomes(result.outcomes);
      router.refresh();
    });
  };

  const selectAll = (checked: boolean) => {
    document
      .querySelectorAll<HTMLInputElement>(`input[form="${INVOICE_FORM_ID}"][name="orderIds"]`)
      .forEach((box) => {
        if (!box.disabled) box.checked = checked;
      });
  };

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 text-sm">
      {/* The checkboxes in the table belong to this (never submitted) form. */}
      <form id={INVOICE_FORM_ID} className="hidden" onSubmit={(event) => event.preventDefault()} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-ink">
          <input
            type="checkbox"
            onChange={(event) => selectAll(event.target.checked)}
            className="size-4 accent-brand"
          />
          Marcar todos desta página
        </label>
        <button
          type="button"
          onClick={start}
          disabled={pending}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-4 font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
        >
          <FileText className="size-4" aria-hidden="true" />
          {pending && !check ? "Conferindo…" : "Emitir NF"}
        </button>
        <span className="text-muted">
          Emitida pelo Faturador do Mercado Livre, uma por carrinho.
        </span>
        {message ? <span className="text-signal-ink">{message}</span> : null}
      </div>

      {check ? (
        <div
          role="alertdialog"
          aria-label="Confirmar emissão"
          className="flex flex-col gap-3 rounded-lg border-l-4 border-signal bg-signal-soft p-3 text-signal-ink"
        >
          {blocked.length > 0 ? (
            <div>
              <p className="font-medium">
                {blocked.length === 1
                  ? "1 pedido não pode ser faturado"
                  : `${blocked.length} pedidos não podem ser faturados`}{" "}
                (falta dado fiscal no anúncio, no Mercado Livre):
              </p>
              <ul className="mt-1 list-disc pl-5">
                {blocked.map((row) => (
                  <li key={row.orderId}>
                    #{row.externalId}: {row.problems.join(" · ")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {ready.length > 0 ? (
            <>
              <p>
                <strong>Atenção:</strong> a NF-e tem efeito fiscal e não pode ser apagada (só
                cancelada, dentro do prazo). Emitir NF de{" "}
                {ready.length === 1 ? "1 pedido" : `${ready.length} pedidos`}? Pedidos do mesmo
                carrinho saem numa nota só.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={issue}
                  disabled={pending}
                  className="h-9 rounded-lg bg-brand px-3 font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
                >
                  {pending ? "Emitindo…" : "Confirmo, emitir"}
                </button>
                <button
                  type="button"
                  onClick={() => setCheck(null)}
                  disabled={pending}
                  className="h-9 rounded-lg border border-border bg-surface px-3 font-medium text-ink hover:bg-surface-2"
                >
                  Cancelar
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setCheck(null)}
              className="h-9 self-start rounded-lg border border-border bg-surface px-3 font-medium text-ink hover:bg-surface-2"
            >
              Fechar
            </button>
          )}
        </div>
      ) : null}

      {outcomes ? (
        <div role="status" className="rounded-lg border border-border bg-bg p-3">
          <p className="mb-1 font-medium text-ink">Resultado</p>
          <ul className="flex flex-col gap-1">
            {outcomes.map((outcome) => (
              <li
                key={outcome.packKey}
                className={
                  outcome.status === "issued" || outcome.status === "already_had"
                    ? "text-success"
                    : "text-signal-ink"
                }
              >
                Carrinho/pedido {outcome.packKey}: {OUTCOME_TEXT[outcome.status]}
                {"number" in outcome && outcome.number ? ` (NF ${outcome.number})` : ""}
                {"reason" in outcome ? ` — ${outcome.reason}` : ""}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            A etiqueta é liberada pelo Mercado Livre logo depois; o pedido muda para “Para imprimir”
            em instantes.
          </p>
        </div>
      ) : null}
    </div>
  );
}
