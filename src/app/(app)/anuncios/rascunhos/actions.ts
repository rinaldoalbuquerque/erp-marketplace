"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { CategorySuggestion, FeeQuote } from "@/connectors/types";
import type { AttributeDefinition } from "@/domain/listings/attributes";
import type { CanonicalListing } from "@/domain/listings/canonical";
import { requirePermission } from "@/server/auth/session";
import {
  addDraftPicture,
  createDraft,
  deleteDraft,
  draftCategoryAttributes,
  publishDraft,
  quoteDraftFees,
  saveDraftContent,
  suggestDraftCategories,
  validateDraft,
  type CheckResult,
  type PublishResult,
  type SaveDraftResult,
} from "@/server/listings/draft-service";
import { enqueueForListings } from "@/server/stock-sync/push-service";
import { queueStockSync } from "@/server/stock-sync/schedule";
import { getTenantContext } from "@/server/tenant/tenant-db";

const id = z.uuid();

async function context() {
  const member = await requirePermission("listings.edit");
  const { tdb } = await getTenantContext(member);
  return { member, ctx: { tdb, organizationId: member.organizationId, userId: member.user.id } };
}

/** Anúncios > Novo anúncio: creates the draft and opens it. */
export async function createDraftAction(formData: FormData) {
  const { ctx } = await context();
  const accountId = String(formData.get("accountId") ?? "");
  const skuId = String(formData.get("skuId") ?? "");
  if (!id.safeParse(accountId).success) redirect("/anuncios/novo?erro=conta");
  const result = await createDraft(ctx, {
    accountId,
    skuId: id.safeParse(skuId).success ? skuId : null,
  });
  if (result.status !== "created") redirect(`/anuncios/novo?erro=${result.status}`);
  redirect(`/anuncios/rascunhos/${result.draftId}`);
}

export async function saveDraftAction(
  draftId: string,
  listing: CanonicalListing,
): Promise<SaveDraftResult> {
  const { ctx } = await context();
  if (!id.safeParse(draftId).success) return "not_found";
  return saveDraftContent(ctx.tdb, draftId, listing);
}

type Failure = { status: "not_found" | "reconnect" | "marketplace_error" };

export async function suggestCategoriesAction(
  draftId: string,
  query: string,
): Promise<{ status: "ok"; suggestions: CategorySuggestion[] } | Failure> {
  const { ctx } = await context();
  if (!id.safeParse(draftId).success) return { status: "not_found" };
  return suggestDraftCategories(ctx, draftId, query.slice(0, 200));
}

export async function categoryAttributesAction(
  draftId: string,
  categoryId: string,
): Promise<{ status: "ok"; definitions: AttributeDefinition[] } | Failure> {
  const { ctx } = await context();
  if (!id.safeParse(draftId).success || !/^[A-Z]{3}\d{1,15}$/.test(categoryId)) {
    return { status: "not_found" };
  }
  return draftCategoryAttributes(ctx, draftId, categoryId);
}

export async function uploadPictureAction(draftId: string, formData: FormData) {
  const { ctx } = await context();
  const file = formData.get("file");
  if (!id.safeParse(draftId).success || !(file instanceof Blob)) {
    return { status: "invalid" } as const;
  }
  const name = file instanceof File ? file.name : "foto.jpg";
  return addDraftPicture(ctx, draftId, file, name);
}

export async function quoteFeesAction(
  draftId: string,
  categoryId: string,
  priceCents: number,
): Promise<{ status: "ok"; quotes: FeeQuote[] } | Failure> {
  const { ctx } = await context();
  if (
    !id.safeParse(draftId).success ||
    !/^[A-Z]{3}\d{1,15}$/.test(categoryId) ||
    !Number.isInteger(priceCents) ||
    priceCents <= 0
  ) {
    return { status: "not_found" };
  }
  return quoteDraftFees(ctx, draftId, { categoryId, priceCents });
}

export async function validateDraftAction(draftId: string): Promise<CheckResult> {
  const { ctx } = await context();
  if (!id.safeParse(draftId).success) return { status: "not_found" };
  const result = await validateDraft(ctx, draftId);
  revalidatePath(`/anuncios/rascunhos/${draftId}`);
  return result;
}

export async function publishDraftAction(draftId: string): Promise<PublishResult> {
  const { member, ctx } = await context();
  if (!id.safeParse(draftId).success) return { status: "not_found" };
  try {
    const result = await publishDraft(ctx, draftId);
    if (result.status === "published" && result.listingId) {
      // The new listing follows the ERP stock when the account syncs stock.
      await queueStockSync(member.organizationId, () =>
        enqueueForListings(ctx.tdb, member.organizationId, [result.listingId]),
      );
    }
    revalidatePath("/anuncios");
    revalidatePath(`/anuncios/rascunhos/${draftId}`);
    return result;
  } catch (error) {
    console.error("Publish failed", { error: error instanceof Error ? error.message : "unknown" });
    return { status: "marketplace_error" };
  }
}

export async function deleteDraftAction(draftId: string) {
  const { ctx } = await context();
  if (id.safeParse(draftId).success) await deleteDraft(ctx.tdb, draftId);
  revalidatePath("/anuncios/rascunhos");
  redirect("/anuncios/rascunhos");
}
