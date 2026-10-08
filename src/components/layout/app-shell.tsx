"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { BrandMark } from "@/components/brand-mark";
import { ROUTES } from "@/lib/auth/routes";

const MobileNavContext = createContext<{ close: () => void }>({ close: () => {} });

/** Lets menu links close the mobile drawer after a click. */
export function useMobileNav() {
  return useContext(MobileNavContext);
}

/**
 * Frame of the internal area: petrol side menu (fixed on desktop, drawer on
 * mobile), top bar and content. `sidebar` and `header` are Server Components.
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
      <div className="min-h-screen bg-bg">
        {/* Overlay behind the drawer (mobile only). */}
        {open ? (
          <div
            className="fixed inset-0 z-30 bg-sidebar/60 backdrop-blur-[2px] lg:hidden"
            aria-hidden="true"
            onClick={close}
          />
        ) : null}

        <aside
          id="side-menu"
          className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-sidebar text-sidebar-ink transition-transform duration-200 motion-reduce:transition-none lg:translate-x-0 ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex h-16 items-center justify-between px-5">
            <Link
              href={ROUTES.home}
              onClick={close}
              className="flex items-center gap-2.5 rounded-md text-sidebar-ink"
            >
              <BrandMark className="size-7" />
              <span className="font-display text-lg leading-none font-semibold">
                ERP Marketplace
              </span>
            </Link>
            <button
              type="button"
              onClick={close}
              className="rounded-md p-1 text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-ink lg:hidden"
              aria-label="Fechar menu"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 pt-2 pb-4">{sidebar}</div>
        </aside>

        <div className="flex min-h-screen flex-col lg:pl-64">
          <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-surface/85 px-4 backdrop-blur lg:px-8">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink lg:hidden"
              aria-label="Abrir menu"
              aria-controls="side-menu"
              aria-expanded={open}
            >
              <Menu className="size-5" />
            </button>
            <div className="flex min-w-0 flex-1 items-center justify-between gap-3">{header}</div>
          </header>
          <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
        </div>
      </div>
    </MobileNavContext>
  );
}
