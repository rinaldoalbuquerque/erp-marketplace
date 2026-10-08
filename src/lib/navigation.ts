import { can, type Permission, type Role } from "@/domain/auth/permissions";

// Side menu of the internal area. To add a module: add (or enable) its item
// here with the permission it requires, and protect the page itself with
// requirePermission() — hiding the item is only cosmetic.

/** Icon names, mapped to lucide-react components in the client (components can't be serialized). */
export type NavIconName =
  | "dashboard"
  | "listings"
  | "mapping"
  | "orders"
  | "picking"
  | "products"
  | "stock"
  | "accounts"
  | "settings";

export type NavItem = {
  label: string;
  href: string;
  icon: NavIconName;
  /** Permission needed to see the item. Omit for items every member sees. */
  permission?: Permission;
  /** Module not built yet: shown as "em breve" and not clickable. */
  comingSoon?: boolean;
};

export type NavSection = { title?: string; items: NavItem[] };

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    items: [
      { label: "Painel", href: "/painel", icon: "dashboard" },
      {
        label: "Anúncios",
        href: "/anuncios",
        icon: "listings",
        permission: "listings.view",
      },
      {
        label: "Mapeamento",
        href: "/mapeamento",
        icon: "mapping",
        permission: "listings.view",
      },
      {
        label: "Pedidos",
        href: "/pedidos",
        icon: "orders",
        permission: "orders.view",
        comingSoon: true,
      },
      {
        label: "Separação",
        href: "/separacao",
        icon: "picking",
        permission: "orders.fulfill",
        comingSoon: true,
      },
      {
        label: "Produtos",
        href: "/produtos",
        icon: "products",
        permission: "stock.view",
      },
      {
        label: "Estoque",
        href: "/estoque",
        icon: "stock",
        permission: "stock.view",
      },
    ],
  },
  {
    title: "Administração",
    items: [
      {
        label: "Contas de marketplace",
        href: "/contas",
        icon: "accounts",
        permission: "marketplaceAccounts.manage",
      },
      {
        label: "Configurações",
        href: "/configuracoes",
        icon: "settings",
        permission: "organization.manage",
        comingSoon: true,
      },
    ],
  },
];

/** Menu as seen by a role: items without permission are removed, empty sections too. */
export function navForRole(role: Role): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.permission || can(role, item.permission)),
  })).filter((section) => section.items.length > 0);
}

/** Whether `href` is the current page or one of its sub-pages. */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
