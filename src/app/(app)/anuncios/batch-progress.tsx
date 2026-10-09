"use client";

import { Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import type { BatchProgress } from "@/server/listings/batch-service";

import { continueBatchAction, getBatchProgressAction } from "./copy-actions";

const POLL_MS = 2000;

const TITLES = {
  replicate_listings: "Cópia em lote",
  publish_drafts: "Publicação em lote",
} as const;

/** Live progress and final report of a replicate/publish batch. */
export function BatchProgressPanel({ jobId, onClose }: { jobId: string; onClose?: () => void }) {
  const router = useRouter();
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [pending, startTransition] = useTransition();
  const continuedFor = useRef(-1);

  const active = progress === null || ["queued", "running", "paused"].includes(progress.status);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const tick = async () => {
      const next = await getBatchProgressAction(jobId);
      if (stopped || !next) return;
      setProgress(next);
      // Resume automatically after a time-budget pause (not after an error).
      if (next.status === "paused" && !next.lastError && continuedFor.current !== next.processed) {
        continuedFor.current = next.processed;
        await continueBatchAction(jobId);
      }
      if (next.status === "completed" || next.status === "failed") router.refresh();
    };
    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [jobId, active, router]);

  function resume() {
    startTransition(async () => {
      await continueBatchAction(jobId);
      if (progress) setProgress({ ...progress, status: "queued", lastError: null });
    });
  }

  if (!progress) {
    return (
      <p className="mb-4 rounded-xl border border-border bg-surface p-4 text-sm text-muted">
        Iniciando o lote…
      </p>
    );
  }
  const percent =
    progress.total && progress.total > 0
      ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
      : 5;
  const isCopy = progress.type === "replicate_listings";

  return (
    <section
      aria-live="polite"
      className="mb-4 flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-ink">
          {TITLES[progress.type]} · conta {progress.accountNickname}
        </p>
        {!active && onClose ? (
          <button type="button" onClick={onClose} className="text-xs text-muted hover:text-ink">
            Fechar
          </button>
        ) : null}
      </div>
      {active ? (
        <div
          className="h-2 overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="Progresso do lote"
        >
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}
      <p className="text-muted tabular-nums">
        {progress.processed} de {progress.total ?? "?"} ·{" "}
        <span className="text-success">
          {progress.done} {isCopy ? "copiados" : "publicados"}
        </span>
        {progress.skipped ? ` · ${progress.skipped} já feitos antes` : ""}
        {progress.failed ? (
          <span className="text-signal-ink"> · {progress.failed} com problema</span>
        ) : null}
        {progress.status === "completed" ? " · concluído" : ""}
      </p>
      {progress.lastError ? (
        <div className="flex flex-wrap items-center gap-2 text-signal-ink">
          <span>{progress.lastError}</span>
          {progress.status === "paused" ? (
            <button
              type="button"
              onClick={resume}
              disabled={pending}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-2 text-xs font-medium text-ink hover:bg-surface-2"
            >
              <Play className="size-3" aria-hidden="true" />
              Continuar
            </button>
          ) : null}
        </div>
      ) : null}
      {progress.errors.length ? (
        <details>
          <summary className="cursor-pointer text-signal-ink">Ver problemas</summary>
          <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted">
            {progress.errors.map((error) => (
              <li key={error.id}>
                <span className="tabular-nums">{error.id}</span>: {error.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {isCopy && progress.status === "completed" && progress.done > 0 ? (
        <Link
          href={`/anuncios/rascunhos?lote=${progress.jobId}`}
          className="font-medium text-brand hover:underline"
        >
          Revisar os rascunhos criados →
        </Link>
      ) : null}
    </section>
  );
}
