import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { TenantScopeError } from "@/server/tenant/scope";
import { tenantDb } from "@/server/tenant/tenant-db";

// Runs against the real database (`npm run test:db`). Read-only: every write
// attempted here is rejected by the tenant guard before reaching the database.

let organizationId: string;
let membershipId: string;
let membershipRole: "owner" | "admin" | "operator";
const otherOrganization = randomUUID();

beforeAll(async () => {
  const membership = await db.membership.findFirst({ orderBy: { createdAt: "asc" } });
  if (!membership) throw new Error("Needs at least one membership (create an account first).");
  organizationId = membership.organizationId;
  membershipId = membership.id;
  membershipRole = membership.role;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("tenantDb against the database", () => {
  it("sees its own organization's rows", async () => {
    const rows = await tenantDb(organizationId).membership.findMany();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.organizationId === organizationId)).toBe(true);
  });

  it("sees nothing from another organization", async () => {
    const other = tenantDb(otherOrganization);
    expect(await other.membership.findMany()).toEqual([]);
    expect(await other.membership.count()).toBe(0);
  });

  it("can't fetch another organization's row even by its id", async () => {
    const other = tenantDb(otherOrganization);
    expect(await other.membership.findUnique({ where: { id: membershipId } })).toBeNull();
    expect(await other.membership.findFirst({ where: { id: membershipId } })).toBeNull();
  });

  it("an update from another organization changes nothing", async () => {
    const result = await tenantDb(otherOrganization).membership.updateMany({
      where: { id: membershipId },
      // Same role it already has: harmless even if the guard were broken.
      data: { role: membershipRole },
    });
    expect(result.count).toBe(0);
  });

  it("rejects writes pointing at another organization", async () => {
    await expect(
      tenantDb(organizationId).membership.create({
        data: { userId: randomUUID(), role: "operator", organizationId: otherOrganization },
      }),
    ).rejects.toThrow(TenantScopeError);
  });

  it("blocks models without organizationId", async () => {
    await expect(tenantDb(organizationId).organization.findMany()).rejects.toThrow(
      TenantScopeError,
    );
    await expect(tenantDb(organizationId).profile.findMany()).rejects.toThrow(TenantScopeError);
  });
});
