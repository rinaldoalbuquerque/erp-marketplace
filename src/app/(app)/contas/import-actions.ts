"use server";

import { after } from "next/server";

import { requireMember, requirePermission } from "@/server/auth/session";
import { runImportRound, startImport } from "@/server/listings/import-service";
import { getTenantContext } from "@/server/tenant/tenant-db";

// Import runs AFTER the response (next/server `after`), within the page's
// maxDuration (300s on Vercel Hobby). Each round stops at ROUND_BUDGET_MS and
// the open page asks for the next round (see import-panel.tsx).
const ROUND_BUDGET_MS = 240_000;

export type ImportProgress = {
  jobId: string;
  status: "queued" | "running" | "paused" | "completed" | "failed";
  total: number | null;
  processed: number;
  createdCount: number;
  updatedCount: number;
  failedCount: number;
  errors: Array<{ id: string; message: string }>;
  lastError: string | null;
};

function scheduleRound(organizationId: string, jobId: string) {
  const deadline = new Date(Date.now() + ROUND_BUDGET_MS);
  after(async () => {
    await runImportRound(organizationId, jobId, deadline);
  });
}

export async function startImportAction(
  accountId: string,
): Promise<{ ok: true; jobId: string } | { ok: false; message: string }> {
  const member = await requirePermission("listings.edit");
  const result = await startImport(member.organizationId, accountId, member.user.id);
  if (result.status === "account_unavailable") {
    return { ok: false, message: "A conta precisa estar conectada para importar." };
  }
  if (result.status !== "already_running") scheduleRound(member.organizationId, result.jobId);
  return { ok: true, jobId: result.jobId };
}

/** Asks for the next round of a paused job (called by the open page). */
export async function continueImportAction(jobId: string): Promise<void> {
  const member = await requirePermission("listings.edit");
  scheduleRound(member.organizationId, jobId);
}

export async function getImportProgressAction(jobId: string): Promise<ImportProgress | null> {
  const member = await requireMember();
  const { tdb } = await getTenantContext(member);
  const job = await tdb.syncJob.findFirst({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      total: true,
      processed: true,
      createdCount: true,
      updatedCount: true,
      failedCount: true,
      errors: true,
      lastError: true,
    },
  });
  if (!job) return null;
  return {
    jobId: job.id,
    status: job.status,
    total: job.total,
    processed: job.processed,
    createdCount: job.createdCount,
    updatedCount: job.updatedCount,
    failedCount: job.failedCount,
    errors: (Array.isArray(job.errors) ? job.errors : []) as ImportProgress["errors"],
    lastError: job.lastError,
  };
}
