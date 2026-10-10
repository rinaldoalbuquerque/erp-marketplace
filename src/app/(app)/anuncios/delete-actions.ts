"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { requirePermission } from "@/server/auth/session";
import { runBatchRound } from "@/server/listings/batch-service";
import { MAX_DELETE, startDeleteListings } from "@/server/listings/delete-listings-service";
import { removeListingsFromSystem } from "@/server/listings/remove-service";
import { getTenantContext } from "@/server/tenant/tenant-db";

// Delete batches run AFTER the response (next/server `after`) within the page's
// maxDuration (300s on /anuncios); the progress panel asks for more rounds.
const ROUND_BUDGET_MS = 240_000;

/** "Excluir só do sistema": hides the listings from the ERP (they stay on the marketplace). */
export async function removeFromSystemAction(
  listingIds: string[],
): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  const member = await requirePermission("listings.delete");
  const { tdb } = await getTenantContext(member);
  const parsed = z.array(z.uuid()).min(1).max(500).safeParse(listingIds);
  if (!parsed.success) return { ok: false, message: "Marque de 1 a 500 anúncios." };
  const count = await removeListingsFromSystem(tdb, parsed.data);
  revalidatePath("/anuncios");
  revalidatePath("/anuncios/mapeamento");
  return { ok: true, count };
}

/** "Excluir também no Mercado Livre": closes and deletes on the marketplace (background batch). */
export async function deleteOnMarketplaceAction(
  listingIds: string[],
): Promise<{ ok: true; jobIds: string[]; blocked: number } | { ok: false; message: string }> {
  const member = await requirePermission("listings.delete");
  const { tdb } = await getTenantContext(member);
  const parsed = z.array(z.uuid()).min(1).max(MAX_DELETE).safeParse(listingIds);
  if (!parsed.success) {
    return { ok: false, message: `Marque de 1 a ${MAX_DELETE} anúncios por vez.` };
  }
  const result = await startDeleteListings(tdb, member.organizationId, member.user.id, parsed.data);
  if (result.status !== "started") {
    return {
      ok: false,
      message:
        "Nada foi excluído: as contas desses anúncios estão com as alterações bloqueadas (libere em Contas).",
    };
  }
  const deadline = new Date(Date.now() + ROUND_BUDGET_MS);
  after(async () => {
    for (const jobId of result.jobIds) {
      await runBatchRound(member.organizationId, jobId, deadline);
    }
  });
  return { ok: true, jobIds: result.jobIds, blocked: result.blocked };
}
