import "server-only";

import {
  MarketplaceApiError,
  MarketplaceAuthError,
  MarketplaceValidationError,
  type CategorySuggestion,
  type FeeQuote,
  type MarketplaceConnector,
  type MarketplaceId,
} from "@/connectors/types";
import type { AttributeDefinition } from "@/domain/listings/attributes";
import {
  canonicalListingSchema,
  emptyListing,
  LISTING_TYPES,
  listingFromSku,
  missingForPublish,
  type CanonicalListing,
  type PublishModel,
} from "@/domain/listings/canonical";
import { getConnector } from "@/server/marketplaces/config";
import {
  getAccessToken,
  ReconnectRequiredError,
  type TokenDeps,
} from "@/server/marketplaces/token-service";
import type { TenantDb } from "@/server/tenant/tenant-db";

import type { Prisma } from "@/generated/prisma/client";

import { categoryAttributes } from "./categories";
import { saveListing } from "./import-service";

// New listings (Phase 2C): drafts in the canonical model, published to one
// marketplace account. Safety:
// - publishing needs the account switch allowWrites (like editing);
// - a draft is published once: an atomic claim moves it to "publishing", and
//   the create call is never retried automatically (no duplicate listings);
// - after publishing, the listing is imported, linked to the SKU and its stock
//   follows the ERP (the caller queues the stock sync).

export type DraftDeps = TokenDeps & {
  connectorFor?: (marketplace: MarketplaceId) => MarketplaceConnector;
};

type Ctx = { tdb: TenantDb; organizationId: string; userId: string | null };

const EDITABLE = ["draft", "validated", "failed"] as const;

function parseContent(content: unknown): CanonicalListing {
  const parsed = canonicalListingSchema.safeParse(content);
  return parsed.success ? parsed.data : emptyListing();
}

const json = (listing: CanonicalListing) => listing as unknown as Prisma.InputJsonValue;

function publishModel(listingModel: string): PublishModel {
  return listingModel === "user_products" ? "user_products" : "traditional";
}

export type CreateDraftResult =
  { status: "created"; draftId: string } | { status: "account_unavailable" | "sku_not_found" };

/** New draft for an account, pre-filled from a SKU when given. */
export async function createDraft(
  ctx: Ctx,
  input: { accountId: string; skuId: string | null },
): Promise<CreateDraftResult> {
  const account = await ctx.tdb.marketplaceAccount.findFirst({
    where: { id: input.accountId, status: "active" },
    select: { id: true },
  });
  if (!account) return { status: "account_unavailable" };

  let content = emptyListing();
  if (input.skuId) {
    const sku = await ctx.tdb.sku.findFirst({
      where: { id: input.skuId },
      select: {
        ean: true,
        stockOnHand: true,
        product: { select: { name: true, description: true, brand: true } },
      },
    });
    if (!sku) return { status: "sku_not_found" };
    content = listingFromSku({
      productName: sku.product.name,
      productDescription: sku.product.description,
      brand: sku.product.brand,
      ean: sku.ean,
      stockOnHand: sku.stockOnHand,
    });
  }
  const draft = await ctx.tdb.listingDraft.create({
    data: {
      organizationId: ctx.organizationId,
      marketplaceAccountId: input.accountId,
      skuId: input.skuId,
      content: json(content),
      createdById: ctx.userId,
    },
    select: { id: true },
  });
  return { status: "created", draftId: draft.id };
}

/** A draft with its parsed content and what the form needs. */
export async function loadDraft(tdb: TenantDb, draftId: string) {
  const draft = await tdb.listingDraft.findFirst({
    where: { id: draftId },
    select: {
      id: true,
      status: true,
      content: true,
      lastErrors: true,
      externalId: true,
      listingId: true,
      publishedAt: true,
      updatedAt: true,
      sourceKind: true,
      sourceExternalId: true,
      account: {
        select: {
          id: true,
          nickname: true,
          marketplace: true,
          listingModel: true,
          allowWrites: true,
          status: true,
        },
      },
      sku: {
        select: {
          id: true,
          code: true,
          costCents: true,
          stockOnHand: true,
          product: { select: { name: true } },
        },
      },
    },
  });
  if (!draft) return null;
  return {
    ...draft,
    listing: parseContent(draft.content),
    model: publishModel(draft.account.listingModel),
    editable: (EDITABLE as readonly string[]).includes(draft.status),
  };
}

export type SaveDraftResult = "saved" | "not_found" | "locked" | "invalid";

/** Saves the form. Any change invalidates a previous validation. */
export async function saveDraftContent(
  tdb: TenantDb,
  draftId: string,
  listing: CanonicalListing,
): Promise<SaveDraftResult> {
  const parsed = canonicalListingSchema.safeParse(listing);
  if (!parsed.success) return "invalid";
  const updated = await tdb.listingDraft.updateMany({
    where: { id: draftId, status: { in: [...EDITABLE] } },
    data: { content: json(parsed.data), status: "draft", lastErrors: [] },
  });
  if (updated.count === 1) return "saved";
  return (await tdb.listingDraft.findFirst({ where: { id: draftId }, select: { id: true } }))
    ? "locked"
    : "not_found";
}

export async function deleteDraft(tdb: TenantDb, draftId: string): Promise<boolean> {
  const removed = await tdb.listingDraft.deleteMany({
    where: { id: draftId, status: { in: [...EDITABLE] } },
  });
  return removed.count > 0;
}

/** Account, connector and token for marketplace calls of a draft. */
async function marketplaceFor(ctx: Ctx, draftId: string, deps: DraftDeps) {
  const draft = await loadDraft(ctx.tdb, draftId);
  if (!draft) return { status: "not_found" } as const;
  const connector = (deps.connectorFor ?? getConnector)(draft.account.marketplace);
  try {
    const token = await getAccessToken(ctx.organizationId, draft.account.id, deps);
    return { status: "ok", draft, connector, token } as const;
  } catch (error) {
    if (error instanceof ReconnectRequiredError) return { status: "reconnect" } as const;
    throw error;
  }
}

type Failure = { status: "not_found" | "reconnect" | "marketplace_error" };

function failureOf(error: unknown): Failure {
  if (error instanceof ReconnectRequiredError || error instanceof MarketplaceAuthError) {
    return { status: "reconnect" };
  }
  if (error instanceof MarketplaceApiError) return { status: "marketplace_error" };
  throw error;
}

export async function suggestDraftCategories(
  ctx: Ctx,
  draftId: string,
  query: string,
  deps: DraftDeps = {},
): Promise<{ status: "ok"; suggestions: CategorySuggestion[] } | Failure> {
  const market = await marketplaceFor(ctx, draftId, deps);
  if (market.status !== "ok") return market;
  try {
    const suggestions = await market.connector.suggestCategories(market.token, query);
    return { status: "ok", suggestions };
  } catch (error) {
    return failureOf(error);
  }
}

export async function draftCategoryAttributes(
  ctx: Ctx,
  draftId: string,
  categoryId: string,
  deps: DraftDeps = {},
): Promise<{ status: "ok"; definitions: AttributeDefinition[] } | Failure> {
  const market = await marketplaceFor(ctx, draftId, deps);
  if (market.status !== "ok") return market;
  try {
    const definitions = await categoryAttributes(market.connector, market.token, categoryId);
    return { status: "ok", definitions };
  } catch (error) {
    return failureOf(error);
  }
}

export const MAX_PICTURE_BYTES = 10 * 1024 * 1024; // ML limit: 10 MB

export async function addDraftPicture(
  ctx: Ctx,
  draftId: string,
  file: Blob,
  filename: string,
  deps: DraftDeps = {},
): Promise<
  { status: "ok"; listing: CanonicalListing } | Failure | { status: "locked" | "invalid" }
> {
  if (file.size === 0 || file.size > MAX_PICTURE_BYTES) return { status: "invalid" };
  const market = await marketplaceFor(ctx, draftId, deps);
  if (market.status !== "ok") return market;
  if (!market.draft.editable) return { status: "locked" };
  try {
    const picture = await market.connector.uploadPicture(market.token, file, filename);
    // Re-read: the form may have saved meanwhile; append to the latest content.
    const latest = await loadDraft(ctx.tdb, draftId);
    if (!latest?.editable) return { status: "locked" };
    const listing = {
      ...latest.listing,
      pictures: [...latest.listing.pictures, picture].slice(0, 12),
    };
    await saveDraftContent(ctx.tdb, draftId, listing);
    return { status: "ok", listing };
  } catch (error) {
    if (error instanceof MarketplaceValidationError) return { status: "invalid" };
    return failureOf(error);
  }
}

export async function quoteDraftFees(
  ctx: Ctx,
  draftId: string,
  input: { categoryId: string; priceCents: number },
  deps: DraftDeps = {},
): Promise<{ status: "ok"; quotes: FeeQuote[] } | Failure> {
  const market = await marketplaceFor(ctx, draftId, deps);
  if (market.status !== "ok") return market;
  try {
    const quotes = await market.connector.quoteFees(market.token, {
      ...input,
      listingTypeIds: Object.keys(LISTING_TYPES),
    });
    return { status: "ok", quotes };
  } catch (error) {
    return failureOf(error);
  }
}

export type CheckResult =
  | { status: "valid" }
  | { status: "incomplete"; missing: string[] }
  | { status: "refused"; errors: string[] }
  | { status: "locked" | "writes_disabled" }
  | Failure;

/** Asks the marketplace to check the draft without publishing. */
export async function validateDraft(
  ctx: Ctx,
  draftId: string,
  deps: DraftDeps = {},
): Promise<CheckResult> {
  const market = await marketplaceFor(ctx, draftId, deps);
  if (market.status !== "ok") return market;
  const { draft } = market;
  if (!draft.editable) return { status: "locked" };
  const missing = missingForPublish(draft.listing, draft.model);
  if (missing.length) return { status: "incomplete", missing };
  try {
    await market.connector.validateListing(market.token, draft.listing, draft.model);
    await ctx.tdb.listingDraft.updateMany({
      where: { id: draftId, status: { in: [...EDITABLE] } },
      data: { status: "validated", lastErrors: [] },
    });
    return { status: "valid" };
  } catch (error) {
    if (error instanceof MarketplaceValidationError) {
      await ctx.tdb.listingDraft.updateMany({
        where: { id: draftId, status: { in: [...EDITABLE] } },
        data: { status: "failed", lastErrors: error.causes },
      });
      return { status: "refused", errors: error.causes };
    }
    return failureOf(error);
  }
}

export type PublishResult =
  | { status: "published"; listingId: string; externalId: string; descriptionFailed: boolean }
  | { status: "incomplete"; missing: string[] }
  | { status: "refused"; errors: string[] }
  | { status: "unconfirmed" }
  | { status: "locked" | "writes_disabled" }
  | Failure;

const UNCONFIRMED =
  "O Mercado Livre não confirmou a publicação. Confira em Anúncios (ou no ML) antes de publicar de novo.";

/** Publishes the draft once, then imports, links to the SKU and sends the description. */
export async function publishDraft(
  ctx: Ctx,
  draftId: string,
  deps: DraftDeps = {},
): Promise<PublishResult> {
  const market = await marketplaceFor(ctx, draftId, deps);
  if (market.status !== "ok") return market;
  const { draft, connector, token } = market;
  if (!draft.account.allowWrites) return { status: "writes_disabled" };
  if (!draft.editable) return { status: "locked" };
  const missing = missingForPublish(draft.listing, draft.model);
  if (missing.length) return { status: "incomplete", missing };

  // Claim: only one publish per draft, even with two clicks.
  const claimed = await ctx.tdb.listingDraft.updateMany({
    where: { id: draftId, status: { in: [...EDITABLE] } },
    data: { status: "publishing", lastErrors: [] },
  });
  if (claimed.count !== 1) return { status: "locked" };

  let created;
  try {
    created = await connector.publishListing(token, draft.listing, draft.model);
  } catch (error) {
    const refused = error instanceof MarketplaceValidationError;
    const lost = error instanceof MarketplaceApiError;
    await ctx.tdb.listingDraft.updateMany({
      where: { id: draftId, status: "publishing" },
      data: {
        status: "failed",
        lastErrors: refused ? error.causes : lost ? [UNCONFIRMED] : ["Erro inesperado."],
      },
    });
    if (refused) return { status: "refused", errors: error.causes };
    if (lost) return { status: "unconfirmed" };
    return failureOf(error);
  }

  // Published: from here on, nothing may send it again.
  await ctx.tdb.listingDraft.updateMany({
    where: { id: draftId },
    data: { status: "published", externalId: created.externalId, publishedAt: new Date() },
  });

  let descriptionFailed = false;
  if (draft.listing.description.trim()) {
    try {
      await connector.updateListingDescription(
        token,
        created.externalId,
        draft.listing.description,
        false,
      );
    } catch {
      descriptionFailed = true; // can be fixed later on the edit screen
    }
  }

  await saveListing(
    ctx.tdb,
    ctx.organizationId,
    draft.account.id,
    draft.account.marketplace,
    created,
    new Date(),
  );
  const local = await ctx.tdb.listing.findFirst({
    where: { marketplaceAccountId: draft.account.id, externalId: created.externalId },
    select: { id: true },
  });
  if (local) {
    await ctx.tdb.listingDraft.updateMany({
      where: { id: draftId },
      data: { listingId: local.id },
    });
    if (draft.sku) {
      await ctx.tdb.skuListingMapping.upsert({
        where: { listingId_variationKey: { listingId: local.id, variationKey: "" } },
        create: {
          organizationId: ctx.organizationId,
          skuId: draft.sku.id,
          listingId: local.id,
          variationKey: "",
          createdById: ctx.userId,
        },
        update: { skuId: draft.sku.id },
      });
    }
  }
  return {
    status: "published",
    listingId: local?.id ?? "",
    externalId: created.externalId,
    descriptionFailed,
  };
}

/** Drafts not published yet, newest first (Anúncios > Rascunhos). */
export function listDrafts(tdb: TenantDb, filters: { batchJobId?: string | null } = {}) {
  return tdb.listingDraft.findMany({
    where: filters.batchJobId
      ? { batchJobId: filters.batchJobId }
      : { status: { not: "published" } },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      status: true,
      content: true,
      lastErrors: true,
      updatedAt: true,
      sourceKind: true,
      sourceExternalId: true,
      account: { select: { nickname: true } },
      sku: { select: { code: true } },
    },
  });
}

export { parseContent as draftListing };
