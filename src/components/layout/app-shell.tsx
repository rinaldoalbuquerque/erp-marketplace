"use client";

import { Menu, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

const MobileNavContext = createContext<{ close: () => void }>({ close: () => {} });

/** Lets menu links close the mobile drawer after a click. */
export function useMobileNav() {
  return useContext(MobileNavContext);
}

/**
 * Frame of the internal area: side menu (fixed on desktop, drawer on mobile),
 * top bar and content. `sidebar` and `header` are Server Components passed in.
 */
export function AppShell({
  sidebar,
  header,
  children,
}: {
  sidebar: React.ReactNode;
  header: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <MobileNavContext value={{ close }}>
      <div className="min-h-screen bg-gray-50">
        {/* Dark overlay behind the drawer (mobile only). */}
        {open ? (
          <div
            className="fixed inset-0 z-30 bg-black/40 lg:hidden"
            aria-hidden="true"
            onClick={close}
          />
        ) : null}

        <aside
          id="side-menu"
          className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-gray-200 bg-white transition-transform lg:translate-x-0 ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex h-14 items-center justify-between border-b border-gray-200 px-4">
            <span className="font-semibold text-gray-900">ERP Marketplace</span>
            <button
              type="button"
              onClick={close}
              className="rounded-md p-1 text-gray-500 hover:bg-gray-100 lg:hidden"
              aria-label="Fechar menu"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">{sidebar}</div>
        </aside>

        <div className="flex min-h-screen flex-col lg:pl-64">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-gray-200 bg-white px-4">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-md p-1 text-gray-600 hover:bg-gray-100 lg:hidden"
              aria-label="Abrir menu"
              aria-controls="side-menu"
              aria-expanded={open}
            >
              <Menu className="size-5" />
            </button>
            <div className="flex flex-1 items-center justify-between gap-3">{header}</div>
          </header>
          <main className="flex-1 p-4 lg:p-6">{children}</main>
        </div>
      </div>
    </MobileNavContext>
  );
}
