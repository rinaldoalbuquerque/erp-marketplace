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
  variantLabel,
  variantListing,
} from "@/domain/listings/canonical";
import { isValidGtin } from "@/domain/products/gtin";
import { normalizeSkuCode } from "@/domain/products/schemas";
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
      targetFamilyId: true,
      publishedVariants: true,
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
      supplierUrl: true,
      sku: {
        select: {
          id: true,
          productId: true,
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

/** Drafts that may be deleted: all but the ones being published right now. */
const DELETABLE = [...EDITABLE, "published"] as const;

export async function deleteDraft(tdb: TenantDb, draftId: string): Promise<boolean> {
  return (await deleteDrafts(tdb, [draftId])) > 0;
}

/** Deletes drafts (never one in "publishing"); the published listings stay in Anúncios. */
export async function deleteDrafts(tdb: TenantDb, draftIds: string[]): Promise<number> {
  if (draftIds.length === 0) return 0;
  const removed = await tdb.listingDraft.deleteMany({
    where: { id: { in: draftIds }, status: { in: [...DELETABLE] } },
  });
  return removed.count;
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

/** What gets published: the listing itself, or one listing per variant. */
type Unit = { key: string; label: string; listing: CanonicalListing; skuId: string | null };

type PublishedVariant = { externalId: string; listingId: string | null; familyId: string | null };
type PublishedMap = Record<string, PublishedVariant>;

function unitsOf(listing: CanonicalListing, draftSkuId: string | null): Unit[] {
  if (listing.variants.length === 0) {
    return [{ key: "", label: "", listing, skuId: draftSkuId }];
  }
  return listing.variants.map((variant, index) => ({
    key: variant.key,
    label: variantLabel(variant, index),
    listing: variantListing(listing, variant),
    skuId: variant.skuId,
  }));
}

const prefixed = (label: string, messages: string[]) =>
  label ? messages.map((message) => `${label}: ${message}`) : messages;

export type CheckResult =
  | { status: "valid"; warnings: string[] }
  | { status: "incomplete"; missing: string[] }
  | { status: "refused"; errors: string[] }
  | { status: "locked" | "writes_disabled" }
  | Failure;

/** Asks the marketplace to check the draft (each variant still to publish) without publishing. */
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
  const published = draft.publishedVariants as PublishedMap;
  const warnings = new Set<string>();
  const errors: string[] = [];
  try {
    for (const unit of unitsOf(draft.listing, draft.sku?.id ?? null)) {
      if (published[unit.key]) continue;
      try {
        const result = await market.connector.validateListing(
          market.token,
          unit.listing,
          draft.model,
        );
        result.warnings.forEach((warning) => warnings.add(warning));
      } catch (error) {
        if (!(error instanceof MarketplaceValidationError)) throw error;
        errors.push(...prefixed(unit.label, error.causes));
      }
    }
  } catch (error) {
    return failureOf(error);
  }
  await ctx.tdb.listingDraft.updateMany({
    where: { id: draftId, status: { in: [...EDITABLE] } },
    data: errors.length
      ? { status: "failed", lastErrors: errors }
      : { status: "validated", lastErrors: [] },
  });
  return errors.length
    ? { status: "refused", errors }
    : { status: "valid", warnings: [...warnings] };
}

export type VariantOutcome = {
  label: string;
  status: "published" | "already" | "refused" | "unconfirmed" | "not_sent";
  externalId?: string;
  error?: string;
};

export type PublishResult =
  | {
      status: "published";
      /** First listing (the only one for a simple listing). */
      listingId: string;
      externalId: string;
      /** Every listing created by this draft (one per variant). */
      listingIds: string[];
      descriptionFailed: boolean;
      /** Did the marketplace keep the listings in one (or the expected) family? */
      family: "same" | "different" | "unknown" | null;
      variants: VariantOutcome[];
    }
  | {
      /** Some variants published, others not (fix and publish again: only the rest goes). */
      status: "partial";
      listingIds: string[];
      variants: VariantOutcome[];
      family: "same" | "different" | "unknown" | null;
    }
  | { status: "incomplete"; missing: string[] }
  | { status: "refused"; errors: string[] }
  | { status: "unconfirmed" }
  | { status: "locked" | "writes_disabled" }
  | Failure;

const UNCONFIRMED =
  "O Mercado Livre não confirmou a publicação. Confira em Anúncios (ou no ML) antes de publicar de novo.";

function familyCheck(
  familyIds: Array<string | null>,
  target: string | null,
  isFamily: boolean,
): "same" | "different" | "unknown" | null {
  if (!target && !isFamily) return null;
  if (familyIds.length === 0) return null;
  if (familyIds.some((id) => !id)) return "unknown";
  const reference = target ?? familyIds[0];
  return familyIds.every((id) => id === reference) ? "same" : "different";
}

/**
 * Publishes the draft: the listing, or each variant still unpublished as its own
 * listing of the same family. Each one is sent once (claim + record right after
 * it is created; the create call is never retried automatically). Then imports,
 * links each listing to its SKU and sends the description.
 */
export async function publishDraft(
  ctx: Ctx,
  draftId: string,
  deps: DraftDeps = {},
  options: { canCreateSkus?: boolean } = {},
): Promise<PublishResult> {
  const market = await marketplaceFor(ctx, draftId, deps);
  if (market.status !== "ok") return market;
  const { draft, connector, token } = market;
  if (!draft.account.allowWrites) return { status: "writes_disabled" };
  if (!draft.editable) return { status: "locked" };
  const missing = missingForPublish(draft.listing, draft.model);
  for (const code of invalidSkuCodes(draft.listing)) {
    missing.push(`SKU ${code}: use letras, números e - _ . / (sem espaços nem acentos)`);
  }
  if (missing.length) return { status: "incomplete", missing };

  // Claim: only one publish per draft, even with two clicks.
  const claimed = await ctx.tdb.listingDraft.updateMany({
    where: { id: draftId, status: { in: [...EDITABLE] } },
    data: { status: "publishing", lastErrors: [] },
  });
  if (claimed.count !== 1) return { status: "locked" };

  // SKU codes typed on the form -> ERP SKUs (created when new), saved with the draft.
  const typed = await resolveTypedSkus(ctx, draft, options.canCreateSkus ?? true);
  if (typed.errors.length) {
    await ctx.tdb.listingDraft.updateMany({
      where: { id: draftId, status: "publishing" },
      data: { status: "failed", lastErrors: typed.errors },
    });
    return { status: "incomplete", missing: typed.errors };
  }
  await ctx.tdb.listingDraft.updateMany({
    where: { id: draftId },
    data: { content: json(typed.listing), skuId: typed.draftSkuId },
  });

  const published: PublishedMap = { ...(draft.publishedVariants as PublishedMap) };
  const units = unitsOf(typed.listing, typed.draftSkuId);
  const outcomes: VariantOutcome[] = [];
  let descriptionFailed = false;
  let stopped = false;

  for (const unit of units) {
    if (published[unit.key]) {
      outcomes.push({
        label: unit.label,
        status: "already",
        externalId: published[unit.key]!.externalId,
      });
      continue;
    }
    if (stopped) {
      outcomes.push({ label: unit.label, status: "not_sent" });
      continue;
    }
    let created;
    try {
      created = await connector.publishListing(token, unit.listing, draft.model);
    } catch (error) {
      if (error instanceof MarketplaceValidationError) {
        outcomes.push({ label: unit.label, status: "refused", error: error.causes.join(" ") });
        continue;
      }
      if (error instanceof MarketplaceApiError) {
        // Lost answer: stop here, so nothing is sent twice by a retry.
        outcomes.push({ label: unit.label, status: "unconfirmed", error: UNCONFIRMED });
        stopped = true;
        continue;
      }
      await ctx.tdb.listingDraft.updateMany({
        where: { id: draftId, status: "publishing" },
        data: { status: "failed", lastErrors: ["Erro inesperado."], publishedVariants: published },
      });
      return failureOf(error);
    }

    // Recorded at once: from here on, nothing may send this variant again.
    published[unit.key] = {
      externalId: created.externalId,
      listingId: null,
      familyId: created.familyId,
    };
    await ctx.tdb.listingDraft.updateMany({
      where: { id: draftId },
      data: { publishedVariants: published },
    });

    if (unit.listing.description.trim()) {
      try {
        await connector.updateListingDescription(
          token,
          created.externalId,
          unit.listing.description,
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
      published[unit.key] = { ...published[unit.key]!, listingId: local.id };
      if (unit.skuId) {
        await ctx.tdb.skuListingMapping.upsert({
          where: { listingId_variationKey: { listingId: local.id, variationKey: "" } },
          create: {
            organizationId: ctx.organizationId,
            skuId: unit.skuId,
            listingId: local.id,
            variationKey: "",
            createdById: ctx.userId,
          },
          update: { skuId: unit.skuId },
        });
      }
    }
    outcomes.push({ label: unit.label, status: "published", externalId: created.externalId });
  }

  const done = units.filter((unit) => published[unit.key]);
  const first = done[0] ? published[done[0].key]! : null;
  const listingIds = done
    .map((unit) => published[unit.key]!.listingId)
    .filter((id): id is string => Boolean(id));
  const errors = outcomes
    .filter((outcome) => outcome.error)
    .map((outcome) => (outcome.label ? `${outcome.label}: ${outcome.error}` : outcome.error!));
  const allDone = done.length === units.length;
  await ctx.tdb.listingDraft.updateMany({
    where: { id: draftId },
    data: {
      status: allDone ? "published" : "failed",
      lastErrors: errors,
      publishedVariants: published,
      ...(first
        ? { externalId: first.externalId, listingId: first.listingId, publishedAt: new Date() }
        : {}),
    },
  });

  const family = familyCheck(
    done.map((unit) => published[unit.key]!.familyId),
    draft.targetFamilyId,
    units.length > 1,
  );
  if (allDone && first) {
    return {
      status: "published",
      listingId: first.listingId ?? "",
      externalId: first.externalId,
      listingIds,
      descriptionFailed,
      family,
      variants: units.length > 1 ? outcomes : [],
    };
  }
  if (done.length > 0) return { status: "partial", listingIds, variants: outcomes, family };
  // Nothing published at all: same answers as a simple listing.
  if (outcomes.some((outcome) => outcome.status === "unconfirmed"))
    return { status: "unconfirmed" };
  return { status: "refused", errors };
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

/** "Nova variação": the family the draft must join (varying attributes), read at the marketplace. */
export async function draftFamily(ctx: Ctx, draftId: string, deps: DraftDeps = {}) {
  const draft = await ctx.tdb.listingDraft.findFirst({
    where: { id: draftId },
    select: { targetFamilyId: true },
  });
  if (!draft?.targetFamilyId) return null;
  const market = await marketplaceFor(ctx, draftId, deps);
  if (market.status !== "ok") return null;
  try {
    return await market.connector.getFamily(market.token, draft.targetFamilyId);
  } catch {
    return null;
  }
}

/** Uploads a picture for a variant row (the form keeps it and saves it with the draft). */
export async function uploadVariantPicture(
  ctx: Ctx,
  draftId: string,
  file: Blob,
  filename: string,
  deps: DraftDeps = {},
): Promise<
  | { status: "ok"; picture: { id: string; url: string | null } }
  | Failure
  | { status: "locked" | "invalid" }
> {
  if (file.size === 0 || file.size > MAX_PICTURE_BYTES) return { status: "invalid" };
  const market = await marketplaceFor(ctx, draftId, deps);
  if (market.status !== "ok") return market;
  if (!market.draft.editable) return { status: "locked" };
  try {
    return {
      status: "ok",
      picture: await market.connector.uploadPicture(market.token, file, filename),
    };
  } catch (error) {
    if (error instanceof MarketplaceValidationError) return { status: "invalid" };
    return failureOf(error);
  }
}

// ---- SKUs typed on the listing form (created in the ERP when new) ----

const SKU_CODE = /^[A-Z0-9][A-Z0-9._\-/]*$/;

/** Friendly names for the variation of an auto-created SKU (else the attribute id). */
const VARIATION_NAMES: Record<string, string> = {
  COLOR: "Cor",
  SIZE: "Tamanho",
  VOLTAGE: "Voltagem",
  CAPACITY: "Capacidade",
  FLAVOR: "Sabor",
};

type SkuPlan = {
  code: string;
  gtin: string | null;
  pkg: CanonicalListing["package"];
  variation: Array<{ name: string; value: string }>;
};

/** Codes typed on the form that are invalid (checked before publishing). */
export function invalidSkuCodes(listing: CanonicalListing): string[] {
  const codes = [listing.skuCode, ...listing.variants.map((variant) => variant.skuCode)]
    .filter((code): code is string => Boolean(code && code.trim()))
    .map(normalizeSkuCode);
  return codes.filter((code) => !SKU_CODE.test(code));
}

/**
 * Links each typed SKU code to an ERP SKU, creating it (in the product of the
 * draft, or a new product named after the family) when it does not exist.
 * Returns the listing with skuIds filled and the SKU of a simple listing.
 */
async function resolveTypedSkus(
  ctx: Ctx,
  draft: NonNullable<Awaited<ReturnType<typeof loadDraft>>>,
  canCreate: boolean,
): Promise<{ listing: CanonicalListing; draftSkuId: string | null; errors: string[] }> {
  const listing: CanonicalListing = {
    ...draft.listing,
    variants: draft.listing.variants.map((variant) => ({ ...variant })),
  };
  const errors: string[] = [];
  let productId: string | null = draft.sku?.productId ?? null;
  if (!productId) {
    const linked = listing.variants
      .map((variant) => variant.skuId)
      .filter((id): id is string => Boolean(id));
    if (linked.length) {
      const sku = await ctx.tdb.sku.findFirst({
        where: { id: { in: linked } },
        select: { productId: true },
      });
      productId = sku?.productId ?? null;
    }
  }

  async function ensure(plan: SkuPlan): Promise<string | null> {
    const existing = await ctx.tdb.sku.findFirst({
      where: { code: plan.code },
      select: { id: true },
    });
    if (existing) return existing.id;
    if (!canCreate) {
      errors.push(`SKU ${plan.code} não existe no ERP e seu perfil não pode criar produtos.`);
      return null;
    }
    if (!productId) {
      const brand = listing.attributes.find((attribute) => attribute.id === "BRAND")?.valueName;
      const product = await ctx.tdb.product.create({
        data: {
          organizationId: ctx.organizationId,
          name: (listing.familyName || listing.title || plan.code).slice(0, 200),
          brand: brand ?? null,
        },
        select: { id: true },
      });
      productId = product.id;
    }
    // EAN is unique in the ERP: when another SKU already has it, create without it.
    const ean = plan.gtin && isValidGtin(plan.gtin) ? plan.gtin : null;
    const eanTaken = ean
      ? Boolean(await ctx.tdb.sku.findFirst({ where: { ean }, select: { id: true } }))
      : false;
    const sku = await ctx.tdb.sku.create({
      data: {
        organizationId: ctx.organizationId,
        productId,
        code: plan.code,
        ean: eanTaken ? null : ean,
        variation: plan.variation.length ? plan.variation : undefined,
        weightGrams: plan.pkg.weightG,
        heightCm: plan.pkg.heightCm,
        widthCm: plan.pkg.widthCm,
        lengthCm: plan.pkg.lengthCm,
      },
      select: { id: true },
    });
    return sku.id;
  }

  let draftSkuId = draft.sku?.id ?? null;
  if (listing.variants.length === 0) {
    const code = listing.skuCode ? normalizeSkuCode(listing.skuCode) : null;
    if (code && code !== draft.sku?.code) {
      const gtin = listing.attributes.find((attribute) => attribute.id === "GTIN")?.valueName;
      draftSkuId =
        (await ensure({ code, gtin: gtin ?? null, pkg: listing.package, variation: [] })) ??
        draftSkuId;
    }
  } else {
    for (const variant of listing.variants) {
      if (!variant.skuCode?.trim()) continue;
      const code = normalizeSkuCode(variant.skuCode);
      const current = variant.skuId
        ? await ctx.tdb.sku.findFirst({ where: { id: variant.skuId }, select: { code: true } })
        : null;
      if (current?.code === code) continue;
      variant.skuId =
        (await ensure({
          code,
          gtin: variant.gtin,
          pkg: variantListing(listing, variant).package,
          variation: variant.attributes
            .filter((attribute) => attribute.valueName)
            .map((attribute) => ({
              name: VARIATION_NAMES[attribute.id] ?? attribute.id,
              value: attribute.valueName!,
            })),
        })) ?? variant.skuId;
    }
  }
  return { listing, draftSkuId, errors };
}

/** Supplier link (internal note) and target account of an editable draft. */
export async function saveDraftMeta(
  tdb: TenantDb,
  draftId: string,
  meta: { supplierUrl: string | null; accountId: string },
): Promise<"saved" | "locked" | "account_unavailable"> {
  const draft = await tdb.listingDraft.findFirst({
    where: { id: draftId },
    select: { status: true, publishedVariants: true, marketplaceAccountId: true },
  });
  if (!draft || !(EDITABLE as readonly string[]).includes(draft.status)) return "locked";
  const anyPublished = Object.keys((draft.publishedVariants ?? {}) as object).length > 0;
  const accountChanged = meta.accountId !== draft.marketplaceAccountId;
  if (accountChanged) {
    if (anyPublished) return "locked";
    const account = await tdb.marketplaceAccount.findFirst({
      where: { id: meta.accountId, status: "active" },
      select: { id: true },
    });
    if (!account) return "account_unavailable";
  }
  await tdb.listingDraft.updateMany({
    where: { id: draftId, status: { in: [...EDITABLE] } },
    data: {
      supplierUrl: meta.supplierUrl,
      marketplaceAccountId: meta.accountId,
      ...(accountChanged ? { status: "draft" as const } : {}),
    },
  });
  return "saved";
}
