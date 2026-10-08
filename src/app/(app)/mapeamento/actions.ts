"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/server/auth/session";
import {
  autoMatch,
  linkSku,
  unlinkMappings,
  type AutoMatchItem,
} from "@/server/listings/mapping-service";
import { getTenantContext } from "@/server/tenant/tenant-db";

export type LinkFormState = { status: "idle" | "error" | "success"; message?: string };

const LINK_MESSAGES = {
  sku_not_found: "Não existe SKU com esse código no ERP. Cadastre em Produtos ou confira o código.",
  target_not_found: "Anúncio ou variação não encontrado.",
  variation_required: "Este anúncio tem variações: vincule cada variação.",
} as const;

const linkSchema = z.object({
  listingId: z.uuid(),
  variationId: z.union([z.uuid(), z.literal("")]),
  skuCode: z.string().trim().min(1, { error: "Informe o código do SKU." }).max(60),
});

export async function linkSkuAction(
  _prev: LinkFormState,
  formData: FormData,
): Promise<LinkFormState> {
  const member = await requirePermission("listings.edit");
  const { tdb } = await getTenantContext(member);
  const parsed = linkSchema.safeParse({
    listingId: formData.get("listingId"),
    variationId: formData.get("variationId") ?? "",
    skuCode: formData.get("skuCode") ?? "",
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const result = await linkSku(tdb, member.organizationId, member.user.id, {
    listingId: parsed.data.listingId,
    variationId: parsed.data.variationId || null,
    skuCode: parsed.data.skuCode,
  });
  if (result.status !== "linked") return { status: "error", message: LINK_MESSAGES[result.status] };
  revalidatePath("/mapeamento");
  revalidatePath("/anuncios");
  return { status: "success", message: `Vinculado a ${result.skuCode}.` };
}

export async function unlinkAction(mappingId: string): Promise<void> {
  const member = await requirePermission("listings.edit");
  const { tdb } = await getTenantContext(member);
  if (!z.uuid().safeParse(mappingId).success) return;
  await unlinkMappings(tdb, [mappingId]);
  revalidatePath("/mapeamento");
  revalidatePath("/anuncios");
}

export async function autoMatchAction(): Promise<AutoMatchItem[]> {
  const member = await requirePermission("listings.edit");
  const { tdb } = await getTenantContext(member);
  const linked = await autoMatch(tdb, member.organizationId, member.user.id);
  revalidatePath("/mapeamento");
  revalidatePath("/anuncios");
  return linked;
}

/** Undo an auto-match run: removes exactly the links it created. */
export async function undoAutoMatchAction(mappingIds: string[]): Promise<number> {
  const member = await requirePermission("listings.edit");
  const { tdb } = await getTenantContext(member);
  const ids = z.array(z.uuid()).max(5000).safeParse(mappingIds);
  if (!ids.success) return 0;
  const removed = await unlinkMappings(tdb, ids.data);
  revalidatePath("/mapeamento");
  revalidatePath("/anuncios");
  return removed;
}
