// Who can do what. Single source of truth for access rules: pages, Server
// Actions and (later) the menu all ask `can(role, permission)`.
// The server check (requirePermission) is what protects; hiding buttons is cosmetic.

export const ROLES = ["owner", "admin", "operator"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Dono",
  admin: "Administrador",
  operator: "Operador",
};

export const PERMISSIONS = [
  "listings.view",
  "listings.edit", // create, edit, replicate listings
  "listings.delete",
  "stock.view",
  "stock.adjust",
  "orders.view",
  "orders.fulfill", // picking, labels
  "invoices.issue",
  "financial.view", // costs, margins, fees
  "marketplaceAccounts.manage", // connect accounts, see tokens
  "members.manage", // invite/manage staff (see canManageMemberRole)
  "organization.manage", // company settings, delete company
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const OPERATOR: readonly Permission[] = [
  "listings.view",
  "listings.edit",
  "stock.view",
  "stock.adjust",
  "orders.view",
  "orders.fulfill",
  "invoices.issue",
];

const ADMIN: readonly Permission[] = [
  ...OPERATOR,
  "listings.delete",
  "financial.view",
  "marketplaceAccounts.manage",
  "members.manage",
];

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(PERMISSIONS),
  admin: new Set(ADMIN),
  operator: new Set(OPERATOR),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/**
 * Whether `actor` may invite, change or remove a member with role `target`.
 * Owners manage everyone; admins manage operators only.
 */
export function canManageMemberRole(actor: Role, target: Role): boolean {
  if (!can(actor, "members.manage")) return false;
  if (actor === "owner") return true;
  return target === "operator";
}
