"use client";

import { Rocket } from "lucide-react";
import { useState, useTransition } from "react";

import { BatchProgressPanel } from "../batch-progress";
import { startPublishAction } from "../copy-actions";

export const PUBLISH_FORM_ID = "publish-form";

/** Publishes the checked drafts in a background batch (each draft once). */
export function PublishBar() {
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string[] | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const boxes = () => [
    ...document.querySelectorAll<HTMLInputElement>(
      `input[form="${PUBLISH_FORM_ID}"][name="draftId"]`,
    ),
  ];

  function ask() {
    const ids = boxes()
      .filter((box) => box.checked)
      .map((box) => box.value);
    if (ids.length === 0) {
      setMessage("Marque os rascunhos que quer publicar.");
      return;
    }
    setMessage(null);
    setConfirming(ids);
  }

  function publish() {
    if (!confirming) return;
    startTransition(async () => {
      const result = await startPublishAction(confirming);
      setConfirming(null);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setJobId(result.jobId);
    });
  }

  return (
    <>
      {jobId ? <BatchProgressPanel jobId={jobId} onClose={() => setJobId(null)} /> : null}
      <form
        id={PUBLISH_FORM_ID}
        onSubmit={(event) => event.preventDefault()}
        className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 text-sm"
      >
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-ink">
            <input
              type="checkbox"
              onChange={(event) =>
                boxes().forEach((box) => {
                  box.checked = event.target.checked;
                })
              }
              className="size-4 accent-brand"
            />
            Marcar todos
          </label>
          <button
            type="button"
            onClick={ask}
            disabled={pending}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-3 font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
          >
            <Rocket className="size-4" aria-hidden="true" />
            Publicar selecionados
          </button>
          {message ? <span className="text-signal-ink">{message}</span> : null}
        </div>
        {confirming ? (
          <div
            role="alertdialog"
            aria-label="Confirmar publicação"
            className="flex flex-col gap-2 rounded-lg border-l-4 border-signal bg-signal-soft p-3 text-signal-ink sm:flex-row sm:items-center sm:justify-between"
          >
            <p>
              Publicar {confirming.length === 1 ? "1 rascunho" : `${confirming.length} rascunhos`}{" "}
              no Mercado Livre? Eles ficam visíveis para compradores assim que o Mercado Livre
              aprovar. Os recusados aparecem no relatório com o motivo.
            </p>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={publish}
                disabled={pending}
                className="h-9 rounded-lg bg-brand px-3 font-semibold text-on-brand hover:bg-brand-hover"
              >
                Confirmo, publicar
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="h-9 rounded-lg border border-border bg-surface px-3 font-medium text-ink hover:bg-surface-2"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : null}
      </form>
    </>
  );
}
