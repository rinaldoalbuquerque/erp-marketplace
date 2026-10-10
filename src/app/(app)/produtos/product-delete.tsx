"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteProductsAction } from "./actions";
import { resultQuery } from "./delete-result";

export const PRODUCT_FORM_ID = "product-delete-form";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const CONFIRM =
  "Produtos sem histórico são apagados junto com os SKUs; os que já tiveram vendas ou movimentações de estoque são arquivados. Anúncios vinculados continuam no Mercado Livre, só ficam sem SKU.";

/** Delete button of one product (list row or product page). */
export function DeleteProductButton({
  productId,
  name,
  label,
}: {
  productId: string;
  name: string;
  /** Shows the text next to the icon (product page). */
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      aria-label={`Excluir ${name}`}
      title="Excluir produto"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Excluir o produto "${name}"?\n\n${CONFIRM}`)) return;
        startTransition(async () => {
          const result = await deleteProductsAction([productId]);
          router.push(`/produtos?${resultQuery(result)}`);
        });
      }}
      className={
        label
          ? "inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
          : "text-muted hover:text-danger disabled:opacity-40"
      }
    >
      <Trash2 className="size-4" aria-hidden="true" />
      {label}
    </button>
  );
}

/** "Marcar todos" + "Excluir selecionados" over the product list. */
export function ProductDeleteBar() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const [pending, startTransition] = useTransition();

  const boxes = () => [
    ...document.querySelectorAll<HTMLInputElement>(
      `input[form="${PRODUCT_FORM_ID}"][name="productId"]`,
    ),
  ];

  function ask() {
    const ids = boxes()
      .filter((box) => box.checked)
      .map((box) => box.value);
    if (ids.length === 0) {
      setMessage("Marque os produtos que quer excluir.");
      return;
    }
    setMessage(null);
    setDeleting(ids);
  }

  function remove() {
    if (!deleting) return;
    startTransition(async () => {
      const result = await deleteProductsAction(deleting);
      setDeleting(null);
      router.push(`/produtos?${resultQuery(result)}`);
    });
  }

  return (
    <form
      id={PRODUCT_FORM_ID}
      onSubmit={(event) => event.preventDefault()}
      className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 text-sm"
    >
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-ink">
          <input
            type="checkbox"
            onChange={(event) =>
              boxes().forEach((box) => {
                box.checked = event.target.checked;
              })
            }
            className="size-4 accent-brand"
          />
          Marcar todos
        </label>
        <button
          type="button"
          onClick={ask}
          disabled={pending}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
        >
          <Trash2 className="size-4" aria-hidden="true" />
          Excluir selecionados
        </button>
        {message ? <span className="text-signal-ink">{message}</span> : null}
      </div>
      {deleting ? (
        <div
          role="alertdialog"
          aria-label="Confirmar exclusão"
          className="flex flex-col gap-2 rounded-lg border-l-4 border-danger bg-danger-soft p-3 text-danger sm:flex-row sm:items-center sm:justify-between"
        >
          <p>
            Excluir {plural(deleting.length, "produto", "produtos")}? {CONFIRM}
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="h-9 rounded-lg bg-danger px-3 font-semibold text-on-brand"
            >
              {pending ? "Excluindo…" : "Confirmo, excluir"}
            </button>
            <button
              type="button"
              onClick={() => setDeleting(null)}
              className="h-9 rounded-lg border border-border bg-surface px-3 font-medium text-ink hover:bg-surface-2"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
