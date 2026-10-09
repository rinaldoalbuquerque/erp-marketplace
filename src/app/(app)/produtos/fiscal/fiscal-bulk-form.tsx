"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Field } from "@/components/ui/form";
import { SelectField } from "@/components/ui/fields";
import { bulkFiscalSchema, describePatch } from "@/domain/products/bulk-fiscal";
import { missingFiscalFields, ORIGINS, UNITS } from "@/domain/products/fiscal";
import { variationLabel } from "@/domain/products/schemas";

import { applyFiscalAction } from "./actions";

export type FiscalRow = {
  id: string;
  code: string;
  variation: unknown;
  ncm: string | null;
  cest: string | null;
  origin: number | null;
  unit: string;
  defaultCfop: string | null;
  product: { id: string; name: string };
};

const ORIGIN_OPTIONS = ORIGINS.map((origin) => ({
  value: String(origin.code),
  label: origin.label,
}));
const UNIT_OPTIONS = UNITS.map((unit) => ({ value: unit.code, label: unit.label }));
const EMPTY_FIELDS = { ncm: "", cest: "", origin: "", unit: "", defaultCfop: "" };

/** Fill fiscal fields once, choose SKUs, apply. Only filled fields are applied. */
export function FiscalBulkForm({
  rows,
  total,
  filter,
}: {
  rows: FiscalRow[];
  total: number;
  filter: { search: string; incompleteOnly: boolean };
}) {
  const router = useRouter();
  const [fields, setFields] = useState<Record<string, string>>(EMPTY_FIELDS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const groups = new Map<string, { name: string; rows: FiscalRow[] }>();
  for (const row of rows) {
    const group = groups.get(row.product.id) ?? { name: row.product.name, rows: [] };
    group.rows.push(row);
    groups.set(row.product.id, group);
  }

  const setField = (name: string, value: string) =>
    setFields((current) => ({ ...current, [name]: value }));
  const toggle = (ids: string[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const targetCount = allMatching ? total : selected.size;

  function apply() {
    setMessage(null);
    const parsed = bulkFiscalSchema.safeParse(fields);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues)
        next[issue.path.join(".") || "form"] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    if (targetCount === 0) {
      setMessage({ tone: "error", text: "Selecione ao menos um SKU." });
      return;
    }
    const confirmText = `Aplicar ${describePatch(parsed.data)} a ${targetCount} ${
      targetCount === 1 ? "SKU" : "SKUs"
    }?`;
    if (!window.confirm(confirmText)) return;

    startTransition(async () => {
      const result = await applyFiscalAction({
        fields,
        target: allMatching
          ? { mode: "filter", filter }
          : { mode: "selected", skuIds: [...selected] },
      });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setMessage({ tone: "error", text: result.message ?? "Confira os campos." });
        return;
      }
      setMessage({
        tone: "success",
        text: `${result.count} ${result.count === 1 ? "SKU atualizado" : "SKUs atualizados"}.`,
      });
      setSelected(new Set());
      setAllMatching(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="sticky top-16 z-10 flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field
            label="NCM"
            name="ncm"
            inputMode="numeric"
            placeholder="0000.00.00"
            value={fields.ncm}
            onChange={(event) => setField("ncm", event.target.value)}
            error={errors.ncm}
          />
          <Field
            label="CEST"
            name="cest"
            inputMode="numeric"
            placeholder="00.000.00"
            value={fields.cest}
            onChange={(event) => setField("cest", event.target.value)}
            error={errors.cest}
          />
          <SelectField
            label="Origem"
            name="origin"
            options={ORIGIN_OPTIONS}
            placeholder="Não alterar"
            value={fields.origin}
            onChange={(event) => setField("origin", event.target.value)}
            error={errors.origin}
          />
          <SelectField
            label="Unidade"
            name="unit"
            options={UNIT_OPTIONS}
            placeholder="Não alterar"
            value={fields.unit}
            onChange={(event) => setField("unit", event.target.value)}
            error={errors.unit}
          />
          <Field
            label="CFOP padrão"
            name="defaultCfop"
            inputMode="numeric"
            placeholder="5102"
            value={fields.defaultCfop}
            onChange={(event) => setField("defaultCfop", event.target.value)}
            error={errors.defaultCfop}
          />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1 text-sm text-muted">
            <p>
              Campos vazios não são alterados. Na dúvida sobre NCM ou CFOP, confirme com seu
              contador.
            </p>
            <label className="flex items-center gap-1.5 text-ink">
              <input
                type="checkbox"
                checked={allMatching}
                onChange={(event) => setAllMatching(event.target.checked)}
              />
              Aplicar a todos os {total} SKUs que o filtro encontrou (não só os desta página)
            </label>
            {errors.form ? <p className="text-danger">{errors.form}</p> : null}
          </div>
          <button
            type="button"
            onClick={apply}
            disabled={pending}
            className="h-10 shrink-0 rounded-lg bg-brand px-4 text-sm font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
          >
            {pending
              ? "Aplicando…"
              : `Aplicar a ${targetCount} ${targetCount === 1 ? "SKU" : "SKUs"}`}
          </button>
        </div>
        {message ? (
          <p
            role={message.tone === "error" ? "alert" : "status"}
            className={`rounded-lg border-l-4 px-3 py-2 text-sm ${
              message.tone === "error"
                ? "border-danger bg-danger-soft text-danger"
                : "border-success bg-success-soft text-success"
            }`}
          >
            {message.text}
          </p>
        ) : null}
      </section>

      <div className="flex gap-4 text-sm">
        <button
          type="button"
          onClick={() =>
            toggle(
              rows.map((row) => row.id),
              true,
            )
          }
          disabled={allMatching}
          className="text-brand hover:underline disabled:opacity-50"
        >
          Marcar todos desta página
        </button>
        <button
          type="button"
          onClick={() => setSelected(new Set())}
          disabled={allMatching}
          className="text-brand hover:underline disabled:opacity-50"
        >
          Desmarcar todos
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-muted">
            <tr>
              <th className="w-10 px-4 py-3">
                <span className="sr-only">Selecionar</span>
              </th>
              <th className="px-4 py-3 font-medium">Produto / SKU</th>
              <th className="px-4 py-3 font-medium">NCM</th>
              <th className="px-4 py-3 font-medium">Origem</th>
              <th className="px-4 py-3 font-medium">CFOP</th>
              <th className="px-4 py-3 font-medium">Un.</th>
              <th className="px-4 py-3 font-medium">Situação</th>
            </tr>
          </thead>
          <tbody>
            {[...groups.entries()].map(([productId, group]) => {
              const ids = group.rows.map((row) => row.id);
              const allOn = allMatching || ids.every((id) => selected.has(id));
              return [
                <tr key={productId} className="border-t border-border bg-bg">
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Selecionar todos os SKUs de ${group.name}`}
                      checked={allOn}
                      disabled={allMatching}
                      onChange={(event) => toggle(ids, event.target.checked)}
                    />
                  </td>
                  <td className="px-4 py-2 font-medium text-ink" colSpan={6}>
                    {group.name}
                  </td>
                </tr>,
                ...group.rows.map((row) => {
                  const missing = missingFiscalFields(row);
                  return (
                    <tr key={row.id} className="align-top">
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Selecionar ${row.code}`}
                          checked={allMatching || selected.has(row.id)}
                          disabled={allMatching}
                          onChange={(event) => toggle([row.id], event.target.checked)}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <span className="text-ink">{row.code}</span>
                        {Array.isArray(row.variation) && row.variation.length ? (
                          <span className="block text-xs text-muted">
                            {variationLabel(row.variation)}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 text-muted tabular-nums">{row.ncm ?? "—"}</td>
                      <td className="px-4 py-2 text-muted tabular-nums">{row.origin ?? "—"}</td>
                      <td className="px-4 py-2 text-muted tabular-nums">
                        {row.defaultCfop ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-muted">{row.unit}</td>
                      <td className="px-4 py-2">
                        {missing.length ? (
                          <span className="rounded-full bg-signal-soft px-2 py-0.5 text-xs font-medium text-signal-ink">
                            Falta {missing.join(", ")}
                          </span>
                        ) : (
                          <span className="text-xs text-success">Completo</span>
                        )}
                      </td>
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
