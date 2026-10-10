"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { BatchProgressPanel } from "./batch-progress";
import { deleteOnMarketplaceAction, removeFromSystemAction } from "./delete-actions";

type Mode = "system" | "marketplace";

const count = (n: number) => (n === 1 ? "1 anúncio" : `${n} anúncios`);

/** Asks where to delete the checked listings: only in the ERP, or on the marketplace too. */
export function DeletePanel({ selectedIds }: { selectedIds: () => string[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    const ids = selectedIds();
    if (ids.length === 0) {
      setMessage({ tone: "error", text: "Marque os anúncios que quer excluir." });
      return;
    }
    if (mode === "system") {
      const ok = window.confirm(
        `Excluir ${count(ids.length)} só do sistema?\n\nEles continuam no Mercado Livre como estão, mas somem do ERP e o ERP para de mandar estoque para eles.`,
      );
      if (!ok) return;
      startTransition(async () => {
        const result = await removeFromSystemAction(ids);
        if (!result.ok) {
          setMessage({ tone: "error", text: result.message });
          return;
        }
        setMessage({ tone: "success", text: `${count(result.count)} removido(s) do sistema.` });
        setMode(null);
        router.refresh();
      });
      return;
    }
    if (mode !== "marketplace" || !understood) return;
    const ok = window.confirm(
      `EXCLUIR ${count(ids.length)} NO MERCADO LIVRE?\n\nO anúncio é finalizado e excluído lá, e sai do ERP. Isso NÃO pode ser desfeito: o histórico de vendas e as avaliações do anúncio se perdem.`,
    );
    if (!ok) return;
    startTransition(async () => {
      const result = await deleteOnMarketplaceAction(ids);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.message });
        return;
      }
      setJobIds((current) => [...result.jobIds, ...current]);
      setMessage(
        result.blocked
          ? {
              tone: "error",
              text: `${count(result.blocked)} não ${result.blocked === 1 ? "entrou" : "entraram"} no lote: conta com alterações bloqueadas (libere em Contas).`,
            }
          : null,
      );
      setMode(null);
      setUnderstood(false);
    });
  }

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
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-bg p-3">
      {jobIds.map((jobId) => (
        <BatchProgressPanel
          key={jobId}
          jobId={jobId}
          onClose={() => {
            setJobIds((current) => current.filter((id) => id !== jobId));
            router.refresh();
          }}
        />
      ))}
      <p className="font-medium text-ink">Onde excluir os anúncios marcados?</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        {option(
          "system",
          "Só do sistema",
          "Continuam no Mercado Livre como estão. Somem do ERP, perdem o vínculo com o SKU (o ERP para de mandar estoque) e não voltam na próxima importação.",
        )}
        {option(
          "marketplace",
          "Também no Mercado Livre",
          "Finaliza e exclui no Mercado Livre e tira do ERP. Roda em segundo plano, com relatório. Só em contas com alterações liberadas.",
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
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={confirm}
          disabled={pending || mode === null || (mode === "marketplace" && !understood)}
          className="h-9 rounded-lg bg-danger px-3 font-semibold text-on-brand disabled:opacity-50"
        >
          {pending ? "Excluindo…" : "Excluir"}
        </button>
        {message ? (
          <span className={message.tone === "error" ? "text-danger" : "text-success"}>
            {message.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
