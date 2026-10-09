"use client";

import { useState, useTransition } from "react";

import type { BulkOperation } from "@/domain/listings/bulk-edit";
import { formatCents, parseBrlToCents } from "@/domain/products/money";
import type { PreviewRow } from "@/server/listings/bulk-edit-service";

import { BatchProgressPanel } from "./batch-progress";
import { previewBulkAction, startBulkAction } from "./bulk-actions";

export type BulkFilters = {
  search?: string;
  status?: string;
  accountIds?: string[];
  familyId?: string;
};

type Kind = "price_set" | "price_percent" | "price_amount" | "pause" | "activate";

const KINDS: Array<{ value: Kind; label: string }> = [
  { value: "price_percent", label: "Ajustar preço em %" },
  { value: "price_amount", label: "Somar/subtrair R$ no preço" },
  { value: "price_set", label: "Definir preço" },
  { value: "pause", label: "Pausar" },
  { value: "activate", label: "Reativar" },
];

/** Bulk edit of the checked listings (or of the whole filter): operation -> preview -> batch. */
export function BulkEditPanel({
  filters,
  filterTotal,
  selectedIds,
}: {
  filters: BulkFilters;
  filterTotal: number;
  selectedIds: () => string[];
}) {
  const [kind, setKind] = useState<Kind>("price_percent");
  const [value, setValue] = useState("");
  const [roundTo90, setRoundTo90] = useState(false);
  const [scope, setScope] = useState<"checked" | "filter">("checked");
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    rows: PreviewRow[];
    total: number;
    truncated: boolean;
    selection: unknown;
    operation: BulkOperation;
  } | null>(null);
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  function operation(): BulkOperation | null {
    if (kind === "pause") return { kind: "status", status: "paused" };
    if (kind === "activate") return { kind: "status", status: "active" };
    if (kind === "price_percent") {
      const percent = Number(value.replace(",", "."));
      return Number.isFinite(percent) && value.trim() ? { kind, percent, roundTo90 } : null;
    }
    const negative = value.trim().startsWith("-");
    const cents = parseBrlToCents(value.replace("-", "").trim());
    if (cents === null) return null;
    return kind === "price_set"
      ? { kind, cents, roundTo90 }
      : { kind, cents: negative ? -cents : cents, roundTo90 };
  }

  function showPreview() {
    const op = operation();
    if (!op) {
      setMessage(
        kind === "price_percent"
          ? "Informe a porcentagem (ex.: 8 ou -5)."
          : "Informe o valor em reais (ex.: 49,90 ou -2,00).",
      );
      return;
    }
    const ids = selectedIds();
    if (scope === "checked" && ids.length === 0) {
      setMessage("Marque os anúncios, ou escolha “todos do filtro”.");
      return;
    }
    const selection =
      scope === "checked" ? { kind: "ids", listingIds: ids } : { kind: "filter", filters };
    setMessage(null);
    startTransition(async () => {
      const result = await previewBulkAction(selection, op);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setPreview({ ...result, selection, operation: op });
    });
  }

  function apply() {
    if (!preview) return;
    startTransition(async () => {
      const result = await startBulkAction(preview.selection, preview.operation);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setPreview(null);
      setJobIds((current) => [...result.jobIds, ...current]);
    });
  }

  const changes = preview?.rows.filter((row) => row.plan.action === "change") ?? [];
  const skipped = preview?.rows.filter((row) => row.plan.action === "skip") ?? [];
  const isPrice = kind.startsWith("price");

  return (
    <div className="flex flex-col gap-3">
      {jobIds.map((jobId) => (
        <BatchProgressPanel
          key={jobId}
          jobId={jobId}
          onClose={() => setJobIds((current) => current.filter((id) => id !== jobId))}
          onUndoStarted={(ids) => setJobIds((current) => [...ids, ...current])}
        />
      ))}

      <div className="grid gap-3 rounded-lg border border-border bg-bg p-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-muted">Operação</span>
          <select
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as Kind);
              setPreview(null);
            }}
            className="h-9 rounded-lg border border-border bg-surface px-2 text-ink"
          >
            {KINDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {isPrice ? (
          <label className="flex flex-col gap-1">
            <span className="text-muted">
              {kind === "price_percent"
                ? "Porcentagem"
                : kind === "price_set"
                  ? "Novo preço (R$)"
                  : "Valor (R$)"}
            </span>
            <input
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setPreview(null);
              }}
              inputMode="decimal"
              placeholder={
                kind === "price_percent"
                  ? "ex.: 8 ou -5"
                  : kind === "price_set"
                    ? "ex.: 49,90"
                    : "ex.: 2,00 ou -2,00"
              }
              className="h-9 rounded-lg border border-border bg-surface px-2 text-ink"
            />
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <input
                type="checkbox"
                checked={roundTo90}
                onChange={(event) => {
                  setRoundTo90(event.target.checked);
                  setPreview(null);
                }}
              />
              Arredondar para ,90
            </span>
          </label>
        ) : (
          <div />
        )}
        <fieldset className="flex flex-col gap-1">
          <legend className="text-muted">Aplicar em</legend>
          <label className="flex items-center gap-1.5 text-ink">
            <input
              type="radio"
              checked={scope === "checked"}
              onChange={() => {
                setScope("checked");
                setPreview(null);
              }}
            />
            Anúncios marcados
          </label>
          <label className="flex items-center gap-1.5 text-ink">
            <input
              type="radio"
              checked={scope === "filter"}
              onChange={() => {
                setScope("filter");
                setPreview(null);
              }}
            />
            Todos do filtro ({Math.min(filterTotal, 500)}
            {filterTotal > 500 ? " de " + filterTotal : ""})
          </label>
        </fieldset>
        <div className="flex flex-col justify-end gap-1">
          <button
            type="button"
            onClick={showPreview}
            disabled={pending}
            className="h-9 rounded-lg border border-border bg-surface px-3 font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
          >
            {pending && !preview ? "Calculando…" : "Ver prévia"}
          </button>
          {message ? <span className="text-xs text-signal-ink">{message}</span> : null}
        </div>
      </div>

      {preview ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
          <p className="text-ink">
            <strong>{changes.length}</strong>{" "}
            {changes.length === 1 ? "anúncio muda" : "anúncios mudam"}
            {skipped.length ? `, ${skipped.length} ficam como estão` : ""}
            {preview.truncated ? ` (limite de 500 de ${preview.total})` : ""}.
            {changes.some((row) => row.plan.action === "change" && row.plan.bigChange)
              ? " Mudanças acima de 30% estão destacadas."
              : ""}
          </p>
          <div className="max-h-80 overflow-auto rounded border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface text-left text-muted">
                <tr>
                  <th className="px-2 py-1 font-medium">Anúncio</th>
                  <th className="px-2 py-1 font-medium">Conta</th>
                  <th className="px-2 py-1 text-right font-medium">Atual</th>
                  <th className="px-2 py-1 text-right font-medium">Novo</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => {
                  const plan = row.plan;
                  const big = plan.action === "change" && plan.bigChange;
                  return (
                    <tr
                      key={row.listingId}
                      className={`border-t border-border ${big ? "bg-signal-soft" : ""} ${plan.action === "skip" ? "text-muted" : "text-ink"}`}
                    >
                      <td className="px-2 py-1">
                        <span className="line-clamp-1">{row.title}</span>
                        <span className="text-muted tabular-nums">{row.externalId}</span>
                      </td>
                      <td className="px-2 py-1">{row.accountNickname}</td>
                      {plan.action === "change" ? (
                        <>
                          <td className="px-2 py-1 text-right tabular-nums">
                            {plan.change.field === "price"
                              ? formatCents(plan.change.from)
                              : plan.change.from}
                          </td>
                          <td
                            className={`px-2 py-1 text-right font-medium tabular-nums ${big ? "text-signal-ink" : ""}`}
                          >
                            {plan.change.field === "price"
                              ? formatCents(plan.change.to)
                              : plan.change.to === "paused"
                                ? "pausado"
                                : "ativo"}
                          </td>
                        </>
                      ) : (
                        <td colSpan={2} className="px-2 py-1 text-right">
                          {plan.reason}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {changes.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={apply}
                disabled={pending}
                className="h-9 rounded-lg bg-brand px-3 font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
              >
                {pending ? "Iniciando…" : `Confirmo, aplicar em ${changes.length}`}
              </button>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="h-9 rounded-lg border border-border bg-surface px-3 font-medium text-ink hover:bg-surface-2"
              >
                Cancelar
              </button>
              <span className="text-xs text-muted">
                Antes de cada envio o ERP confere o anúncio no Mercado Livre; se mudou desde a
                prévia, não sobrescreve. Ao terminar, dá para desfazer.
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
