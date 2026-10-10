"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import type { BatchProgress } from "@/server/listings/batch-service";

import { continueBatchAction, getBatchProgressAction } from "./copy-actions";
import { deleteOnMarketplaceAction, removeFromSystemAction } from "./delete-actions";

type Mode = "system" | "marketplace";

const POLL_MS = 2_000;
const count = (n: number) => (n === 1 ? "1 anúncio" : `${n} anúncios`);
const FINISHED = ["completed", "failed"];

/**
 * Dialog asking where to delete the checked listings (only in the ERP, or on the
 * marketplace too). Closes by itself and refreshes the list when everything worked;
 * stays open only to show what the marketplace refused.
 */
export function DeleteDialog({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [progress, setProgress] = useState<Record<string, BatchProgress>>({});
  const [problems, setProblems] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const continued = useRef<Record<string, number>>({});
  // Listings left out before the batch started (locked accounts).
  const leftOut = useRef<string[]>([]);
  const running = jobIds.length > 0;

  function finish(found: string[]) {
    const notes = [...leftOut.current, ...found];
    router.refresh();
    if (notes.length) setProblems(notes);
    else onClose();
  }

  // Marketplace batch: follow the progress, then close (or show the refusals).
  useEffect(() => {
    if (!running) return;
    let stopped = false;
    const tick = async () => {
      const results = await Promise.all(jobIds.map((jobId) => getBatchProgressAction(jobId)));
      if (stopped) return;
      const next: Record<string, BatchProgress> = {};
      for (const result of results) if (result) next[result.jobId] = result;
      setProgress(next);
      for (const job of Object.values(next)) {
        if (
          job.status === "paused" &&
          !job.lastError &&
          continued.current[job.jobId] !== job.processed
        ) {
          continued.current[job.jobId] = job.processed;
          await continueBatchAction(job.jobId);
        }
      }
      const jobs = Object.values(next);
      const stuck = jobs.filter((job) => job.status === "paused" && job.lastError);
      if (
        jobs.length === jobIds.length &&
        jobs.every((job) => FINISHED.includes(job.status) || stuck.includes(job))
      ) {
        stopped = true;
        setJobIds([]);
        finish([
          ...jobs.flatMap((job) => job.errors.map((error) => `${error.id}: ${error.message}`)),
          ...jobs.flatMap((job) => (job.lastError ? [job.lastError] : [])),
        ]);
      }
    };
    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per started batch
  }, [running]);

  function confirm() {
    if (mode === "system") {
      startTransition(async () => {
        const result = await removeFromSystemAction(ids);
        if (!result.ok) setProblems([result.message]);
        else finish([]);
      });
      return;
    }
    if (mode !== "marketplace" || !understood) return;
    startTransition(async () => {
      const result = await deleteOnMarketplaceAction(ids);
      if (!result.ok) {
        setProblems([result.message]);
        return;
      }
      if (result.blocked) {
        leftOut.current = [
          `${count(result.blocked)} não ${result.blocked === 1 ? "foi excluído" : "foram excluídos"}: conta com alterações bloqueadas (libere em Contas).`,
        ];
      }
      setJobIds(result.jobIds);
    });
  }

  const jobs = Object.values(progress);
  const processed = jobs.reduce((sum, job) => sum + job.processed, 0);
  const total = jobs.reduce((sum, job) => sum + (job.total ?? 0), 0);
  const busy = pending || running;

  const option = (value: Mode, title: string, text: string) => (
    <label
      className={`flex flex-1 cursor-pointer gap-2 rounded-lg border bg-surface p-3 ${
        mode === value
          ? value === "marketplace"
            ? "border-danger"
            : "border-brand"
          : "border-border"
      }`}
    >
      <input
        type="radio"
        name="delete-mode"
        checked={mode === value}
        disabled={busy}
        onChange={() => {
          setMode(value);
          setUnderstood(false);
        }}
        className="mt-0.5 accent-brand"
      />
      <span>
        <span className="block font-medium text-ink">{title}</span>
        <span className="block text-xs text-muted">{text}</span>
      </span>
    </label>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        className="flex w-full max-w-2xl flex-col gap-4 rounded-xl border border-border bg-bg p-5 text-sm shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="delete-dialog-title" className="font-display text-lg font-semibold text-ink">
            Excluir {count(ids.length)}
          </h2>
          {!busy ? (
            <button
              type="button"
              aria-label="Fechar"
              onClick={onClose}
              className="text-muted hover:text-ink"
            >
              <X className="size-5" />
            </button>
          ) : null}
        </div>

        {problems.length && !busy ? (
          <div className="flex flex-col gap-3">
            <div className="max-h-64 overflow-y-auto rounded-lg border-l-4 border-signal bg-signal-soft p-3 text-signal-ink">
              <p className="font-medium">Alguns anúncios não foram excluídos:</p>
              {problems.map((problem, index) => (
                <p key={`${index}-${problem}`}>• {problem}</p>
              ))}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-9 self-end rounded-lg border border-border bg-surface px-4 font-medium text-ink hover:bg-surface-2"
            >
              Fechar
            </button>
          </div>
        ) : running ? (
          <div className="flex flex-col gap-2">
            <p className="text-ink">
              Excluindo no Mercado Livre… {total ? `${processed} de ${total}` : ""}
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full bg-danger transition-all"
                style={{ width: `${total ? Math.round((processed / total) * 100) : 5}%` }}
              />
            </div>
            <p className="text-xs text-muted">
              A janela fecha sozinha quando terminar. Se fechar a página, o lote continua.
            </p>
          </div>
        ) : (
          <>
            <p className="text-ink">Onde prefere excluir?</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              {option(
                "system",
                "Só do sistema",
                "Continuam no Mercado Livre como estão. Somem do ERP, perdem o vínculo com o SKU (o ERP para de mandar estoque) e não voltam na próxima importação.",
              )}
              {option(
                "marketplace",
                "Também no Mercado Livre",
                "Finaliza e exclui no Mercado Livre e tira do ERP. Só em contas com alterações liberadas.",
              )}
            </div>
            {mode === "marketplace" ? (
              <label className="flex items-start gap-2 rounded-lg border-l-4 border-danger bg-danger-soft p-3 text-danger">
                <input
                  type="checkbox"
                  checked={understood}
                  onChange={(event) => setUnderstood(event.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Entendo que a exclusão no Mercado Livre <strong>não pode ser desfeita</strong>: o
                  anúncio perde o histórico de vendas e as avaliações.
                </span>
              </label>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="h-9 rounded-lg border border-border bg-surface px-4 font-medium text-ink hover:bg-surface-2"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={busy || mode === null || (mode === "marketplace" && !understood)}
                className="h-9 rounded-lg bg-danger px-4 font-semibold text-on-brand disabled:opacity-50"
              >
                {pending ? "Excluindo…" : "Confirmar exclusão"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
