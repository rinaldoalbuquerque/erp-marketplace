import "server-only";

import {
  MarketplaceApiError,
  MarketplaceAuthError,
  MarketplaceValidationError,
  type MarketplaceConnector,
  type MarketplaceId,
} from "@/connectors/types";
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

// Copy / migrate (Phase 2D): any listing becomes a DRAFT of a target account
// (CLAUDE.md: copies enter as drafts for review and are independent of the
// original; the origin is kept only as a reference).
// - Own listing: the copy inherits its SKU link (same stock) and, in the same
//   account, its picture ids. Other accounts / sellers get pictures by URL.
// - Attributes are kept only when the target category accepts them (not read-only).

export type CopyDeps = TokenDeps & {
  connectorFor?: (marketplace: MarketplaceId) => MarketplaceConnector;
};

export type CopyOptions = {
  price?: PriceOptions | null;
  listingTypeId?: ListingTypeId | null;
};

export type CopyResult =
  | { status: "created"; draftId: string }
  | {
      status:
        | "duplicate"
        | "has_variations"
        | "not_found"
        | "account_unavailable"
        | "reconnect"
        | "marketplace_error";
    };

type Ctx = { tdb: TenantDb; organizationId: string; userId: string | null };

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

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
    select: { id: true, marketplace: true },
  });
  if (!target) return { status: "account_unavailable" };

  // Own listing? (any account of this organization)
  const own = await ctx.tdb.listing.findFirst({
    where: { externalId: input.sourceExternalId, marketplace: target.marketplace },
    select: {
      marketplaceAccountId: true,
      mappings: {
        where: { variationKey: "" },
        select: { sku: { select: { id: true, stockOnHand: true } } },
      },
    },
  });
  const sku = own?.mappings[0]?.sku ?? null;
  const connector = (deps.connectorFor ?? getConnector)(target.marketplace);

  try {
    // Read with the source account's token when it is ours (internal fields), else the target's.
    const readToken = await getAccessToken(
      ctx.organizationId,
      own?.marketplaceAccountId ?? target.id,
      deps,
    );
    const source = await connector.getListingForCopy(readToken, input.sourceExternalId);
    if (source.hasVariations) return { status: "has_variations" };

    const targetToken =
      own?.marketplaceAccountId === target.id
        ? readToken
        : await getAccessToken(ctx.organizationId, target.id, deps);

    const listing: CanonicalListing = { ...source.listing };
    // Picture ids are reused only inside the same account; elsewhere, by URL.
    if (own?.marketplaceAccountId !== target.id) {
      listing.pictures = listing.pictures
        .filter((picture) => picture.url !== null)
        .map((picture) => ({ id: null, url: picture.url }));
    }
    if (listing.categoryId) {
      try {
        const definitions = await categoryAttributes(connector, targetToken, listing.categoryId);
        const accepted = new Set(
          definitions
            .filter((definition) => !definition.readOnly)
            .map((definition) => definition.id),
        );
        listing.attributes = listing.attributes.filter((attribute) => accepted.has(attribute.id));
      } catch (error) {
        if (error instanceof MarketplaceAuthError) throw error;
        // Without the sheet, keep the attributes; validation will point problems.
      }
    }
    if (input.options?.price && listing.priceCents !== null) {
      listing.priceCents = adjustPrice(listing.priceCents, input.options.price);
    }
    if (input.options?.listingTypeId) listing.listingTypeId = input.options.listingTypeId;
    if (sku) listing.availableQuantity = Math.max(0, sku.stockOnHand);

    const content = canonicalListingSchema.parse(listing) as unknown as Prisma.InputJsonValue;
    try {
      const draft = await ctx.tdb.listingDraft.create({
        data: {
          organizationId: ctx.organizationId,
          marketplaceAccountId: target.id,
          skuId: sku?.id ?? null,
          content,
          sourceKind: own ? "own" : "external",
          sourceExternalId: input.sourceExternalId,
          sourceAccountId: own?.marketplaceAccountId ?? null,
          batchJobId: input.batchJobId ?? null,
          createdById: ctx.userId,
        },
        select: { id: true },
      });
      return { status: "created", draftId: draft.id };
    } catch (error) {
      if (isUniqueViolation(error)) return { status: "duplicate" };
      throw error;
    }
  } catch (error) {
    if (error instanceof ReconnectRequiredError || error instanceof MarketplaceAuthError) {
      return { status: "reconnect" };
    }
    if (error instanceof MarketplaceValidationError) return { status: "not_found" };
    if (error instanceof MarketplaceApiError) {
      return error.status === 404 ? { status: "not_found" } : { status: "marketplace_error" };
    }
    throw error;
  }
}
