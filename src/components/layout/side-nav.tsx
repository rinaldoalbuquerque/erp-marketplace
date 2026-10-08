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
    <nav aria-label="Menu principal" className="flex flex-col gap-5">
      {sections.map((section, index) => (
        <div key={section.title ?? index} className="flex flex-col gap-1">
          {section.title ? (
            <p className="px-3 pb-1 text-xs font-semibold tracking-wide text-gray-400 uppercase">
              {section.title}
            </p>
          ) : null}
          {section.items.map((item) => {
            const Icon = ICONS[item.icon];
            const content = (
              <>
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="flex-1">{item.label}</span>
                {item.comingSoon ? (
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                    em breve
                  </span>
                ) : null}
              </>
            );

            if (item.comingSoon) {
              return (
                <span
                  key={item.href}
                  className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm text-gray-400"
                  aria-disabled="true"
                  title="Módulo em construção"
                >
                  {content}
                </span>
              );
            }

            const active = isActivePath(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={close}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
                  active
                    ? "bg-blue-50 font-medium text-blue-700"
                    : "text-gray-700 hover:bg-gray-100"
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
