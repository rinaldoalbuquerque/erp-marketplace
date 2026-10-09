import "server-only";

import {
  MarketplaceApiError,
  MarketplaceAuthError,
  type MarketplaceConnector,
  type MarketplaceId,
  type MarketplaceListing,
} from "@/connectors/types";
import { db } from "@/server/db";
import { getConnector } from "@/server/marketplaces/config";
import {
  getAccessToken,
  ReconnectRequiredError,
  type TokenDeps,
} from "@/server/marketplaces/token-service";
import { tenantDb, type TenantDb } from "@/server/tenant/tenant-db";

import { Prisma } from "@/generated/prisma/client";

// Listing import as a background job (CLAUDE.md: batch operations with
// progress, retry, report and idempotency), without extra infrastructure yet:
// - a `sync_jobs` row holds status, counters, report and the ids still to do;
// - each "round" runs after the HTTP response (next/server `after`) until a
//   time budget, then stops as `paused`; the next round resumes from pendingIds;
// - only one round per job runs at a time (atomic claim + heartbeat);
// - listings are upserted by (account, external id): running twice never duplicates.
// The real queue (pg-boss or a hosted service) is decided in Phase 2D.

/** Ids read per step (the connector batches calls internally). */
export const IMPORT_STEP = 20;
/** A running round that stopped reporting for this long is considered dead. */
export const STALE_AFTER_MS = 2 * 60 * 1000;
/** Keep at most this many error lines in the report. */
const MAX_REPORTED_ERRORS = 50;

export type ImportDeps = TokenDeps & {
  now?: () => Date;
  connectorFor?: (marketplace: MarketplaceId) => MarketplaceConnector;
};

const ACTIVE_STATUSES = ["queued", "running", "paused"] as const;

export type StartImportResult =
  | { status: "started" | "resumed" | "already_running"; jobId: string }
  | { status: "account_unavailable" };

/**
 * Creates the import job for an account, or returns the unfinished one (one
 * import per account at a time, enforced under a per-account lock).
 */
export async function startImport(
  organizationId: string,
  accountId: string,
  startedById: string | null,
  deps: ImportDeps = {},
): Promise<StartImportResult> {
  const now = deps.now ?? (() => new Date());
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`listing-import:${accountId}`}))`;

    const account = await tx.marketplaceAccount.findFirst({
      where: { id: accountId, organizationId, status: "active" },
      select: { id: true },
    });
    if (!account) return { status: "account_unavailable" } as const;

    const open = await tx.syncJob.findFirst({
      where: {
        organizationId,
        marketplaceAccountId: accountId,
        type: "import_listings",
        status: { in: [...ACTIVE_STATUSES] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, heartbeatAt: true },
    });
    if (open) {
      const alive =
        open.status === "running" &&
        open.heartbeatAt !== null &&
        now().getTime() - open.heartbeatAt.getTime() < STALE_AFTER_MS;
      return { status: alive ? "already_running" : "resumed", jobId: open.id } as const;
    }

    const job = await tx.syncJob.create({
      data: {
        organizationId,
        marketplaceAccountId: accountId,
        type: "import_listings",
        startedById,
        startedAt: now(),
      },
      select: { id: true },
    });
    return { status: "started", jobId: job.id } as const;
  });
}

/** Atomically takes the job for this round. False if another round holds it. */
async function claim(organizationId: string, jobId: string, now: Date): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);
  const claimed = await db.syncJob.updateMany({
    where: {
      id: jobId,
      organizationId,
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

type ReportError = { id: string; message: string };

/**
 * Saves one listing and its variations (idempotent). Returns whether it was new.
 * Also used after an edit to refresh the local copy (edit-service.ts).
 */
export async function saveListing(
  tdb: TenantDb,
  organizationId: string,
  accountId: string,
  marketplace: MarketplaceId,
  listing: MarketplaceListing,
  syncedAt: Date,
): Promise<"created" | "updated"> {
  const data = {
    marketplace,
    title: listing.title,
    status: listing.status,
    subStatus: listing.subStatus,
    priceCents: listing.priceCents,
    currency: listing.currency,
    availableQuantity: listing.availableQuantity,
    soldQuantity: listing.soldQuantity,
    permalink: listing.permalink,
    thumbnailUrl: listing.thumbnailUrl,
    categoryId: listing.categoryId,
    listingTypeId: listing.listingTypeId,
    condition: listing.condition,
    listingModel: listing.listingModel,
    userProductId: listing.userProductId,
    familyId: listing.familyId,
    familyName: listing.familyName,
    sellerSku: listing.sellerSku,
    logisticType: listing.logisticType,
    externalUpdatedAt: listing.externalUpdatedAt,
    raw: (listing.raw ?? {}) as Prisma.InputJsonValue,
    syncedAt,
  };

  return tdb.$transaction(async (tx) => {
    const key = {
      marketplaceAccountId_externalId: {
        marketplaceAccountId: accountId,
        externalId: listing.externalId,
      },
    };
    const existing = await tx.listing.findUnique({ where: key, select: { id: true } });
    const saved = await tx.listing.upsert({
      where: key,
      create: {
        organizationId,
        marketplaceAccountId: accountId,
        externalId: listing.externalId,
        ...data,
      },
      update: data,
      select: { id: true },
    });

    // Variations: remove the ones that no longer exist, upsert the rest.
    const keep = listing.variations.map((variation) => variation.externalId);
    await tx.listingVariation.deleteMany({
      where: { listingId: saved.id, externalId: { notIn: keep } },
    });
    for (const variation of listing.variations) {
      const variationData = {
        attributes: variation.attributes as Prisma.InputJsonValue,
        priceCents: variation.priceCents,
        availableQuantity: variation.availableQuantity,
        soldQuantity: variation.soldQuantity,
        sellerSku: variation.sellerSku,
      };
      await tx.listingVariation.upsert({
        where: {
          listingId_externalId: { listingId: saved.id, externalId: variation.externalId },
        },
        create: {
          organizationId,
          listingId: saved.id,
          externalId: variation.externalId,
          ...variationData,
        },
        update: variationData,
      });
    }
    return existing ? "updated" : "created";
  });
}

export type RoundResult = "completed" | "paused" | "failed" | "busy" | "not_found";

/**
 * Runs one round of an import job until it finishes or `deadline` passes.
 * Safe to call concurrently: only the round that claims the job does work.
 */
export async function runImportRound(
  organizationId: string,
  jobId: string,
  deadline: Date,
  deps: ImportDeps = {},
): Promise<RoundResult> {
  const now = deps.now ?? (() => new Date());
  const connectorFor = deps.connectorFor ?? getConnector;

  const job = await db.syncJob.findFirst({
    where: { id: jobId, organizationId },
    select: {
      marketplaceAccountId: true,
      pendingIds: true,
      errors: true,
      account: { select: { marketplace: true, externalUserId: true } },
    },
  });
  if (!job) return "not_found";
  if (!(await claim(organizationId, jobId, now()))) return "busy";

  const tdb = tenantDb(organizationId);
  const accountId = job.marketplaceAccountId;
  const connector = connectorFor(job.account.marketplace);
  const token = () => getAccessToken(organizationId, accountId, deps);
  const errors = (Array.isArray(job.errors) ? job.errors : []) as ReportError[];

  try {
    let pending = Array.isArray(job.pendingIds) ? (job.pendingIds as string[]) : null;
    if (pending === null) {
      pending = await connector.listListingIds(await token(), job.account.externalUserId);
      await db.syncJob.update({
        where: { id: jobId },
        data: { pendingIds: pending, total: pending.length, heartbeatAt: now() },
      });
    }

    while (pending.length > 0) {
      if (now() >= deadline) {
        await db.syncJob.update({ where: { id: jobId }, data: { status: "paused" } });
        return "paused";
      }
      const batch = pending.slice(0, IMPORT_STEP);
      const results = await connector.getListings(await token(), batch);
      const syncedAt = now();
      let created = 0;
      let updated = 0;
      let failed = 0;
      for (const result of results) {
        if ("error" in result) {
          failed++;
          if (errors.length < MAX_REPORTED_ERRORS) {
            errors.push({ id: result.externalId, message: result.error });
          }
          continue;
        }
        const outcome = await saveListing(
          tdb,
          organizationId,
          accountId,
          job.account.marketplace,
          result.listing,
          syncedAt,
        );
        if (outcome === "created") created++;
        else updated++;
      }
      pending = pending.slice(batch.length);
      await db.syncJob.update({
        where: { id: jobId },
        data: {
          pendingIds: pending,
          processed: { increment: batch.length },
          createdCount: { increment: created },
          updatedCount: { increment: updated },
          failedCount: { increment: failed },
          errors: errors as Prisma.InputJsonValue,
          heartbeatAt: now(),
        },
      });
    }

    const finishedAt = now();
    await db.$transaction([
      db.syncJob.update({
        where: { id: jobId },
        data: { status: "completed", pendingIds: [], finishedAt },
      }),
      db.marketplaceAccount.updateMany({
        where: { id: accountId, organizationId },
        data: { lastSyncAt: finishedAt },
      }),
    ]);
    return "completed";
  } catch (error) {
    const reconnect =
      error instanceof ReconnectRequiredError || error instanceof MarketplaceAuthError;
    const message = reconnect
      ? "O Mercado Livre não aceita mais a autorização. Reconecte a conta e importe de novo."
      : error instanceof MarketplaceApiError
        ? "O Mercado Livre não respondeu. A importação parou e pode ser retomada."
        : "Erro inesperado na importação. Ela pode ser retomada.";
    if (!(error instanceof MarketplaceApiError) && !reconnect) {
      console.error("Listing import failed", {
        jobId,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    await db.syncJob.update({
      where: { id: jobId },
      // Network/API problems pause (resumable); a lost authorization fails.
      data: { status: reconnect ? "failed" : "paused", lastError: message },
    });
    return reconnect ? "failed" : "paused";
  }
}

/** Latest import job of each account (for progress on the page). */
export async function latestImportJobs(tdb: TenantDb) {
  const jobs = await tdb.syncJob.findMany({
    where: { type: "import_listings" },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      marketplaceAccountId: true,
      status: true,
      total: true,
      processed: true,
      createdCount: true,
      updatedCount: true,
      failedCount: true,
      errors: true,
      lastError: true,
      heartbeatAt: true,
      finishedAt: true,
      createdAt: true,
    },
  });
  const latest = new Map<string, (typeof jobs)[number]>();
  for (const job of jobs) {
    if (!latest.has(job.marketplaceAccountId)) latest.set(job.marketplaceAccountId, job);
  }
  return latest;
}
