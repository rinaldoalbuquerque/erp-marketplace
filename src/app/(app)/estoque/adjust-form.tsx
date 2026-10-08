"use client";

import { useActionState, useState } from "react";

import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { initialFormState } from "@/lib/auth/form-state";

import { adjustStockAction } from "./actions";

const TYPES = [
  {
    value: "manual_in",
    label: "Entrada",
    hint: "Soma ao saldo (compra, produção, devolução ao estoque).",
  },
  { value: "manual_out", label: "Saída", hint: "Tira do saldo (perda, avaria, uso interno)." },
  {
    value: "count",
    label: "Contagem",
    hint: "Informe quantas unidades você contou: o saldo passa a ser esse.",
  },
] as const;

/** Stock adjustment form shown on the SKU stock page. */
export function AdjustStockForm({ skuId, unit }: { skuId: string; unit: string }) {
  const [state, formAction] = useActionState(adjustStockAction, initialFormState);
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("manual_in");
  const errors = state.fieldErrors ?? {};
  const current = TYPES.find((option) => option.value === type) ?? TYPES[0];

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5"
      noValidate
    >
      <h2 className="text-xl font-semibold text-ink">Ajustar estoque</h2>
      <FormMessage state={state} />
      <input type="hidden" name="skuId" value={skuId} />

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink">Tipo</legend>
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface-2 p-1">
          {TYPES.map((option) => (
            <label
              key={option.value}
              className={`cursor-pointer rounded-md px-2 py-1.5 text-center text-sm font-medium transition-colors has-focus-visible:outline-2 has-focus-visible:outline-ring ${
                type === option.value
                  ? "bg-surface text-brand shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
            >
              <input
                type="radio"
                name="type"
                value={option.value}
                checked={type === option.value}
                onChange={() => setType(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-sm text-muted">{current.hint}</p>
      </fieldset>

      <Field
        label={type === "count" ? `Quantidade contada (${unit})` : `Quantidade (${unit})`}
        name="quantity"
        inputMode="numeric"
        required
        defaultValue={state.status === "error" ? state.values?.quantity : ""}
        error={errors.quantity}
      />
      <Field
        label="Motivo (opcional)"
        name="reason"
        maxLength={200}
        placeholder={type === "count" ? "Ex.: Inventário mensal" : "Ex.: Compra do fornecedor X"}
        defaultValue={state.status === "error" ? state.values?.reason : ""}
        error={errors.reason}
      />
      <SubmitButton pendingText="Salvando…">Registrar ajuste</SubmitButton>
    </form>
  );
}
