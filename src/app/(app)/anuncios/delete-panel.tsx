"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { removeFromSystemAction } from "./delete-actions";

type Mode = "system" | "marketplace";

/** Asks where to delete the checked listings: only in the ERP, or on the marketplace too. */
export function DeletePanel({ selectedIds }: { selectedIds: () => string[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    const ids = selectedIds();
    if (ids.length === 0) {
      setMessage({ tone: "error", text: "Marque os anúncios que quer excluir." });
      return;
    }
    if (mode !== "system") return;
    const ok = window.confirm(
      `Excluir ${ids.length === 1 ? "1 anúncio" : `${ids.length} anúncios`} só do sistema?\n\nEles continuam no Mercado Livre como estão, mas somem do ERP e o ERP para de mandar estoque para eles.`,
    );
    if (!ok) return;
    startTransition(async () => {
      const result = await removeFromSystemAction(ids);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.message });
        return;
      }
      setMessage({
        tone: "success",
        text: `${result.count === 1 ? "1 anúncio removido" : `${result.count} anúncios removidos`} do sistema.`,
      });
      setMode(null);
      router.refresh();
    });
  }

  const option = (value: Mode, title: string, text: string, disabled = false) => (
    <label
      className={`flex flex-1 cursor-pointer gap-2 rounded-lg border p-3 ${
        mode === value ? "border-brand bg-surface" : "border-border bg-surface"
      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <input
        type="radio"
        name="delete-mode"
        checked={mode === value}
        disabled={disabled}
        onChange={() => setMode(value)}
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
          "Em breve: finaliza e exclui no Mercado Livre (não pode ser desfeito).",
          true,
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={confirm}
          disabled={pending || mode === null}
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
