"use client";

import { Download, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  continueImportAction,
  getImportProgressAction,
  startImportAction,
  type ImportProgress,
} from "./import-actions";

const POLL_MS = 2000;

/** "Importar anúncios" button with live progress and the final report. */
export function ImportPanel({
  accountId,
  initial,
}: {
  accountId: string;
  initial: ImportProgress | null;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<ImportProgress | null>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const continuedFor = useRef<number>(-1);

  const active = progress !== null && ["queued", "running", "paused"].includes(progress.status);

  // Poll while a job is open; resume automatically after a time-budget pause.
  useEffect(() => {
    if (!progress || !active) return;
    const jobId = progress.jobId;
    const timer = setInterval(async () => {
      const next = await getImportProgressAction(jobId);
      if (!next) return;
      setProgress(next);
      if (next.status === "paused" && !next.lastError && continuedFor.current !== next.processed) {
        continuedFor.current = next.processed;
        await continueImportAction(jobId);
      }
      if (next.status === "completed") router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [progress, active, router]);

  function start() {
    setMessage(null);
    startTransition(async () => {
      const result = await startImportAction(accountId);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setProgress(await getImportProgressAction(result.jobId));
    });
  }

  function resume() {
    if (!progress) return;
    startTransition(async () => {
      await continueImportAction(progress.jobId);
      setProgress({ ...progress, status: "queued", lastError: null });
    });
  }

  const percent =
    progress?.total && progress.total > 0
      ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
      : null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-bg p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">Anúncios</p>
        {!active ? (
          <button
            type="button"
            onClick={start}
            disabled={pending}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-3 text-sm font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
          >
            <Download className="size-4" aria-hidden="true" />
            {progress?.status === "completed" ? "Importar de novo" : "Importar anúncios"}
          </button>
        ) : progress?.status === "paused" && progress.lastError ? (
          <button
            type="button"
            onClick={resume}
            disabled={pending}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-3 text-sm font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
          >
            <Play className="size-4" aria-hidden="true" />
            Continuar
          </button>
        ) : null}
      </div>

      {message ? <p className="text-sm text-danger">{message}</p> : null}

      {progress && active ? (
        <div aria-live="polite" className="flex flex-col gap-1.5">
          <div
            className="h-2 overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
            aria-label="Progresso da importação"
          >
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-500 motion-reduce:transition-none"
              style={{ width: `${percent ?? 5}%` }}
            />
          </div>
          <p className="text-sm text-muted tabular-nums">
            {progress.total === null
              ? "Buscando a lista de anúncios no Mercado Livre…"
              : `${progress.processed} de ${progress.total} anúncios`}
            {progress.status === "paused" && progress.lastError ? "" : "…"}
          </p>
          {progress.lastError ? (
            <p className="text-sm text-signal-ink">{progress.lastError}</p>
          ) : null}
        </div>
      ) : null}

      {progress && !active ? (
        <div className="text-sm">
          {progress.status === "completed" ? (
            <p className="text-ink">
              Última importação: <strong>{progress.createdCount}</strong> novos,{" "}
              <strong>{progress.updatedCount}</strong> atualizados
              {progress.failedCount ? (
                <>
                  , <strong className="text-signal-ink">{progress.failedCount} com erro</strong>
                </>
              ) : null}
              .
            </p>
          ) : (
            <p className="text-signal-ink">{progress.lastError ?? "A importação não terminou."}</p>
          )}
          {progress.errors.length ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-muted">Ver anúncios com erro</summary>
              <ul className="mt-2 flex flex-col gap-1 text-muted">
                {progress.errors.map((error) => (
                  <li key={error.id} className="tabular-nums">
                    {error.id}: {error.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
