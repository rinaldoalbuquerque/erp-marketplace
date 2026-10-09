"use client";

import { Printer } from "lucide-react";
import { useState } from "react";

export const LABELS_FORM_ID = "labels-form";

function boxes() {
  return [
    ...document.querySelectorAll<HTMLInputElement>(
      `input[form="${LABELS_FORM_ID}"][name="orderIds"]`,
    ),
  ];
}

/**
 * Label printing for the order checkboxes of the table (they point to this form
 * with the `form` attribute). Asks for confirmation first: after the label is
 * printed, the invoice (NF) can no longer be changed.
 */
export function PrintLabelsBar({ back }: { back: string }) {
  const [confirming, setConfirming] = useState(false);
  const [count, setCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const ask = () => {
    const selected = boxes().filter((box) => box.checked).length;
    if (selected === 0) {
      setMessage("Marque os pedidos que quer imprimir.");
      return;
    }
    setMessage(null);
    setCount(selected);
    setConfirming(true);
  };

  const selectAll = (checked: boolean) => {
    boxes().forEach((box) => {
      if (!box.disabled) box.checked = checked;
    });
  };

  return (
    <form
      id={LABELS_FORM_ID}
      method="post"
      action="/pedidos/etiquetas"
      onSubmit={() => setConfirming(false)}
      className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
    >
      <input type="hidden" name="back" value={back} />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2 text-ink">
          <input
            type="checkbox"
            onChange={(event) => selectAll(event.target.checked)}
            className="size-4 accent-brand"
          />
          Marcar todos desta página
        </label>
        <label className="flex items-center gap-2 text-muted">
          Formato
          <select
            name="format"
            defaultValue="pdf"
            className="h-9 rounded-lg border border-border bg-surface px-2 text-ink"
          >
            <option value="pdf">PDF (impressora comum)</option>
            <option value="zpl">Zebra (ZPL)</option>
          </select>
        </label>
        <button
          type="button"
          onClick={ask}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-4 font-semibold text-on-brand hover:bg-brand-hover"
        >
          <Printer className="size-4" aria-hidden="true" />
          Imprimir etiquetas
        </button>
        {message ? <span className="text-signal-ink">{message}</span> : null}
      </div>

      {confirming ? (
        <div
          role="alertdialog"
          aria-label="Confirmar impressão"
          className="flex flex-col gap-3 rounded-lg border-l-4 border-signal bg-signal-soft p-3 text-sm text-signal-ink sm:flex-row sm:items-center sm:justify-between"
        >
          <p>
            <strong>Atenção:</strong> depois de impressa a etiqueta, a nota fiscal desses pedidos
            não pode mais ser alterada. Imprimir {count} {count === 1 ? "pedido" : "pedidos"}?
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="submit"
              className="h-9 rounded-lg bg-brand px-3 font-semibold text-on-brand hover:bg-brand-hover"
            >
              Confirmo, imprimir
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="h-9 rounded-lg border border-border bg-surface px-3 font-medium text-ink hover:bg-surface-2"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
