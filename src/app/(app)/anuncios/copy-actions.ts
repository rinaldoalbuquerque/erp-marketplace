"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";

import { parseListingRef } from "@/domain/listings/copying";
import { requirePermission } from "@/server/auth/session";
import {
  batchProgress,
  runBatchRound,
  startPublish,
  startReplicate,
  type BatchProgress,
} from "@/server/listings/batch-service";
import { copyToDraft } from "@/server/listings/copy-service";
import { getTenantContext } from "@/server/tenant/tenant-db";

// Batches run AFTER the response (next/server `after`), within the page's
// maxDuration (300s on /anuncios and /anuncios/rascunhos). The open page asks
// for the next round when one stops at the time budget (batch-progress.tsx).
const ROUND_BUDGET_MS = 240_000;

function scheduleRound(organizationId: string, jobId: string) {
  const deadline = new Date(Date.now() + ROUND_BUDGET_MS);
  after(async () => {
    await runBatchRound(organizationId, jobId, deadline);
  });
}

const START_MESSAGES = {
  account_unavailable: "A conta de destino não está conectada.",
  empty: "Nada para fazer: marque ao menos um item (rascunhos já publicados não entram).",
  too_many: "No máximo 500 itens por lote.",
  many_accounts: "Marque rascunhos de uma conta por vez.",
} as const;

export type StartBatchResult = { ok: true; jobId: string } | { ok: false; message: string };

const replicateSchema = z.object({
  targetAccountId: z.uuid(),
  sourceExternalIds: z
    .array(z.string().regex(/^MLB\d{6,15}$/))
    .min(1)
    .max(500),
  percent: z.number().min(-90).max(500),
  roundTo90: z.boolean(),
  listingTypeId: z.enum(["gold_special", "gold_pro"]).nullable(),
});

export async function startReplicateAction(
  input: z.infer<typeof replicateSchema>,
): Promise<StartBatchResult> {
  const member = await requirePermission("listings.edit");
  const parsed = replicateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Dados inválidos." };
  const { targetAccountId, sourceExternalIds, percent, roundTo90, listingTypeId } = parsed.data;
  const result = await startReplicate(member.organizationId, member.user.id, {
    targetAccountId,
    sourceExternalIds,
    params: {
      price: percent !== 0 || roundTo90 ? { percent, roundTo90 } : null,
      listingTypeId,
    },
  });
  if (result.status !== "started") return { ok: false, message: START_MESSAGES[result.status] };
  scheduleRound(member.organizationId, result.jobId);
  return { ok: true, jobId: result.jobId };
}

export async function startPublishAction(draftIds: string[]): Promise<StartBatchResult> {
  const member = await requirePermission("listings.edit");
  const parsed = z.array(z.uuid()).min(1).max(500).safeParse(draftIds);
  if (!parsed.success) return { ok: false, message: "Marque ao menos um rascunho." };
  const result = await startPublish(member.organizationId, member.user.id, parsed.data);
  if (result.status !== "started") return { ok: false, message: START_MESSAGES[result.status] };
  scheduleRound(member.organizationId, result.jobId);
  return { ok: true, jobId: result.jobId };
}

export async function continueBatchAction(jobId: string): Promise<void> {
  const member = await requirePermission("listings.edit");
  if (z.uuid().safeParse(jobId).success) scheduleRound(member.organizationId, jobId);
}

export async function getBatchProgressAction(jobId: string): Promise<BatchProgress | null> {
  const member = await requirePermission("listings.edit");
  if (!z.uuid().safeParse(jobId).success) return null;
  return batchProgress(member.organizationId, jobId);
}

/** "Copiar anúncio de fora" (or one own listing): becomes a draft and opens it. */
export async function copyOneAction(formData: FormData) {
  const member = await requirePermission("listings.edit");
  const { tdb } = await getTenantContext(member);
  const ref = parseListingRef(String(formData.get("ref") ?? ""));
  const accountId = String(formData.get("accountId") ?? "");
  if (!ref) redirect("/anuncios/copiar?erro=link");
  if (!z.uuid().safeParse(accountId).success) redirect("/anuncios/copiar?erro=conta");
  const result = await copyToDraft(
    { tdb, organizationId: member.organizationId, userId: member.user.id },
    { sourceExternalId: ref, targetAccountId: accountId },
  );
  if (result.status !== "created") {
    redirect(`/anuncios/copiar?erro=${result.status}&ref=${encodeURIComponent(ref)}`);
  }
  redirect(
    result.catalogProductId
      ? `/anuncios/rascunhos/${result.draftId}?catalogo=${result.catalogProductId}`
      : `/anuncios/rascunhos/${result.draftId}`,
  );
}
