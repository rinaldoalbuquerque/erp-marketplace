import "server-only";

import {
  MarketplaceApiError,
  MarketplaceAuthError,
  MarketplaceValidationError,
  type ListingFamily,
  type ListingForCopy,
  type MarketplaceConnector,
  type MarketplaceId,
} from "@/connectors/types";
import type { AttributeValue } from "@/domain/listings/attributes";
import {
  canonicalListingSchema,
  emptyVariant,
  type CanonicalListing,
  type CanonicalVariant,
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
      /** Variants in the draft (0 = simple listing). */
      variants: number;
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
    if (definitions.length === 0) return null; // no sheet known: keep everything
    return new Set(
      definitions.filter((definition) => !definition.readOnly).map((definition) => definition.id),
    );
  } catch (error) {
    if (error instanceof MarketplaceAuthError) throw error;
    return null; // validation will point problems
  }
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
    const keep = (attributes: AttributeValue[]) =>
      accepted ? attributes.filter((attribute) => accepted.has(attribute.id)) : attributes;
    const price = (cents: number | null) =>
      cents !== null && input.options?.price ? adjustPrice(cents, input.options.price) : cents;
    const pictures = (list: CanonicalListing["pictures"]) => (sameAccount ? list : byUrl(list));

    let listing: CanonicalListing = { ...source.listing };
    // Same key for every listing of one family: a batch copies a family once.
    let sourceKey = sourceExternalId;
    let draftSku: { id: string; stockOnHand: number } | null = null;

    // Own User Products listing with siblings in its family -> one draft, one variant per sibling.
    const siblings =
      own &&
      source.familyId &&
      source.listingModel === "user_products" &&
      target.listingModel === "user_products"
        ? await ctx.tdb.listing.findMany({
            where: {
              marketplaceAccountId: own.marketplaceAccountId,
              familyId: source.familyId,
              status: { not: "closed" },
            },
            orderBy: { externalId: "asc" },
            select: {
              externalId: true,
              mappings: {
                where: { variationKey: "" },
                select: { sku: { select: { id: true, stockOnHand: true } } },
              },
            },
          })
        : [];

    if (siblings.length > 1) {
      const family = await connector.getFamily(readToken, source.familyId!);
      const varying = family?.childAttributeIds ?? [];
      const members: Array<{
        copy: ListingForCopy;
        sku: { id: string; stockOnHand: number } | null;
      }> = [];
      for (const sibling of siblings) {
        const copy =
          sibling.externalId === sourceExternalId
            ? source
            : await connector.getListingForCopy(readToken, sibling.externalId);
        members.push({ copy, sku: sibling.mappings[0]?.sku ?? null });
      }
      const value = (copy: ListingForCopy, id: string) =>
        copy.listing.attributes.find((attribute) => attribute.id === id)?.valueName ?? null;
      listing = {
        ...source.listing,
        familyName: family?.familyName || source.listing.familyName,
        attributes: keep(
          source.listing.attributes.filter(
            (attribute) =>
              !varying.includes(attribute.id) && !PER_LISTING_ATTRIBUTES.has(attribute.id),
          ),
        ),
        pictures: [],
        variationAttributeIds: varying,
        variants: members.map(({ copy, sku }, index) => ({
          ...emptyVariant(String(index + 1)),
          attributes: copy.listing.attributes.filter((attribute) => varying.includes(attribute.id)),
          priceCents: price(copy.listing.priceCents),
          availableQuantity: sku ? Math.max(0, sku.stockOnHand) : copy.listing.availableQuantity,
          pictures: pictures(copy.listing.pictures),
          gtin: value(copy, "GTIN"),
          emptyGtinReason: value(copy, "EMPTY_GTIN_REASON"),
          sellerSku: value(copy, "SELLER_SKU"),
          skuId: sku?.id ?? null,
        })),
      };
      sourceKey = `family:${source.familyId}`;
    } else if (source.hasVariations) {
      // Traditional listing with variations -> one draft, one variant per variation.
      const varying = [
        ...new Set(
          source.variations.flatMap((variation) =>
            variation.attributes.map((attribute) => attribute.id),
          ),
        ),
      ];
      listing = {
        ...source.listing,
        familyName: source.title.slice(0, 200),
        attributes: keep(
          source.listing.attributes.filter(
            (attribute) =>
              !varying.includes(attribute.id) && !PER_LISTING_ATTRIBUTES.has(attribute.id),
          ),
        ),
        pictures: pictures(source.listing.pictures),
        variationAttributeIds: varying.slice(0, 5),
        variants: source.variations.map((variation) => {
          const sku = skuFor(variation.externalId);
          return {
            ...emptyVariant(variation.externalId),
            attributes: variation.attributes,
            priceCents: price(variation.priceCents),
            availableQuantity: sku ? Math.max(0, sku.stockOnHand) : variation.availableQuantity,
            pictures: pictures(variation.pictures),
            sellerSku: variation.sellerSku,
            skuId: sku?.id ?? null,
          };
        }),
      };
    } else {
      // Simple listing.
      listing.pictures = pictures(listing.pictures);
      listing.attributes = keep(listing.attributes);
      draftSku = skuFor(null);
      if (draftSku) listing.availableQuantity = Math.max(0, draftSku.stockOnHand);
    }
    listing.priceCents = price(listing.priceCents);
    if (input.options?.listingTypeId) listing.listingTypeId = input.options.listingTypeId;

    try {
      const draft = await ctx.tdb.listingDraft.create({
        data: {
          organizationId: ctx.organizationId,
          marketplaceAccountId: target.id,
          skuId: draftSku?.id ?? null,
          content: canonicalListingSchema.parse(listing) as unknown as Prisma.InputJsonValue,
          sourceKind: own ? "own" : "external",
          sourceExternalId: sourceKey,
          sourceAccountId: own?.marketplaceAccountId ?? null,
          batchJobId: input.batchJobId ?? null,
          createdById: ctx.userId,
        },
        select: { id: true },
      });
      return {
        status: "created",
        draftId: draft.id,
        variants: listing.variants.length,
        catalogProductId,
        copiedExternalId: sourceExternalId,
      };
    } catch (error) {
      if (isUniqueViolation(error)) return { status: "duplicate" }; // already copied in this batch
      throw error;
    }
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
  /** Family edit panel: the new variants, already filled (else one empty variation). */
  variants?: CanonicalVariant[],
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
      ...(variants?.length
        ? { variationAttributeIds: [...varying], variants, priceCents: null }
        : {}),
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
