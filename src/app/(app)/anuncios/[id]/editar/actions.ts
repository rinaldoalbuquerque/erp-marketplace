"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { can } from "@/domain/auth/permissions";
import { variantSchema } from "@/domain/listings/canonical";
import { parseBrlToCents } from "@/domain/products/money";
import { requirePermission } from "@/server/auth/session";
import { saveEdit, type SaveEditResult } from "@/server/listings/edit-service";
import {
  publishNewVariants,
  uploadFamilyPicture,
  type NewVariantsResult,
} from "@/server/listings/family-edit-service";
import { enqueueForListings } from "@/server/stock-sync/push-service";
import { queueStockSync } from "@/server/stock-sync/schedule";
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
  pictureIds: z.array(z.string().min(1).max(100)).max(12).optional(),
  listingTypeId: z.enum(["gold_special", "gold_pro"]).optional(),
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
  let result: SaveEditResult;
  try {
    result = await saveEdit(
      {
        tdb,
        organizationId: member.organizationId,
        userId: member.user.id,
        canClose: can(member.role, "listings.delete"),
      },
      listingId,
      { ...rest, priceCents },
    );
  } catch (error) {
    // Never let an unexpected failure crash the page: log it (no tokens in it)
    // and show a clear message instead.
    console.error("Listing edit failed unexpectedly", {
      listingId,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    return { status: "unexpected" };
  }
  if (result.status === "saved") {
    revalidatePath("/anuncios");
    revalidatePath(`/anuncios/${listingId}/editar`);
  }
  return result;
}

// ---- Family edit (User Products: every variant on the same page) ----

const familySchema = z.object({
  members: z
    .array(z.object({ listingId: z.uuid(), label: z.string().max(200), payload: payloadSchema }))
    .max(30),
  newVariants: z.array(variantSchema).max(20),
});

export type FamilyInput = z.infer<typeof familySchema>;

export type FamilyMemberOutcome = { listingId: string; label: string; result: SaveEditResult };

export type SaveFamilyResult =
  | {
      status: "done";
      members: FamilyMemberOutcome[];
      /** Null when no variant was added. */
      created: NewVariantsResult | null;
    }
  | { status: "invalid" };

/** Saves the changed variants (each one checked and recorded) and publishes the new ones. */
export async function saveFamilyAction(
  listingId: string,
  input: FamilyInput,
): Promise<SaveFamilyResult> {
  const member = await requirePermission("listings.edit");
  const parsed = familySchema.safeParse(input);
  if (!z.uuid().safeParse(listingId).success || !parsed.success) return { status: "invalid" };
  const { tdb } = await getTenantContext(member);
  const ctx = {
    tdb,
    organizationId: member.organizationId,
    userId: member.user.id,
    canClose: false,
  };

  const members: FamilyMemberOutcome[] = [];
  for (const item of parsed.data.members) {
    const { price, ...rest } = item.payload;
    const cents = price !== undefined && price.trim() !== "" ? parseBrlToCents(price) : undefined;
    if (cents === null) {
      members.push({
        listingId: item.listingId,
        label: item.label,
        result: { status: "invalid", fieldErrors: { price: "Preço inválido. Ex.: 89,90" } },
      });
      continue;
    }
    let result: SaveEditResult;
    try {
      result = await saveEdit(ctx, item.listingId, { ...rest, priceCents: cents });
    } catch (error) {
      console.error("Family member edit failed unexpectedly", {
        listingId: item.listingId,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
      result = { status: "unexpected" };
    }
    members.push({ listingId: item.listingId, label: item.label, result });
  }

  let created: NewVariantsResult | null = null;
  if (parsed.data.newVariants.length) {
    try {
      created = await publishNewVariants(ctx, listingId, parsed.data.newVariants, {
        canCreateSkus: can(member.role, "products.edit"),
      });
      if (
        (created.status === "published" || created.status === "partial") &&
        created.listingIds.length
      ) {
        // The new listings follow the ERP stock when the account syncs stock.
        const ids = created.listingIds;
        await queueStockSync(member.organizationId, () =>
          enqueueForListings(tdb, member.organizationId, ids),
        );
      }
    } catch (error) {
      console.error("Publishing new variants failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
      created = { status: "marketplace_error" };
    }
  }
  revalidatePath("/anuncios");
  revalidatePath(`/anuncios/${listingId}/editar`);
  return { status: "done", members, created };
}

/** Picture of a new variant, uploaded with the account of the listing. */
export async function uploadFamilyPictureAction(listingId: string, formData: FormData) {
  const member = await requirePermission("listings.edit");
  const file = formData.get("file");
  if (!z.uuid().safeParse(listingId).success || !(file instanceof Blob)) {
    return { status: "invalid" } as const;
  }
  const { tdb } = await getTenantContext(member);
  return uploadFamilyPicture(
    { tdb, organizationId: member.organizationId, userId: member.user.id },
    listingId,
    file,
    file instanceof File ? file.name : "foto.jpg",
  );
}
