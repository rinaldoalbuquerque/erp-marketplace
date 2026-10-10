"use client";

import { ImagePlus, Plus, Trash2, X } from "lucide-react";

import type { AttributeDefinition } from "@/domain/listings/attributes";
import { emptyVariant, type CanonicalVariant } from "@/domain/listings/canonical";
import { centsToInput, parseBrlToCents } from "@/domain/products/money";

export type SkuOption = { id: string; code: string; label: string };

/** A variant row as edited (strings for the number fields). */
export type VariantRow = CanonicalVariant & { priceText: string; quantityText: string };

export function toRow(variant: CanonicalVariant): VariantRow {
  return {
    ...variant,
    priceText: centsToInput(variant.priceCents),
    quantityText: String(variant.availableQuantity),
  };
}

/** Row -> variant; null + message when a number is invalid. */
export function fromRow(row: VariantRow): { variant: CanonicalVariant } | { error: string } {
  const priceCents = row.priceText.trim() ? parseBrlToCents(row.priceText) : null;
  if (row.priceText.trim() && (priceCents === null || priceCents <= 0)) {
    return { error: "preço inválido" };
  }
  const quantity = Number(row.quantityText);
  if (!Number.isInteger(quantity) || quantity < 0) return { error: "quantidade inválida" };
  const { priceText: _price, quantityText: _quantity, ...variant } = row;
  void _price;
  void _quantity;
  return { variant: { ...variant, priceCents, availableQuantity: quantity } };
}

const newKey = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * "Variantes" section of the new listing screen: which attributes vary, and one
 * row per variant (values, ERP SKU, barcode, stock, price, pictures).
 */
export function VariantsEditor({
  definitions,
  variationIds,
  onVariationIds,
  rows,
  onRows,
  skuOptions,
  published,
  basePriceText,
  disabled,
  uploading,
  onUpload,
  errors,
}: {
  definitions: AttributeDefinition[] | null;
  variationIds: string[];
  onVariationIds: (ids: string[]) => void;
  rows: VariantRow[];
  onRows: (rows: VariantRow[]) => void;
  skuOptions: SkuOption[];
  /** Variant key -> marketplace id, for variants already published (locked). */
  published: Record<string, string>;
  basePriceText: string;
  disabled: boolean;
  uploading: string | null;
  onUpload: (key: string, files: FileList) => void;
  errors: Record<string, string>;
}) {
  const byId = new Map((definitions ?? []).map((definition) => [definition.id, definition]));
  const candidates = (definitions ?? []).filter(
    (definition) => definition.allowsVariations && !definition.readOnly,
  );
  const emptyGtinReasons = byId.get("EMPTY_GTIN_REASON")?.values ?? [];

  const update = (key: string, change: Partial<VariantRow>) =>
    onRows(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));

  const setValue = (row: VariantRow, attributeId: string, text: string) => {
    const definition = byId.get(attributeId);
    const known = definition?.values.find(
      (value) => value.name.toLowerCase() === text.trim().toLowerCase(),
    );
    const others = row.attributes.filter((attribute) => attribute.id !== attributeId);
    update(row.key, {
      attributes: text.trim()
        ? [
            ...others,
            { id: attributeId, valueId: known?.id ?? null, valueName: known?.name ?? text },
          ]
        : others,
    });
  };

  const addVariation = (id: string) => onVariationIds([...variationIds, id].slice(0, 5));
  const removeVariation = (id: string) => {
    onVariationIds(variationIds.filter((current) => current !== id));
    onRows(
      rows.map((row) => ({
        ...row,
        attributes: row.attributes.filter((attribute) => attribute.id !== id),
      })),
    );
  };

  if (!definitions) {
    return (
      <p className="text-sm text-muted">
        Escolha a categoria para ver o que pode variar (cor, tamanho, voltagem…).
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">O que varia:</span>
        {variationIds.map((id) => (
          <span
            key={id}
            className="inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1 font-medium text-on-brand"
          >
            {byId.get(id)?.name ?? id}
            {!disabled ? (
              <button
                type="button"
                aria-label={`Remover ${byId.get(id)?.name ?? id}`}
                onClick={() => removeVariation(id)}
              >
                <X className="size-3" />
              </button>
            ) : null}
          </span>
        ))}
        {!disabled && variationIds.length < 5
          ? candidates
              .filter((definition) => !variationIds.includes(definition.id))
              .map((definition) => (
                <button
                  key={definition.id}
                  type="button"
                  onClick={() => addVariation(definition.id)}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-brand hover:bg-surface-2"
                >
                  <Plus className="size-3" aria-hidden="true" />
                  {definition.name}
                </button>
              ))
          : null}
        {candidates.length === 0 ? (
          <span className="text-signal-ink">
            Esta categoria não indica atributos de variação no Mercado Livre.
          </span>
        ) : null}
      </div>

      {rows.length ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-bg text-left text-muted">
              <tr>
                {variationIds.map((id) => (
                  <th key={id} className="px-2 py-2 font-medium">
                    {byId.get(id)?.name ?? id} *
                  </th>
                ))}
                <th className="px-2 py-2 font-medium">SKU do ERP</th>
                <th className="px-2 py-2 font-medium">Código de barras</th>
                <th className="px-2 py-2 font-medium">Qtd.</th>
                <th className="px-2 py-2 font-medium">Preço (R$)</th>
                <th className="px-2 py-2 font-medium">Fotos</th>
                <th className="px-2 py-2">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const locked = disabled || Boolean(published[row.key]);
                const rowError = errors[`variant.${row.key}`];
                return (
                  <tr key={row.key} className="border-t border-border align-top">
                    {variationIds.map((id) => {
                      const definition = byId.get(id);
                      const listId = definition?.values.length ? `v-${row.key}-${id}` : undefined;
                      return (
                        <td key={id} className="px-2 py-2">
                          <input
                            value={
                              row.attributes.find((attribute) => attribute.id === id)?.valueName ??
                              ""
                            }
                            onChange={(event) => setValue(row, id, event.target.value)}
                            list={listId}
                            disabled={locked}
                            aria-label={`${definition?.name ?? id} da variante ${index + 1}`}
                            className="h-9 w-32 rounded-lg border border-border bg-surface px-2 text-ink"
                          />
                          {listId ? (
                            <datalist id={listId}>
                              {definition!.values.slice(0, 200).map((value) => (
                                <option key={value.id} value={value.name} />
                              ))}
                            </datalist>
                          ) : null}
                        </td>
                      );
                    })}
                    <td className="px-2 py-2">
                      <select
                        value={row.skuId ?? ""}
                        onChange={(event) => update(row.key, { skuId: event.target.value || null })}
                        disabled={locked}
                        aria-label={`SKU da variante ${index + 1}`}
                        className="h-9 w-40 rounded-lg border border-border bg-surface px-2 text-ink"
                      >
                        <option value="">Sem SKU</option>
                        {row.skuId && !skuOptions.some((sku) => sku.id === row.skuId) ? (
                          <option value={row.skuId}>SKU vinculado</option>
                        ) : null}
                        {skuOptions.map((sku) => (
                          <option key={sku.id} value={sku.id}>
                            {sku.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      {row.emptyGtinReason !== null ? (
                        <select
                          value={row.emptyGtinReason}
                          onChange={(event) =>
                            update(row.key, { emptyGtinReason: event.target.value })
                          }
                          disabled={locked}
                          aria-label={`Motivo sem código de barras da variante ${index + 1}`}
                          className="h-9 w-40 rounded-lg border border-border bg-surface px-2 text-ink"
                        >
                          {emptyGtinReasons.map((reason) => (
                            <option key={reason.id} value={reason.name}>
                              {reason.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={row.gtin ?? ""}
                          onChange={(event) =>
                            update(row.key, { gtin: event.target.value || null })
                          }
                          disabled={locked}
                          inputMode="numeric"
                          placeholder="EAN/UPC"
                          aria-label={`Código de barras da variante ${index + 1}`}
                          className="h-9 w-36 rounded-lg border border-border bg-surface px-2 text-ink"
                        />
                      )}
                      {emptyGtinReasons.length ? (
                        <label className="mt-1 flex items-center gap-1 text-xs text-muted">
                          <input
                            type="checkbox"
                            checked={row.emptyGtinReason !== null}
                            disabled={locked}
                            onChange={(event) =>
                              update(row.key, {
                                gtin: null,
                                emptyGtinReason: event.target.checked
                                  ? (emptyGtinReasons[0]?.name ?? null)
                                  : null,
                              })
                            }
                          />
                          Não tenho agora
                        </label>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      <input
                        value={row.quantityText}
                        onChange={(event) => update(row.key, { quantityText: event.target.value })}
                        disabled={locked}
                        inputMode="numeric"
                        aria-label={`Quantidade da variante ${index + 1}`}
                        className="h-9 w-16 rounded-lg border border-border bg-surface px-2 text-ink"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        value={row.priceText}
                        onChange={(event) => update(row.key, { priceText: event.target.value })}
                        disabled={locked}
                        inputMode="decimal"
                        placeholder={basePriceText || "—"}
                        aria-label={`Preço da variante ${index + 1}`}
                        className="h-9 w-24 rounded-lg border border-border bg-surface px-2 text-ink"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1">
                        {row.pictures.slice(0, 3).map((picture, position) =>
                          picture.url ? (
                            // eslint-disable-next-line @next/next/no-img-element -- ML-hosted preview
                            <img
                              key={`${picture.id ?? picture.url}-${position}`}
                              src={picture.url}
                              alt=""
                              className="size-9 rounded border border-border object-contain"
                            />
                          ) : (
                            <span
                              key={position}
                              className="size-9 rounded border border-border bg-bg"
                            />
                          ),
                        )}
                        {row.pictures.length > 3 ? (
                          <span className="text-xs text-muted">+{row.pictures.length - 3}</span>
                        ) : null}
                        {!locked ? (
                          <label
                            className="inline-flex cursor-pointer items-center rounded border border-border px-1.5 py-1 text-muted hover:text-ink"
                            title="Fotos desta variante"
                          >
                            <ImagePlus className="size-4" aria-hidden="true" />
                            <span className="sr-only">Adicionar fotos da variante {index + 1}</span>
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              multiple
                              className="sr-only"
                              disabled={uploading !== null}
                              onChange={(event) => {
                                if (event.target.files?.length)
                                  onUpload(row.key, event.target.files);
                                event.target.value = "";
                              }}
                            />
                          </label>
                        ) : null}
                        {!locked && row.pictures.length ? (
                          <button
                            type="button"
                            onClick={() => update(row.key, { pictures: [] })}
                            className="text-xs text-muted hover:text-danger"
                          >
                            limpar
                          </button>
                        ) : null}
                      </div>
                      {uploading === row.key ? (
                        <span className="text-xs text-muted">Enviando…</span>
                      ) : row.pictures.length === 0 ? (
                        <span className="text-xs text-muted">usa as fotos principais</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      {published[row.key] ? (
                        <span className="text-xs text-success">Publicada {published[row.key]}</span>
                      ) : !disabled ? (
                        <button
                          type="button"
                          aria-label={`Remover variante ${index + 1}`}
                          onClick={() => onRows(rows.filter((item) => item.key !== row.key))}
                          className="text-muted hover:text-danger"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      ) : null}
                      {rowError ? <p className="text-xs text-danger">{rowError}</p> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {!disabled ? (
        <button
          type="button"
          onClick={() => onRows([...rows, toRow(emptyVariant(newKey()))])}
          disabled={variationIds.length === 0}
          className="inline-flex w-fit items-center gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-brand hover:bg-surface-2 disabled:opacity-50"
        >
          <Plus className="size-4" aria-hidden="true" />
          Adicionar variante
        </button>
      ) : null}
      {variationIds.length === 0 ? (
        <p className="text-xs text-muted">Primeiro escolha o que varia (ex.: + Cor).</p>
      ) : null}
    </div>
  );
}
