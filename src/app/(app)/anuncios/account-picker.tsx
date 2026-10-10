"use client";

import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * "Contas ▾": drop-down list of the connected accounts with checkboxes. The
 * listing only changes when "Aplicar" is clicked (one account or several).
 */
export function AccountPicker({
  accounts,
  selected,
  baseQuery,
}: {
  accounts: Array<{ id: string; nickname: string }>;
  /** Accounts in the current filter (empty = all). */
  selected: string[];
  /** Current filters without accounts and page (kept when applying). */
  baseQuery: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<string[]>(selected);
  const box = useRef<HTMLDivElement>(null);

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const label =
    selected.length === 0 || selected.length === accounts.length
      ? "Todas as contas"
      : selected.length === 1
        ? (accounts.find((account) => account.id === selected[0])?.nickname ?? "1 conta")
        : `${selected.length} contas`;
  const all = checked.length === 0 || checked.length === accounts.length;

  function apply() {
    const query = new URLSearchParams(baseQuery);
    if (!all) for (const id of checked) query.append("conta", id);
    const text = query.toString();
    setOpen(false);
    router.push(text ? `/anuncios?${text}` : "/anuncios");
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => {
          setChecked(selected);
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-ink hover:bg-surface-2"
      >
        <span className="text-muted">Contas:</span>
        <span className="max-w-48 truncate font-medium">{label}</span>
        <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 flex w-72 flex-col gap-1 rounded-lg border border-border bg-surface p-2 text-sm shadow-lg">
          <label className="flex items-center gap-2 rounded px-2 py-1.5 font-medium text-ink hover:bg-surface-2">
            <input
              type="checkbox"
              checked={all}
              onChange={() => setChecked([])}
              className="size-4 accent-brand"
            />
            Todas as contas
          </label>
          <div className="max-h-64 overflow-y-auto border-t border-border pt-1">
            {accounts.map((account) => (
              <label
                key={account.id}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-ink hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  checked={!all && checked.includes(account.id)}
                  onChange={(event) =>
                    setChecked((current) => {
                      const base = all ? [] : current;
                      return event.target.checked
                        ? [...base, account.id]
                        : base.filter((id) => id !== account.id);
                    })
                  }
                  className="size-4 accent-brand"
                />
                <span className="truncate">{account.nickname}</span>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-8 rounded-lg px-3 text-muted hover:text-ink"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={apply}
              className="h-8 rounded-lg bg-brand px-3 font-semibold text-on-brand hover:bg-brand-hover"
            >
              Aplicar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
