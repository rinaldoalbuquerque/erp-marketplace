import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { scopeQueryArgs, TENANT_MODELS, TenantScopeError } from "@/server/tenant/scope";

const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const scope = (operation: string, args?: Record<string, unknown>, model = "Membership") =>
  scopeQueryArgs(model, operation, args, ORG);

describe("scopeQueryArgs: reads and deletes", () => {
  it.each([
    "findMany",
    "findFirst",
    "findFirstOrThrow",
    "findUnique",
    "findUniqueOrThrow",
    "count",
    "aggregate",
    "groupBy",
    "delete",
    "deleteMany",
  ])("%s gets the organization filter", (operation) => {
    expect(scope(operation, { where: { role: "operator" } }).where).toEqual({
      role: "operator",
      organizationId: ORG,
    });
  });

  it("adds the filter when there is no where at all", () => {
    expect(scope("findMany")).toEqual({ where: { organizationId: ORG } });
  });

  it("keeps OR conditions inside the organization (top-level keys are ANDed)", () => {
    const where = { OR: [{ role: "admin" }, { role: "owner" }] };
    expect(scope("findMany", { where }).where).toEqual({ ...where, organizationId: ORG });
  });

  it("keeps other arguments (select, orderBy, take...)", () => {
    const args = { select: { id: true }, orderBy: { createdAt: "asc" }, take: 10 };
    expect(scope("findMany", args)).toMatchObject(args);
  });

  it("accepts an explicit filter for the same organization", () => {
    expect(scope("findMany", { where: { organizationId: ORG } }).where).toEqual({
      organizationId: ORG,
    });
  });

  it("rejects a filter for another organization", () => {
    expect(() => scope("findMany", { where: { organizationId: OTHER } })).toThrow(TenantScopeError);
  });
});

describe("scopeQueryArgs: writes", () => {
  it("create sets organizationId", () => {
    expect(scope("create", { data: { userId: "u", role: "operator" } }).data).toEqual({
      userId: "u",
      role: "operator",
      organizationId: ORG,
    });
  });

  it("createMany sets organizationId on every row", () => {
    const result = scope("createMany", { data: [{ userId: "a" }, { userId: "b" }] });
    expect(result.data).toEqual([
      { userId: "a", organizationId: ORG },
      { userId: "b", organizationId: ORG },
    ]);
  });

  it("rejects creating data for another organization", () => {
    expect(() => scope("create", { data: { organizationId: OTHER } })).toThrow(TenantScopeError);
    expect(() => scope("createMany", { data: [{}, { organizationId: OTHER }] })).toThrow(
      TenantScopeError,
    );
  });

  it("rejects relation syntax that could point to another organization", () => {
    expect(() => scope("create", { data: { organization: { connect: { id: OTHER } } } })).toThrow(
      TenantScopeError,
    );
  });

  it("update and updateMany are filtered by organization", () => {
    for (const operation of ["update", "updateMany", "updateManyAndReturn"]) {
      expect(scope(operation, { where: { id: "x" }, data: { role: "admin" } }).where).toEqual({
        id: "x",
        organizationId: ORG,
      });
    }
  });

  it("rejects moving rows to another organization", () => {
    expect(() => scope("update", { where: { id: "x" }, data: { organizationId: OTHER } })).toThrow(
      TenantScopeError,
    );
    expect(() =>
      scope("updateMany", { data: { organization: { connect: { id: OTHER } } } }),
    ).toThrow(TenantScopeError);
  });

  it("upsert scopes where and create, and checks update", () => {
    const result = scope("upsert", {
      where: { id: "x" },
      create: { userId: "u" },
      update: { role: "admin" },
    });
    expect(result.where).toEqual({ id: "x", organizationId: ORG });
    expect(result.create).toEqual({ userId: "u", organizationId: ORG });
    expect(() =>
      scope("upsert", { where: { id: "x" }, create: {}, update: { organizationId: OTHER } }),
    ).toThrow(TenantScopeError);
  });
});

describe("scopeQueryArgs: fails closed", () => {
  it("rejects models without organizationId", () => {
    expect(() => scope("findMany", {}, "Organization")).toThrow(/not organization-scoped/);
    expect(() => scope("findMany", {}, "Profile")).toThrow(TenantScopeError);
  });

  it("rejects raw queries (no model)", () => {
    expect(() => scopeQueryArgs(undefined, "$queryRaw", {}, ORG)).toThrow(TenantScopeError);
  });

  it("rejects unknown operations", () => {
    expect(() => scope("somethingNew", {})).toThrow(/not allowed/);
  });

  it("rejects an empty organization id", () => {
    expect(() => scopeQueryArgs("Membership", "findMany", {}, "")).toThrow(TenantScopeError);
  });
});

describe("TENANT_MODELS", () => {
  it("lists exactly the Prisma models that have an organizationId field", () => {
    const schema = readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");
    const modelsWithOrg = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
      .filter(([, , body]) => /^\s+organizationId\s/m.test(body ?? ""))
      .map(([, name]) => name)
      .sort();
    expect([...TENANT_MODELS].sort()).toEqual(modelsWithOrg);
  });
});
