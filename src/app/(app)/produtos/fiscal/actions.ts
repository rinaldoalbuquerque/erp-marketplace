"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { bulkFiscalSchema } from "@/domain/products/bulk-fiscal";
import { fieldErrors } from "@/lib/auth/schemas";
import { requirePermission } from "@/server/auth/session";
import { applyFiscalPatch } from "@/server/products/fiscal-bulk";
import { getTenantContext } from "@/server/tenant/tenant-db";

const targetSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("selected"), skuIds: z.array(z.uuid()).min(1).max(1000) }),
  z.object({
    mode: z.literal("filter"),
    filter: z.object({ search: z.string().max(100).optional(), incompleteOnly: z.boolean() }),
  }),
]);

export type ApplyFiscalResult =
  | { ok: true; count: number }
  | { ok: false; message?: string; fieldErrors?: Record<string, string> };

export async function applyFiscalAction(input: {
  fields: Record<string, string>;
  target: unknown;
}): Promise<ApplyFiscalResult> {
  const member = await requirePermission("products.edit");
  const patch = bulkFiscalSchema.safeParse(input.fields);
  if (!patch.success) return { ok: false, fieldErrors: fieldErrors(patch.error) };
  const target = targetSchema.safeParse(input.target);
  if (!target.success) return { ok: false, message: "Selecione ao menos um SKU." };

  const { tdb } = await getTenantContext(member);
  const count = await applyFiscalPatch(tdb, patch.data, target.data);
  revalidatePath("/produtos");
  revalidatePath("/produtos/fiscal");
  return { ok: true, count };
}
