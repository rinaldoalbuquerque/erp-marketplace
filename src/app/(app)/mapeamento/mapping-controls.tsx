"use client";

import { Link2, Undo2, Wand2 } from "lucide-react";
import { useActionState, useState, useTransition } from "react";

import type { AutoMatchItem } from "@/server/listings/mapping-service";

import { autoMatchAction, linkSkuAction, undoAutoMatchAction, type LinkFormState } from "./actions";

const SKU_DATALIST_ID = "erp-sku-codes";

/** One shared list of ERP SKU codes for the "link" inputs (browser autocomplete). */
export function SkuCodeList({ codes }: { codes: string[] }) {
  return (
    <datalist id={SKU_DATALIST_ID}>
      {codes.map((code) => (
        <option key={code} value={code} />
      ))}
    </datalist>
  );
}

/** Small inline form: type an ERP SKU code and link it to a listing/variation. */
export function LinkSkuForm({
  listingId,
  variationId,
  suggestion,
}: {
  listingId: string;
  variationId: string | null;
  suggestion: string | null;
}) {
  const [state, formAction, pending] = useActionState<LinkFormState, FormData>(linkSkuAction, {
    status: "idle",
  });
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="listingId" value={listingId} />
      <input type="hidden" name="variationId" value={variationId ?? ""} />
      <div className="flex gap-2">
        <input
          name="skuCode"
          list={SKU_DATALIST_ID}
          defaultValue={suggestion ?? ""}
          placeholder="Código do SKU"
          aria-label="Código do SKU do ERP"
          autoCapitalize="characters"
          className="h-9 w-40 rounded-lg border border-border bg-surface px-2 text-sm text-ink outline-none focus:border-brand focus:ring-3 focus:ring-brand/20"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
        >
          <Link2 className="size-4" aria-hidden="true" />
          Vincular
        </button>
      </div>
      {state.message ? (
        <p className={`text-xs ${state.status === "error" ? "text-danger" : "text-success"}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

/** "Vincular automaticamente" with the list of what was linked and an undo. */
export function AutoMatchButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AutoMatchItem[] | null>(null);
  const [undone, setUndone] = useState<number | null>(null);

  function run() {
    setUndone(null);
    startTransition(async () => setResult(await autoMatchAction()));
  }

  function undo() {
    if (!result) return;
    const ids = result.map((item) => item.mappingId);
    startTransition(async () => {
      setUndone(await undoAutoMatchAction(ids));
      setResult(null);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
        >
          <Wand2 className="size-4" aria-hidden="true" />
          {pending ? "Vinculando…" : "Vincular automaticamente"}
        </button>
        <p className="mt-1 text-xs text-muted">
          Liga anúncios cujo SKU no Mercado Livre é igual ao código de um SKU do ERP. Não mexe em
          vínculos existentes.
        </p>
      </div>

      {undone !== null ? (
        <p role="status" className="text-sm text-success">
          {undone} {undone === 1 ? "vínculo desfeito" : "vínculos desfeitos"}.
        </p>
      ) : null}

      {result !== null ? (
        <div
          role="status"
          className="rounded-lg border-l-4 border-success bg-success-soft px-3 py-2 text-sm text-success"
        >
          {result.length === 0 ? (
            <p>Nenhum anúncio novo com SKU igual a um código do ERP.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p>
                  <strong>{result.length}</strong>{" "}
                  {result.length === 1 ? "anúncio vinculado" : "anúncios vinculados"}.
                </p>
                <button
                  type="button"
                  onClick={undo}
                  disabled={pending}
                  className="inline-flex items-center gap-1 text-sm font-medium underline"
                >
                  <Undo2 className="size-4" aria-hidden="true" />
                  Desfazer
                </button>
              </div>
              <details className="mt-1">
                <summary className="cursor-pointer">Ver o que foi vinculado</summary>
                <ul className="mt-1 flex max-h-64 flex-col gap-0.5 overflow-y-auto text-ink">
                  {result.map((item) => (
                    <li key={item.mappingId}>
                      <span className="tabular-nums">{item.externalId}</span> → {item.skuCode}:{" "}
                      {item.listingTitle}
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
