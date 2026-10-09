// Multi-tenant guard: rewrites Prisma query arguments so every read and write is
// limited to one organization. Pure function (no database), used by the Prisma
// extension in tenant-db.ts.
//
// Fails closed: unknown operations, models outside TENANT_MODELS and attempts to
// use another organization's id throw instead of running.

/**
 * Prisma models that have an `organizationId` column. A test checks this list
 * against prisma/schema.prisma, so a new business table can't be forgotten.
 */
export const TENANT_MODELS: ReadonlySet<string> = new Set([
  "Listing",
  "ListingEdit",
  "ListingVariation",
  "MarketplaceAccount",
  "Membership",
  "Product",
  "Sku",
  "SkuListingMapping",
  "StockMovement",
  "StockPush",
  "SyncJob",
]);

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantScopeError";
  }
}

type Args = Record<string, unknown> | undefined;
type Data = Record<string, unknown>;

const WHERE_OPERATIONS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "delete",
  "deleteMany",
]);
const UPDATE_OPERATIONS = new Set(["update", "updateMany", "updateManyAndReturn"]);
const CREATE_OPERATIONS = new Set(["create", "createMany", "createManyAndReturn"]);

function isObject(value: unknown): value is Data {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Adds `organizationId` to `where` (top-level keys are ANDed by Prisma). */
function scopeWhere(where: unknown, organizationId: string): Data {
  if (where !== undefined && !isObject(where)) {
    throw new TenantScopeError("Invalid where clause.");
  }
  const current = where ?? {};
  if ("organizationId" in current && current.organizationId !== organizationId) {
    throw new TenantScopeError("Query filters by another organization.");
  }
  return { ...current, organizationId };
}

/** Sets `organizationId` on data being created; rejects another organization. */
function scopeCreateData(data: unknown, organizationId: string): Data {
  if (!isObject(data)) throw new TenantScopeError("Invalid create data.");
  if ("organization" in data) {
    // Relation syntax (organization: { connect }) could point anywhere.
    throw new TenantScopeError("Set organizationId through the tenant client, not a relation.");
  }
  if ("organizationId" in data && data.organizationId !== organizationId) {
    throw new TenantScopeError("Cannot create data for another organization.");
  }
  return { ...data, organizationId };
}

/** Updates may not move rows to another organization. */
function checkUpdateData(data: unknown, organizationId: string): void {
  if (!isObject(data)) throw new TenantScopeError("Invalid update data.");
  if ("organization" in data) {
    throw new TenantScopeError("Cannot change a row's organization.");
  }
  if ("organizationId" in data && data.organizationId !== organizationId) {
    throw new TenantScopeError("Cannot move data to another organization.");
  }
}

export function scopeQueryArgs(
  model: string | undefined,
  operation: string,
  args: Args,
  organizationId: string,
): Data {
  if (!organizationId) throw new TenantScopeError("Missing organization.");
  if (!model || !TENANT_MODELS.has(model)) {
    throw new TenantScopeError(
      `Model "${model ?? "(raw query)"}" is not organization-scoped. Use a dedicated server function.`,
    );
  }

  const current: Data = { ...(args ?? {}) };

  if (WHERE_OPERATIONS.has(operation)) {
    return { ...current, where: scopeWhere(current.where, organizationId) };
  }

  if (UPDATE_OPERATIONS.has(operation)) {
    checkUpdateData(current.data, organizationId);
    return { ...current, where: scopeWhere(current.where, organizationId) };
  }

  if (CREATE_OPERATIONS.has(operation)) {
    const data = current.data;
    return {
      ...current,
      data: Array.isArray(data)
        ? data.map((item) => scopeCreateData(item, organizationId))
        : scopeCreateData(data, organizationId),
    };
  }

  if (operation === "upsert") {
    checkUpdateData(current.update, organizationId);
    return {
      ...current,
      where: scopeWhere(current.where, organizationId),
      create: scopeCreateData(current.create, organizationId),
    };
  }

  throw new TenantScopeError(`Operation "${operation}" is not allowed on the tenant client.`);
}
