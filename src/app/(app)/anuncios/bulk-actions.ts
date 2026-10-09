"use server";

import { after } from "next/server";
import { z } from "zod";

import { bulkOperationSchema, type BulkOperation } from "@/domain/listings/bulk-edit";
import { requirePermission } from "@/server/auth/session";
import { runBatchRound } from "@/server/listings/batch-service";
import {
  bulkUndoInfo,
  MAX_BULK,
  previewBulkEdit,
  startBulkEdit,
  startUndo,
  type BulkSelection,
  type PreviewRow,
} from "@/server/listings/bulk-edit-service";
import { LISTING_STATUS_FILTERS } from "@/server/listings/queries";
import { getTenantContext } from "@/server/tenant/tenant-db";

// Bulk edit batches run AFTER the response (next/server `after`) within the
// page's maxDuration (300s on /anuncios); the progress panel asks for more rounds.
const ROUND_BUDGET_MS = 240_000;

function schedule(organizationId: string, jobIds: string[]) {
  const deadline = new Date(Date.now() + ROUND_BUDGET_MS);
  after(async () => {
    for (const jobId of jobIds) await runBatchRound(organizationId, jobId, deadline);
  });
}

const selectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ids"), listingIds: z.array(z.uuid()).min(1).max(MAX_BULK) }),
  z.object({
    kind: z.literal("filter"),
    filters: z.object({
      search: z.string().max(200).optional(),
      status: z.enum(Object.keys(LISTING_STATUS_FILTERS) as [string, ...string[]]).optional(),
      accountIds: z.array(z.uuid()).max(50).optional(),
      familyId: z.string().max(50).optional(),
    }),
  }),
]);

function parse(selection: unknown, operation: unknown) {
  const s = selectionSchema.safeParse(selection);
  const o = bulkOperationSchema.safeParse(operation);
  if (!s.success || !o.success) return null;
  return { selection: s.data as BulkSelection, operation: o.data as BulkOperation };
}

export type PreviewResult =
  | { ok: true; rows: PreviewRow[]; total: number; truncated: boolean }
  | { ok: false; message: string };

export async function previewBulkAction(
  selection: unknown,
  operation: unknown,
): Promise<PreviewResult> {
  const member = await requirePermission("listings.edit");
  const parsed = parse(selection, operation);
  if (!parsed) return { ok: false, message: "Operação inválida: confira os valores." };
  const { tdb } = await getTenantContext(member);
  const preview = await previewBulkEdit(tdb, parsed.selection, parsed.operation);
  return { ok: true, ...preview };
}

export type StartResult = { ok: true; jobIds: string[] } | { ok: false; message: string };

export async function startBulkAction(
  selection: unknown,
  operation: unknown,
): Promise<StartResult> {
  const member = await requirePermission("listings.edit");
  const parsed = parse(selection, operation);
  if (!parsed) return { ok: false, message: "Operação inválida." };
  const { tdb } = await getTenantContext(member);
  const result = await startBulkEdit(
    tdb,
    member.organizationId,
    member.user.id,
    parsed.selection,
    parsed.operation,
  );
  if (result.status !== "started") {
    return {
      ok: false,
      message: "Nada a alterar: todos os anúncios ficariam iguais ou foram pulados.",
    };
  }
  schedule(member.organizationId, result.jobIds);
  return { ok: true, jobIds: result.jobIds };
}

export async function undoBulkAction(jobId: string): Promise<StartResult> {
  const member = await requirePermission("listings.edit");
  if (!z.uuid().safeParse(jobId).success) return { ok: false, message: "Lote inválido." };
  const result = await startUndo(member.organizationId, member.user.id, jobId);
  if (result.status !== "started") return { ok: false, message: "Nada para desfazer." };
  schedule(member.organizationId, result.jobIds);
  return { ok: true, jobIds: result.jobIds };
}

export async function bulkUndoInfoAction(jobId: string) {
  const member = await requirePermission("listings.edit");
  if (!z.uuid().safeParse(jobId).success) return { canUndo: false, isUndo: false };
  return bulkUndoInfo(member.organizationId, jobId);
}
