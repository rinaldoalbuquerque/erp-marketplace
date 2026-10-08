"use client";

import { PackagePlus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import { WARNING_LABELS, type ProposedProduct } from "@/domain/products/from-listings";
import { variationLabel } from "@/domain/products/schemas";
import type { CreateFromListingsReport } from "@/server/products/from-listings-service";

import { createFromListingsAction } from "./actions";

/** Review table: choose which proposed SKUs to create, then create them. */
export function ReviewForm({
  products,
  canAdjustStock,
}: {
  products: ProposedProduct[];
  canAdjustStock: boolean;
}) {
  const creatable = useMemo(
    () => products.flatMap((product) => product.skus.filter((sku) => !sku.blocked)),
    [products],
  );
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(creatable.map((sku) => sku.code)),
  );
  const [includeStock, setIncludeStock] = useState(canAdjustStock);
  const [onlyWarnings, setOnlyWarnings] = useState(false);
  const [pending, startTransition] = useTransition();
  const [report, setReport] = useState<CreateFromListingsReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = onlyWarnings
    ? products.filter((product) => product.skus.some((sku) => sku.warnings.length > 0))
    : products;

  function toggle(code: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createFromListingsAction({ codes: [...selected], includeStock });
      if (result.ok) setReport(result.report);
      else setError(result.message);
    });
  }

  if (report) {
    return (
      <div
        role="status"
        className="flex flex-col gap-3 rounded-xl border-l-4 border-success bg-success-soft p-5 text-success"
      >
        <p className="font-display text-xl font-semibold">Pronto!</p>
        <ul className="flex flex-col gap-1 text-sm">
          <li>
            <strong>{report.productsCreated}</strong> produtos e{" "}
            <strong>{report.skusCreated}</strong> SKUs criados.
          </li>
          {report.skippedExisting ? (
            <li>{report.skippedExisting} já existiam no ERP e foram pulados.</li>
          ) : null}
          <li>
            <strong>{report.stockEntries}</strong> lançamentos de estoque inicial.
          </li>
          <li>
            <strong>{report.linked}</strong> anúncios vinculados automaticamente.
          </li>
        </ul>
        <p className="text-sm text-ink">
          Os dados fiscais (NCM, origem, CFOP) não vêm do Mercado Livre: complete-os em{" "}
          <Link href="/produtos" className="font-medium text-brand underline">
            Produtos
          </Link>
          . Confira o que ainda falta vincular em{" "}
          <Link href="/mapeamento" className="font-medium text-brand underline">
            Mapeamento
          </Link>
          .
        </p>
      </div>
    );
  }

  const selectedCount = creatable.filter((sku) => selected.has(sku.code)).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-16 z-10 flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setSelected(new Set(creatable.map((sku) => sku.code)))}
              className="text-brand hover:underline"
            >
              Marcar todos
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-brand hover:underline"
            >
              Desmarcar todos
            </button>
            <label className="flex items-center gap-1.5 text-ink">
              <input
                type="checkbox"
                checked={onlyWarnings}
                onChange={(event) => setOnlyWarnings(event.target.checked)}
              />
              Mostrar só os com alerta
            </label>
          </div>
          {canAdjustStock ? (
            <label className="flex items-center gap-1.5 text-ink">
              <input
                type="checkbox"
                checked={includeStock}
                onChange={(event) => setIncludeStock(event.target.checked)}
              />
              Usar o estoque atual do Mercado Livre como estoque inicial
            </label>
          ) : null}
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <button
            type="button"
            onClick={submit}
            disabled={pending || selectedCount === 0}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
          >
            <PackagePlus className="size-4" aria-hidden="true" />
            {pending ? "Criando… (pode levar alguns minutos)" : `Criar ${selectedCount} SKUs`}
          </button>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-muted">
            <tr>
              <th className="w-10 px-4 py-3">
                <span className="sr-only">Selecionar</span>
              </th>
              <th className="px-4 py-3 font-medium">Produto / SKU</th>
              <th className="px-4 py-3 font-medium">EAN</th>
              <th className="px-4 py-3 font-medium">Peso e medidas</th>
              <th className="px-4 py-3 text-right font-medium">Estoque ML</th>
              <th className="px-4 py-3 font-medium">Anúncios</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((product) => [
              <tr key={product.key} className="border-t border-border bg-bg">
                <td />
                <td className="px-4 py-2 font-medium text-ink" colSpan={5}>
                  {product.name}
                  {product.brand ? (
                    <span className="ml-2 text-xs text-muted">{product.brand}</span>
                  ) : null}
                </td>
              </tr>,
              ...product.skus.map((sku) => (
                <tr key={sku.code} className="align-top">
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Criar ${sku.code}`}
                      checked={!sku.blocked && selected.has(sku.code)}
                      disabled={sku.blocked}
                      onChange={() => toggle(sku.code)}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <span className="font-medium text-ink">{sku.code}</span>
                    {sku.variation ? (
                      <span className="block text-xs text-muted">
                        {variationLabel(sku.variation)}
                      </span>
                    ) : null}
                    {sku.warnings.map((warning) => (
                      <span
                        key={warning}
                        className="mt-1 block w-fit rounded bg-signal-soft px-1.5 py-0.5 text-xs text-signal-ink"
                      >
                        {WARNING_LABELS[warning]}
                      </span>
                    ))}
                  </td>
                  <td className="px-4 py-2 text-muted tabular-nums">{sku.ean ?? "—"}</td>
                  <td className="px-4 py-2 text-muted tabular-nums">
                    {sku.weightGrams ? `${sku.weightGrams} g` : "—"}
                    {sku.heightCm && sku.widthCm && sku.lengthCm
                      ? `, ${sku.heightCm}×${sku.widthCm}×${sku.lengthCm} cm`
                      : ""}
                  </td>
                  <td className="px-4 py-2 text-right text-ink tabular-nums">
                    {sku.initialStock ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted tabular-nums">
                    {sku.externalIds.join(", ")}
                  </td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
    </div>
  );
}
