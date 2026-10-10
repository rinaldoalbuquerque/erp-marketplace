"use client";

import { Copy, PencilRuler, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";

import { LISTING_TYPES, type ListingTypeId } from "@/domain/listings/canonical";

import { BatchProgressPanel } from "./batch-progress";
import { BulkEditPanel, type BulkFilters } from "./bulk-edit-panel";
import { startReplicateAction } from "./copy-actions";
import { DeleteDialog } from "./delete-dialog";

export const REPLICATE_FORM_ID = "replicate-form";

function selected() {
  return [
    ...document.querySelectorAll<HTMLInputElement>(
      `input[form="${REPLICATE_FORM_ID}"][name="listingId"]:checked`,
    ),
  ].map((box) => box.dataset.external ?? "");
}

const checkedIds = () =>
  [
    ...document.querySelectorAll<HTMLInputElement>(
      `input[form="${REPLICATE_FORM_ID}"][name="listingId"]:checked`,
    ),
  ].map((box) => box.value);

/**
 * Selection bar of the listings page: copies the checked listings into drafts of
 * an account, or edits them in bulk (both run as background batches).
 */
export function ReplicateBar({
  accounts,
  filters,
  filterTotal,
  canDelete = false,
}: {
  accounts: Array<{ id: string; nickname: string }>;
  filters: BulkFilters;
  filterTotal: number;
  /** Owner/admin: may delete listings. */
  canDelete?: boolean;
}) {
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [percent, setPercent] = useState("0");
  const [roundTo90, setRoundTo90] = useState(false);
  const [listingType, setListingType] = useState<"" | ListingTypeId>("");
  const [message, setMessage] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function start() {
    const ids = selected();
    if (ids.length === 0) {
      setMessage("Marque os anúncios que quer copiar.");
      return;
    }
    const value = Number(percent.replace(",", "."));
    if (!Number.isFinite(value) || value < -90 || value > 500) {
      setMessage("Ajuste de preço inválido (ex.: 10 ou -5).");
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await startReplicateAction({
        targetAccountId: accountId,
        sourceExternalIds: ids,
        percent: value,
        roundTo90,
        listingTypeId: listingType || null,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setJobId(result.jobId);
      setOpen(false);
    });
  }

  const selectAll = (checked: boolean) =>
    document
      .querySelectorAll<HTMLInputElement>(`input[form="${REPLICATE_FORM_ID}"][name="listingId"]`)
      .forEach((box) => {
        box.checked = checked;
      });

  return (
    <>
      {jobId ? <BatchProgressPanel jobId={jobId} onClose={() => setJobId(null)} /> : null}
      <form
        id={REPLICATE_FORM_ID}
        onSubmit={(event) => event.preventDefault()}
        className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 text-sm"
      >
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-ink">
            <input
              type="checkbox"
              onChange={(event) => selectAll(event.target.checked)}
              className="size-4 accent-brand"
            />
            Marcar todos desta página
          </label>
          <button
            type="button"
            onClick={() => {
              setOpen((value) => !value);
              setBulkOpen(false);
            }}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 font-medium text-ink hover:bg-surface-2"
          >
            <Copy className="size-4" aria-hidden="true" />
            Copiar para…
          </button>
          <button
            type="button"
            onClick={() => {
              setBulkOpen((value) => !value);
              setOpen(false);
            }}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 font-medium text-ink hover:bg-surface-2"
          >
            <PencilRuler className="size-4" aria-hidden="true" />
            Editar em massa
          </button>
          {canDelete ? (
            <button
              type="button"
              onClick={() => {
                const ids = checkedIds();
                if (ids.length === 0) {
                  setMessage("Marque os anúncios que quer excluir.");
                  return;
                }
                setMessage(null);
                setDeleteIds(ids);
              }}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 font-medium text-ink hover:bg-surface-2"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Excluir
            </button>
          ) : null}
          {message ? <span className="text-signal-ink">{message}</span> : null}
        </div>
        {open ? (
          <div className="grid gap-3 rounded-lg border border-border bg-bg p-3 sm:grid-cols-4">
            <label className="flex flex-col gap-1">
              <span className="text-muted">Conta de destino</span>
              <select
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                className="h-9 rounded-lg border border-border bg-surface px-2 text-ink"
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.nickname}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted">Ajuste de preço (%)</span>
              <input
                value={percent}
                onChange={(event) => setPercent(event.target.value)}
                inputMode="decimal"
                className="h-9 rounded-lg border border-border bg-surface px-2 text-ink"
              />
              <span className="flex items-center gap-1.5 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={roundTo90}
                  onChange={(event) => setRoundTo90(event.target.checked)}
                />
                Arredondar para ,90
              </span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted">Tipo de anúncio</span>
              <select
                value={listingType}
                onChange={(event) => setListingType(event.target.value as "" | ListingTypeId)}
                className="h-9 rounded-lg border border-border bg-surface px-2 text-ink"
              >
                <option value="">Igual ao original</option>
                {Object.entries(LISTING_TYPES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-col justify-end gap-1">
              <button
                type="button"
                onClick={start}
                disabled={pending || !accountId}
                className="h-9 rounded-lg bg-brand px-3 font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
              >
                {pending ? "Iniciando…" : "Criar rascunhos"}
              </button>
              <span className="text-xs text-muted">
                As cópias viram rascunhos para revisar antes de publicar.
              </span>
            </div>
          </div>
        ) : null}
        {bulkOpen ? (
          <BulkEditPanel filters={filters} filterTotal={filterTotal} selectedIds={checkedIds} />
        ) : null}
        {deleteIds ? <DeleteDialog ids={deleteIds} onClose={() => setDeleteIds(null)} /> : null}
      </form>
    </>
  );
}
