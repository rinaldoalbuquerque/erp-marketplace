"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/server/auth/session";
import { removeListingsFromSystem } from "@/server/listings/remove-service";
import { getTenantContext } from "@/server/tenant/tenant-db";

const idsSchema = z.array(z.uuid()).min(1).max(500);

/** "Excluir só do sistema": hides the listings from the ERP (they stay on the marketplace). */
export async function removeFromSystemAction(
  listingIds: string[],
): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  const member = await requirePermission("listings.delete");
  const { tdb } = await getTenantContext(member);
  const parsed = idsSchema.safeParse(listingIds);
  if (!parsed.success) return { ok: false, message: "Marque de 1 a 500 anúncios." };
  const count = await removeListingsFromSystem(tdb, parsed.data);
  revalidatePath("/anuncios");
  revalidatePath("/anuncios/mapeamento");
  return { ok: true, count };
}
