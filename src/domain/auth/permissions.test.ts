import { describe, expect, it } from "vitest";

import {
  can,
  canManageMemberRole,
  PERMISSIONS,
  ROLES,
  type Permission,
  type Role,
} from "@/domain/auth/permissions";

// The approved access matrix (PLANO.md / CLAUDE.md). Changing a rule means
// changing this table on purpose.
const MATRIX: Record<Permission, Record<Role, boolean>> = {
  "listings.view": { owner: true, admin: true, operator: true },
  "listings.edit": { owner: true, admin: true, operator: true },
  "listings.delete": { owner: true, admin: true, operator: false },
  "products.edit": { owner: true, admin: true, operator: true },
  "products.archive": { owner: true, admin: true, operator: false },
  "stock.view": { owner: true, admin: true, operator: true },
  "stock.adjust": { owner: true, admin: true, operator: true },
  "orders.view": { owner: true, admin: true, operator: true },
  "orders.fulfill": { owner: true, admin: true, operator: true },
  "invoices.issue": { owner: true, admin: true, operator: true },
  "financial.view": { owner: true, admin: true, operator: false },
  "marketplaceAccounts.manage": { owner: true, admin: true, operator: false },
  "members.manage": { owner: true, admin: true, operator: false },
  "organization.manage": { owner: true, admin: false, operator: false },
};

describe("can", () => {
  it("covers every permission in the matrix", () => {
    expect(Object.keys(MATRIX).sort()).toEqual([...PERMISSIONS].sort());
  });

  for (const permission of PERMISSIONS) {
    for (const role of ROLES) {
      const expected = MATRIX[permission][role];
      it(`${role} ${expected ? "can" : "cannot"} ${permission}`, () => {
        expect(can(role, permission)).toBe(expected);
      });
    }
  }

  it("operator never sees financial data, tokens or deletes listings (CLAUDE.md)", () => {
    expect(can("operator", "financial.view")).toBe(false);
    expect(can("operator", "marketplaceAccounts.manage")).toBe(false);
    expect(can("operator", "listings.delete")).toBe(false);
  });
});

describe("canManageMemberRole", () => {
  it("owner manages everyone", () => {
    for (const target of ROLES) expect(canManageMemberRole("owner", target)).toBe(true);
  });

  it("admin manages operators only", () => {
    expect(canManageMemberRole("admin", "operator")).toBe(true);
    expect(canManageMemberRole("admin", "admin")).toBe(false);
    expect(canManageMemberRole("admin", "owner")).toBe(false);
  });

  it("operator manages nobody", () => {
    for (const target of ROLES) expect(canManageMemberRole("operator", target)).toBe(false);
  });
});
