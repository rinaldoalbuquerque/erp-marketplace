"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { can } from "@/domain/auth/permissions";
import { parseBrlToCents } from "@/domain/products/money";
import { requirePermission } from "@/server/auth/session";
import { saveEdit, type SaveEditResult } from "@/server/listings/edit-service";
import { getTenantContext } from "@/server/tenant/tenant-db";

const attributeInput = z.object({
  value: z.string().max(500),
  unit: z.string().max(40).optional(),
  notApplicable: z.boolean().optional(),
});

const payloadSchema = z.object({
  versionStamp: z.string().nullable(),
  title: z.string().max(500).optional(),
  familyName: z.string().max(500).optional(),
  price: z.string().max(30).optional(),
  status: z.enum(["active", "paused", "closed"]).optional(),
  description: z.string().max(50_000).optional(),
  attributes: z.record(z.string(), attributeInput).optional(),
});

export type EditPayload = z.infer<typeof payloadSchema>;

export async function saveListingEditAction(
  listingId: string,
  payload: EditPayload,
): Promise<SaveEditResult> {
  const member = await requirePermission("listings.edit");
  if (!z.uuid().safeParse(listingId).success) return { status: "not_found" };
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return { status: "invalid", fieldErrors: { form: "Dados inválidos." } };

  const { price, ...rest } = parsed.data;
  let priceCents: number | undefined;
  if (price !== undefined && price.trim() !== "") {
    const cents = parseBrlToCents(price);
    if (cents === null)
      return { status: "invalid", fieldErrors: { price: "Preço inválido. Ex.: 89,90" } };
    priceCents = cents;
  }

  const { tdb } = await getTenantContext(member);
  const result = await saveEdit(
    {
      tdb,
      organizationId: member.organizationId,
      userId: member.user.id,
      canClose: can(member.role, "listings.delete"),
    },
    listingId,
    { ...rest, priceCents },
  );
  if (result.status === "saved") {
    revalidatePath("/anuncios");
    revalidatePath(`/anuncios/${listingId}/editar`);
  }
  return result;
}
