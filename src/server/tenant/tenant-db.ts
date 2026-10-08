import "server-only";

import { requireMember, type CurrentMember } from "@/server/auth/session";
import { db } from "@/server/db";

import { scopeQueryArgs } from "./scope";

// Prisma client extensions: https://www.prisma.io/docs/orm/prisma-client/client-extensions/query

/**
 * Prisma client limited to one organization: every query on a tenant model gets
 * `organizationId` added automatically (see scope.ts). Queries on other models
 * throw, so business code can't reach another company's data by accident.
 *
 * Limitations (keep business code simple):
 * - Nested writes (`data: { items: { create: [...] } }`) are not rewritten:
 *   create child rows with their own call.
 * - Raw SQL ($queryRaw/$executeRaw) is not scoped: don't use it with this client.
 */
export function tenantDb(organizationId: string) {
  return db.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const scoped = scopeQueryArgs(
            model,
            operation,
            args as Record<string, unknown> | undefined,
            organizationId,
          );
          return query(scoped as typeof args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof tenantDb>;

/**
 * Entry point for business code in pages and Server Actions:
 *   const { member, tdb } = await getTenantContext();
 *   const rows = await tdb.product.findMany();   // only this organization's rows
 * Use requirePermission() first when the action needs a specific permission.
 */
export async function getTenantContext(
  member?: CurrentMember,
): Promise<{ member: CurrentMember; tdb: TenantDb }> {
  const current = member ?? (await requireMember());
  return { member: current, tdb: tenantDb(current.organizationId) };
}
