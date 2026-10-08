"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { can } from "@/domain/auth/permissions";
import { requirePermission } from "@/server/auth/session";
import {
  createFromListings,
  type CreateFromListingsReport,
} from "@/server/products/from-listings-service";
import { getTenantContext } from "@/server/tenant/tenant-db";

const inputSchema = z.object({
  codes: z.array(z.string().min(1).max(60)).max(5000),
  includeStock: z.boolean(),
});

export async function createFromListingsAction(input: {
  codes: string[];
  includeStock: boolean;
}): Promise<{ ok: true; report: CreateFromListingsReport } | { ok: false; message: string }> {
  const member = await requirePermission("products.edit");
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Seleção inválida." };
  if (parsed.data.codes.length === 0) return { ok: false, message: "Selecione ao menos um SKU." };

  const { tdb } = await getTenantContext(member);
  const report = await createFromListings(
    tdb,
    {
      organizationId: member.organizationId,
      userId: member.user.id,
      canAdjustStock: can(member.role, "stock.adjust"),
    },
    parsed.data,
  );
  revalidatePath("/produtos");
  revalidatePath("/estoque");
  revalidatePath("/mapeamento");
  revalidatePath("/anuncios");
  return { ok: true, report };
}
