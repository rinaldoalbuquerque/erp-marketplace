import "server-only";

import {
  MarketplaceApiError,
  MarketplaceAuthError,
  MarketplaceValidationError,
  type CopyVariation,
  type ListingFamily,
  type ListingForCopy,
  type MarketplaceConnector,
  type MarketplaceId,
} from "@/connectors/types";
import type { AttributeValue } from "@/domain/listings/attributes";
import {
  canonicalListingSchema,
  type CanonicalListing,
  type ListingTypeId,
} from "@/domain/listings/canonical";
import { adjustPrice, type PriceOptions } from "@/domain/listings/copying";
import { getConnector } from "@/server/marketplaces/config";
import {
  getAccessToken,
  ReconnectRequiredError,
  type TokenDeps,
} from "@/server/marketplaces/token-service";
import type { TenantDb } from "@/server/tenant/tenant-db";

import { Prisma } from "@/generated/prisma/client";

import { categoryAttributes } from "./categories";

// Copy / migrate (Phase 2D) and new variations: listings become DRAFTS of a
// target account (CLAUDE.md: copies enter as drafts for review and are
// independent of the original; the origin is kept only as a reference).
// - Own listing: the copy inherits its SKU link (same stock) and, in the same
//   account, its picture ids. Other accounts / sellers get pictures by URL.
// - Attributes are kept only when the target category accepts them (not read-only).
// - Traditional listing with variations -> one draft per variation, all with the
//   same family name (User Products targets only: each variation is a listing).
// - "Nova variação": a draft of the same family with the varying attributes
//   (ML CHILD_PK) left empty for the user.

export type CopyDeps = TokenDeps & {
  connectorFor?: (marketplace: MarketplaceId) => MarketplaceConnector;
};

export type CopyOptions = {
  price?: PriceOptions | null;
  listingTypeId?: ListingTypeId | null;
};

export type CopyResult =
  | {
      status: "created";
      /** First draft (opened after a single copy). */
      draftId: string;
      /** One per variation for traditional listings with variations. */
      draftIds: string[];
      /** The pasted id was a catalog product (copied from the catalog data). */
      catalogProductId: string | null;
      copiedExternalId: string;
    }
  | {
      status:
        | "duplicate"
        /** Variations can only become listings on User Products accounts */
        | "has_variations"
        | "not_found"
        /** Another seller's listing: the marketplace does not allow reading it */
        | "not_readable"
        | "account_unavailable"
        | "reconnect"
        | "marketplace_error";
    };

type Ctx = { tdb: TenantDb; organizationId: string; userId: string | null };

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function failureOf(error: unknown): Extract<CopyResult, { status: string }> {
  if (error instanceof ReconnectRequiredError || error instanceof MarketplaceAuthError) {
    return { status: "reconnect" };
  }
  if (error instanceof MarketplaceValidationError) return { status: "not_found" };
  if (error instanceof MarketplaceApiError) {
    return error.status === 404 ? { status: "not_found" } : { status: "marketplace_error" };
  }
  throw error;
}

/** Attribute ids the target category accepts (null = unknown: keep everything). */
async function acceptedAttributes(
  connector: MarketplaceConnector,
  token: string,
  categoryId: string | null,
): Promise<Set<string> | null> {
  if (!categoryId) return null;
  try {
    const definitions = await categoryAttributes(connector, token, categoryId);
    return new Set(
      definitions.filter((definition) => !definition.readOnly).map((definition) => definition.id),
    );
  } catch (error) {
    if (error instanceof MarketplaceAuthError) throw error;
    return null; // validation will point problems
  }
}

/** Base attributes overridden by the variation's own (same id). */
function mergeAttributes(base: AttributeValue[], variation: AttributeValue[]): AttributeValue[] {
  const byId = new Map(base.map((attribute) => [attribute.id, attribute]));
  for (const attribute of variation) byId.set(attribute.id, attribute);
  return [...byId.values()];
}

const byUrl = (pictures: CanonicalListing["pictures"]) =>
  pictures
    .filter((picture) => picture.url !== null)
    .map((picture) => ({ id: null, url: picture.url }));

export async function copyToDraft(
  ctx: Ctx,
  input: {
    sourceExternalId: string;
    targetAccountId: string;
    options?: CopyOptions;
    batchJobId?: string | null;
  },
  deps: CopyDeps = {},
): Promise<CopyResult> {
  const target = await ctx.tdb.marketplaceAccount.findFirst({
    where: { id: input.targetAccountId, status: "active" },
    select: { id: true, marketplace: true, listingModel: true },
  });
  if (!target) return { status: "account_unavailable" };

  // Own listing? (any account of this organization) with its SKU links.
  const own = await ctx.tdb.listing.findFirst({
    where: { externalId: input.sourceExternalId, marketplace: target.marketplace },
    select: {
      marketplaceAccountId: true,
      variations: { select: { id: true, externalId: true } },
      mappings: {
        select: { variationKey: true, sku: { select: { id: true, stockOnHand: true } } },
      },
    },
  });
  const skuFor = (variationExternalId: string | null) => {
    if (!own) return null;
    const key = variationExternalId
      ? (own.variations.find((variation) => variation.externalId === variationExternalId)?.id ??
        "?")
      : "";
    return own.mappings.find((mapping) => mapping.variationKey === key)?.sku ?? null;
  };
  const connector = (deps.connectorFor ?? getConnector)(target.marketplace);

  try {
    // Read with the source account's token when it is ours (internal fields), else the target's.
    const readToken = await getAccessToken(
      ctx.organizationId,
      own?.marketplaceAccountId ?? target.id,
      deps,
    );
    // Listings of other sellers can no longer be read (ML answers 403). A catalog
    // product (page /p/MLB...) can: its name, pictures, sheet and description.
    const sourceExternalId = input.sourceExternalId;
    let catalogProductId: string | null = null;
    let source: ListingForCopy | null;
    try {
      source = await connector.getListingForCopy(readToken, sourceExternalId);
    } catch (error) {
      const unreadable =
        error instanceof MarketplaceValidationError ||
        (error instanceof MarketplaceApiError && (error.status === 403 || error.status === 404));
      if (!unreadable) throw error;
      source = await connector.getCatalogProductForCopy(readToken, sourceExternalId);
      if (!source) return { status: own ? "not_found" : "not_readable" };
      catalogProductId = sourceExternalId;
    }
    if (source.hasVariations && target.listingModel !== "user_products") {
      return { status: "has_variations" };
    }

    const sameAccount = own?.marketplaceAccountId === target.id;
    const targetToken = sameAccount
      ? readToken
      : await getAccessToken(ctx.organizationId, target.id, deps);
    const accepted = await acceptedAttributes(connector, targetToken, source.listing.categoryId);

    // One draft for a simple listing; one per variation otherwise.
    const units: Array<{ variation: CopyVariation | null }> = source.hasVariations
      ? source.variations.map((variation) => ({ variation }))
      : [{ variation: null }];

    const draftIds: string[] = [];
    for (const { variation } of units) {
      const listing: CanonicalListing = { ...source.listing };
      if (variation) {
        // Same family for all variations: the source title becomes the family name.
        listing.familyName = source.title.slice(0, 200);
        listing.attributes = mergeAttributes(listing.attributes, variation.attributes);
        if (variation.sellerSku) {
          listing.attributes = mergeAttributes(listing.attributes, [
            { id: "SELLER_SKU", valueId: null, valueName: variation.sellerSku },
          ]);
        }
        if (variation.priceCents !== null) listing.priceCents = variation.priceCents;
        listing.availableQuantity = variation.availableQuantity;
        if (variation.pictures.length) listing.pictures = variation.pictures;
      }
      if (!sameAccount) listing.pictures = byUrl(listing.pictures);
      if (accepted) {
        listing.attributes = listing.attributes.filter((attribute) => accepted.has(attribute.id));
      }
      if (input.options?.price && listing.priceCents !== null) {
        listing.priceCents = adjustPrice(listing.priceCents, input.options.price);
      }
      if (input.options?.listingTypeId) listing.listingTypeId = input.options.listingTypeId;
      const sku = skuFor(variation?.externalId ?? null);
      if (sku) listing.availableQuantity = Math.max(0, sku.stockOnHand);

      try {
        const draft = await ctx.tdb.listingDraft.create({
          data: {
            organizationId: ctx.organizationId,
            marketplaceAccountId: target.id,
            skuId: sku?.id ?? null,
            content: canonicalListingSchema.parse(listing) as unknown as Prisma.InputJsonValue,
            sourceKind: own ? "own" : "external",
            sourceExternalId,
            sourceVariationKey: variation?.externalId ?? "",
            sourceAccountId: own?.marketplaceAccountId ?? null,
            batchJobId: input.batchJobId ?? null,
            createdById: ctx.userId,
          },
          select: { id: true },
        });
        draftIds.push(draft.id);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error; // already copied in this batch
      }
    }
    if (draftIds.length === 0) return { status: "duplicate" };
    return {
      status: "created",
      draftId: draftIds[0]!,
      draftIds,
      catalogProductId,
      copiedExternalId: sourceExternalId,
    };
  } catch (error) {
    return failureOf(error);
  }
}

/** Attributes that identify one listing and must not be copied into a new variation. */
const PER_LISTING_ATTRIBUTES = new Set(["GTIN", "EMPTY_GTIN_REASON", "SELLER_SKU"]);

export type VariationResult =
  | { status: "created"; draftId: string; family: ListingFamily | null }
  | {
      status: "not_found" | "not_user_products" | "reconnect" | "marketplace_error";
    };

/**
 * "Nova variação": a draft in the same account and family as an own User
 * Products listing, with the varying attributes (and GTIN/SKU/pictures) empty.
 */
export async function createVariationDraft(
  ctx: Ctx,
  listingId: string,
  deps: CopyDeps = {},
): Promise<VariationResult> {
  const listing = await ctx.tdb.listing.findFirst({
    where: { id: listingId },
    select: {
      externalId: true,
      familyId: true,
      listingModel: true,
      marketplaceAccountId: true,
      account: { select: { marketplace: true, status: true } },
    },
  });
  if (!listing || listing.account.status !== "active") return { status: "not_found" };
  if (listing.listingModel !== "user_products" || !listing.familyId) {
    return { status: "not_user_products" };
  }
  const connector = (deps.connectorFor ?? getConnector)(listing.account.marketplace);
  try {
    const token = await getAccessToken(ctx.organizationId, listing.marketplaceAccountId, deps);
    const source = await connector.getListingForCopy(token, listing.externalId);
    const family = await connector.getFamily(token, listing.familyId);
    const varying = new Set(family?.childAttributeIds ?? []);
    const accepted = await acceptedAttributes(connector, token, source.listing.categoryId);

    const content: CanonicalListing = {
      ...source.listing,
      familyName: family?.familyName || source.listing.familyName,
      pictures: [],
      attributes: source.listing.attributes.filter(
        (attribute) =>
          !varying.has(attribute.id) &&
          !PER_LISTING_ATTRIBUTES.has(attribute.id) &&
          (!accepted || accepted.has(attribute.id)),
      ),
      availableQuantity: 0,
    };
    const draft = await ctx.tdb.listingDraft.create({
      data: {
        organizationId: ctx.organizationId,
        marketplaceAccountId: listing.marketplaceAccountId,
        content: canonicalListingSchema.parse(content) as unknown as Prisma.InputJsonValue,
        sourceKind: "own",
        sourceExternalId: listing.externalId,
        sourceAccountId: listing.marketplaceAccountId,
        targetFamilyId: listing.familyId,
        createdById: ctx.userId,
      },
      select: { id: true },
    });
    return { status: "created", draftId: draft.id, family };
  } catch (error) {
    const failure = failureOf(error);
    return failure.status === "reconnect" || failure.status === "marketplace_error"
      ? { status: failure.status }
      : { status: "not_found" };
  }
}
