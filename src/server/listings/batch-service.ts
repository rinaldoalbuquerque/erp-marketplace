import "server-only";

import type { ListingTypeId } from "@/domain/listings/canonical";
import type { PriceOptions } from "@/domain/listings/copying";
import { db } from "@/server/db";
import { enqueueForListings, processStockPushes } from "@/server/stock-sync/push-service";
import { tenantDb } from "@/server/tenant/tenant-db";

import type { Prisma } from "@/generated/prisma/client";

import { applyBulkItem } from "./bulk-edit-service";
import { copyToDraft, type CopyDeps } from "./copy-service";
import { publishDraft } from "./draft-service";
import { STALE_AFTER_MS } from "./import-service";

// Batch operations of Phase 2D as background jobs (same model as the listing
// import: a sync_jobs row with pendingIds, rounds run with next/server `after`
// until a time budget, resumable, one round at a time). Decision 2026-10-09:
// keep this model (works on Vercel Hobby, no extra server); a real queue
// (pg-boss + worker or a hosted service) comes with the SaaS.
// - replicate_listings: pendingIds = source listing ids -> drafts of the account.
//   Idempotent: one draft per source per batch (unique index).
// - publish_drafts: pendingIds = draft ids -> publishDraft (each draft once).
// Report: createdCount = done, updatedCount = skipped (already done),
// failedCount + errors = refused / not copied, with the reason.

export type ReplicateParams = { price: PriceOptions | null; listingTypeId: ListingTypeId | null };

const MAX_ITEMS = 500;
const BATCH_TYPES: Array<"replicate_listings" | "publish_drafts" | "bulk_edit_listings"> = [
  "replicate_listings",
  "publish_drafts",
  "bulk_edit_listings",
];
const MAX_REPORTED_ERRORS = 100;

export type StartResult =
  | { status: "started"; jobId: string }
  | { status: "account_unavailable" | "empty" | "too_many" | "many_accounts" };

export async function startReplicate(
  organizationId: string,
  startedById: string | null,
  input: { targetAccountId: string; sourceExternalIds: string[]; params: ReplicateParams },
): Promise<StartResult> {
  const ids = [...new Set(input.sourceExternalIds)];
  if (ids.length === 0) return { status: "empty" };
  if (ids.length > MAX_ITEMS) return { status: "too_many" };
  const account = await db.marketplaceAccount.findFirst({
    where: { id: input.targetAccountId, organizationId, status: "active" },
    select: { id: true },
  });
  if (!account) return { status: "account_unavailable" };
  const job = await db.syncJob.create({
    data: {
      organizationId,
      marketplaceAccountId: account.id,
      type: "replicate_listings",
      pendingIds: ids,
      total: ids.length,
      params: input.params as unknown as Prisma.InputJsonValue,
      startedById,
      startedAt: new Date(),
    },
    select: { id: true },
  });
  return { status: "started", jobId: job.id };
}

export async function startPublish(
  organizationId: string,
  startedById: string | null,
  draftIds: string[],
): Promise<StartResult> {
  const ids = [...new Set(draftIds)];
  if (ids.length === 0) return { status: "empty" };
  if (ids.length > MAX_ITEMS) return { status: "too_many" };
  const drafts = await db.listingDraft.findMany({
    where: { organizationId, id: { in: ids }, status: { in: ["draft", "validated", "failed"] } },
    select: { id: true, marketplaceAccountId: true },
  });
  if (drafts.length === 0) return { status: "empty" };
  const accounts = new Set(drafts.map((draft) => draft.marketplaceAccountId));
  if (accounts.size > 1) return { status: "many_accounts" };
  const job = await db.syncJob.create({
    data: {
      organizationId,
      marketplaceAccountId: drafts[0]!.marketplaceAccountId,
      type: "publish_drafts",
      pendingIds: drafts.map((draft) => draft.id),
      total: drafts.length,
      startedById,
      startedAt: new Date(),
    },
    select: { id: true },
  });
  return { status: "started", jobId: job.id };
}

async function claim(organizationId: string, jobId: string, now: Date) {
  const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);
  const claimed = await db.syncJob.updateMany({
    where: {
      id: jobId,
      organizationId,
      type: { in: BATCH_TYPES },
      OR: [
        { status: { in: ["queued", "paused"] } },
        { status: "running", heartbeatAt: { lt: staleBefore } },
        { status: "running", heartbeatAt: null },
      ],
    },
    data: { status: "running", heartbeatAt: now, lastError: null },
  });
  return claimed.count === 1;
}

type Outcome =
  | { kind: "done" }
  | { kind: "skipped" }
  | { kind: "failed"; message: string }
  /** Stop the job: nothing else will work (authorization, account switch). */
  | { kind: "stop"; message: string }
  /** Marketplace unavailable: pause and retry this item in the next round. */
  | { kind: "retry"; message: string };

const COPY_MESSAGES = {
  has_variations: "Anúncio com variações: a conta de destino precisa usar User Products.",
  not_found: "Anúncio não encontrado no Mercado Livre.",
  not_readable: "Anúncio de outro vendedor: o Mercado Livre não permite ler.",
} as const;

const RECONNECT = "O Mercado Livre não aceita mais a autorização. Reconecte a conta.";
const UNAVAILABLE = "O Mercado Livre não respondeu. O lote continua de onde parou.";

export type RoundResult = "completed" | "paused" | "failed" | "busy" | "not_found";

/** Runs one round of a replicate/publish job until it finishes or `deadline`. */
export async function runBatchRound(
  organizationId: string,
  jobId: string,
  deadline: Date,
  deps: CopyDeps & { now?: () => Date } = {},
): Promise<RoundResult> {
  const now = deps.now ?? (() => new Date());
  const job = await db.syncJob.findFirst({
    where: { id: jobId, organizationId },
    select: {
      type: true,
      marketplaceAccountId: true,
      pendingIds: true,
      errors: true,
      params: true,
      startedById: true,
    },
  });
  if (!job) return "not_found";
  if (!(await claim(organizationId, jobId, now()))) return "busy";

  const ctx = { tdb: tenantDb(organizationId), organizationId, userId: job.startedById };
  const params = (job.params ?? { price: null, listingTypeId: null }) as ReplicateParams;
  const errors = (Array.isArray(job.errors) ? job.errors : []) as Array<{
    id: string;
    message: string;
  }>;
  let pending = Array.isArray(job.pendingIds) ? (job.pendingIds as string[]) : [];
  const publishedListings: string[] = [];

  async function process(id: string): Promise<Outcome> {
    if (job!.type === "bulk_edit_listings") return applyBulkItem(ctx, jobId, id, deps);
    if (job!.type === "replicate_listings") {
      const result = await copyToDraft(
        ctx,
        {
          sourceExternalId: id,
          targetAccountId: job!.marketplaceAccountId,
          options: params,
          batchJobId: jobId,
        },
        deps,
      );
      switch (result.status) {
        case "created":
          return { kind: "done" };
        case "duplicate":
          return { kind: "skipped" };
        case "has_variations":
        case "not_found":
        case "not_readable":
          return { kind: "failed", message: COPY_MESSAGES[result.status] };
        case "account_unavailable":
          return { kind: "stop", message: "A conta de destino não está conectada." };
        case "reconnect":
          return { kind: "stop", message: RECONNECT };
        case "marketplace_error":
          return { kind: "retry", message: UNAVAILABLE };
      }
    }
    const result = await publishDraft(ctx, id, deps);
    switch (result.status) {
      case "published":
        if (result.listingId) publishedListings.push(result.listingId);
        return { kind: "done" };
      case "locked":
        return { kind: "skipped" };
      case "incomplete":
        return { kind: "failed", message: `Falta preencher: ${result.missing.join(", ")}.` };
      case "refused":
        return { kind: "failed", message: result.errors.join(" ") };
      case "unconfirmed":
        return {
          kind: "failed",
          message: "O Mercado Livre não confirmou a publicação. Confira antes de publicar de novo.",
        };
      case "not_found":
        return { kind: "skipped" };
      case "writes_disabled":
        return { kind: "stop", message: "As alterações estão bloqueadas para esta conta." };
      case "reconnect":
        return { kind: "stop", message: RECONNECT };
      case "marketplace_error":
        return { kind: "retry", message: UNAVAILABLE };
    }
  }

  async function finishRound() {
    if (publishedListings.length) {
      // New listings follow the ERP stock when the account syncs stock.
      await enqueueForListings(ctx.tdb, organizationId, publishedListings);
      await processStockPushes(organizationId, deadline);
    }
  }

  try {
    while (pending.length > 0) {
      if (now() >= deadline) {
        await finishRound();
        await db.syncJob.update({ where: { id: jobId }, data: { status: "paused" } });
        return "paused";
      }
      const id = pending[0]!;
      const outcome = await process(id);
      if (outcome.kind === "retry" || outcome.kind === "stop") {
        await finishRound();
        await db.syncJob.update({
          where: { id: jobId },
          data: {
            status: outcome.kind === "stop" ? "failed" : "paused",
            lastError: outcome.message,
            heartbeatAt: now(),
          },
        });
        return outcome.kind === "stop" ? "failed" : "paused";
      }
      if (outcome.kind === "failed" && errors.length < MAX_REPORTED_ERRORS) {
        errors.push({ id, message: outcome.message });
      }
      pending = pending.slice(1);
      await db.syncJob.update({
        where: { id: jobId },
        data: {
          pendingIds: pending,
          processed: { increment: 1 },
          createdCount: { increment: outcome.kind === "done" ? 1 : 0 },
          updatedCount: { increment: outcome.kind === "skipped" ? 1 : 0 },
          failedCount: { increment: outcome.kind === "failed" ? 1 : 0 },
          errors: errors as Prisma.InputJsonValue,
          heartbeatAt: now(),
        },
      });
    }
    await finishRound();
    await db.syncJob.update({
      where: { id: jobId },
      data: { status: "completed", finishedAt: now() },
    });
    return "completed";
  } catch (error) {
    console.error("Batch round failed", {
      jobId,
      error: error instanceof Error ? error.message : "unknown",
    });
    await db.syncJob.update({
      where: { id: jobId },
      data: { status: "paused", lastError: "Erro inesperado. O lote pode ser retomado." },
    });
    return "paused";
  }
}

/** Progress of a batch job (for the panel). */
export async function batchProgress(organizationId: string, jobId: string) {
  const job = await db.syncJob.findFirst({
    where: { id: jobId, organizationId, type: { in: BATCH_TYPES } },
    select: {
      id: true,
      type: true,
      status: true,
      total: true,
      processed: true,
      createdCount: true,
      updatedCount: true,
      failedCount: true,
      errors: true,
      lastError: true,
      account: { select: { nickname: true } },
    },
  });
  if (!job) return null;
  return {
    jobId: job.id,
    type: job.type as (typeof BATCH_TYPES)[number],
    status: job.status,
    total: job.total,
    processed: job.processed,
    done: job.createdCount,
    skipped: job.updatedCount,
    failed: job.failedCount,
    errors: (Array.isArray(job.errors) ? job.errors : []) as Array<{ id: string; message: string }>,
    lastError: job.lastError,
    accountNickname: job.account.nickname,
  };
}

export type BatchProgress = NonNullable<Awaited<ReturnType<typeof batchProgress>>>;
