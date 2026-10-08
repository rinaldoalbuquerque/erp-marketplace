"use client";

import {
  Boxes,
  LayoutDashboard,
  Link2,
  Package,
  PackageCheck,
  Settings,
  ShoppingCart,
  Store,
  Tag,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { isActivePath, type NavIconName, type NavSection } from "@/lib/navigation";

import { useMobileNav } from "./app-shell";

const ICONS: Record<NavIconName, LucideIcon> = {
  dashboard: LayoutDashboard,
  listings: Tag,
  mapping: Link2,
  orders: ShoppingCart,
  picking: PackageCheck,
  products: Package,
  stock: Boxes,
  accounts: Store,
  settings: Settings,
};

/** Side menu links. Receives only the sections the member's role may see. */
export function SideNav({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();
  const { close } = useMobileNav();

  return (
    <nav aria-label="Menu principal" className="flex flex-col gap-6">
      {sections.map((section, index) => (
        <div key={section.title ?? index} className="flex flex-col gap-0.5">
          {section.title ? (
            <p className="px-3 pb-1.5 text-xs font-medium text-sidebar-muted">{section.title}</p>
          ) : null}
          {section.items.map((item) => {
            const Icon = ICONS[item.icon];
            const content = (
              <>
                <Icon className="size-[18px] shrink-0" aria-hidden="true" />
                <span className="flex-1">{item.label}</span>
                {item.comingSoon ? (
                  <span className="rounded-full border border-sidebar-muted/30 px-2 py-px text-[10px] font-medium text-sidebar-muted">
                    em breve
                  </span>
                ) : null}
              </>
            );

            if (item.comingSoon) {
              return (
                <span
                  key={item.href}
                  className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-muted/80"
                  aria-disabled="true"
                  title="Módulo em construção"
                >
                  {content}
                </span>
              );
            }

            const active = isActivePath(pathname, item.href);
            // Active item: amber strip on the left, like a tag stuck to the menu.
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={close}
                aria-current={active ? "page" : undefined}
                className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-sidebar-active font-semibold text-sidebar-ink before:absolute before:inset-y-1.5 before:-left-3 before:w-1 before:rounded-r-full before:bg-signal"
                    : "text-sidebar-ink/85 hover:bg-sidebar-hover hover:text-sidebar-ink"
                }`}
              >
                {content}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
