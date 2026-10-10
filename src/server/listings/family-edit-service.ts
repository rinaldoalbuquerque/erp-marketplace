import "server-only";

import {
  MarketplaceApiError,
  MarketplaceAuthError,
  MarketplaceValidationError,
  type EditableListing,
  type MarketplaceConnector,
  type MarketplaceId,
} from "@/connectors/types";
import type { AttributeDefinition } from "@/domain/listings/attributes";
import type { CanonicalVariant } from "@/domain/listings/canonical";
import { getConnector } from "@/server/marketplaces/config";
import {
  getAccessToken,
  ReconnectRequiredError,
  type TokenDeps,
} from "@/server/marketplaces/token-service";
import type { TenantDb } from "@/server/tenant/tenant-db";

import { categoryAttributes } from "./categories";
import { createVariationDraft } from "./copy-service";
import { MAX_PICTURE_BYTES, publishDraft, type PublishResult } from "./draft-service";
import { saveListing } from "./import-service";

// Editing a whole User Products family on the listing edit page: every member
// (one listing per variant) is read fresh from the marketplace; saving goes
// through saveEdit for each changed member (version check, only the changes,
// recorded in listing_edits). New variants are published into the same family
// through a draft (createVariationDraft + publishDraft: never repeated, typed
// SKU codes become ERP SKUs, the SKU link is created).

export type FamilyDeps = TokenDeps & {
  connectorFor?: (marketplace: MarketplaceId) => MarketplaceConnector;
};

type Ctx = { tdb: TenantDb; organizationId: string; userId: string | null };

/** Families bigger than this are edited one listing at a time. */
export const MAX_FAMILY_MEMBERS = 30;

export type FamilyMember = {
  listingId: string;
  externalId: string;
  editable: EditableListing;
  versionStamp: string | null;
  sku: { code: string; stockOnHand: number } | null;
};

export type LoadFamilyResult =
  | {
      status: "ok";
      familyId: string;
      familyName: string;
      accountNickname: string;
      definitions: AttributeDefinition[];
      /** Attributes that identify each variant (ML CHILD_PK): locked on published members. */
      varyingIds: string[];
      members: FamilyMember[];
    }
  /** Not a family with siblings: edit the listing alone. */
  | { status: "single" }
  | { status: "not_found" | "writes_disabled" | "reconnect" | "marketplace_error" };

export async function loadFamilyForEdit(
  ctx: Ctx,
  listingId: string,
  deps: FamilyDeps = {},
): Promise<LoadFamilyResult> {
  const target = await ctx.tdb.listing.findFirst({
    where: { id: listingId },
    select: {
      familyId: true,
      listingModel: true,
      marketplace: true,
      marketplaceAccountId: true,
      account: { select: { nickname: true, allowWrites: true } },
    },
  });
  if (!target) return { status: "not_found" };
  if (target.listingModel !== "user_products" || !target.familyId) return { status: "single" };
  const siblings = await ctx.tdb.listing.findMany({
    where: {
      marketplaceAccountId: target.marketplaceAccountId,
      familyId: target.familyId,
      removedAt: null,
      status: { not: "closed" },
    },
    orderBy: { externalId: "asc" },
    take: MAX_FAMILY_MEMBERS + 1,
    select: {
      id: true,
      externalId: true,
      mappings: {
        where: { variationKey: "" },
        select: { sku: { select: { code: true, stockOnHand: true } } },
      },
    },
  });
  if (siblings.length <= 1 || siblings.length > MAX_FAMILY_MEMBERS) return { status: "single" };
  if (!target.account.allowWrites) return { status: "writes_disabled" };

  const connector = (deps.connectorFor ?? getConnector)(target.marketplace);
  try {
    const token = await getAccessToken(ctx.organizationId, target.marketplaceAccountId, deps);
    const family = await connector.getFamily(token, target.familyId);
    const members: FamilyMember[] = [];
    for (const sibling of siblings) {
      const editable = await connector.getListingForEdit(token, sibling.externalId);
      // Keep the local copy in sync with what the form shows.
      await saveListing(
        ctx.tdb,
        ctx.organizationId,
        target.marketplaceAccountId,
        target.marketplace,
        editable.listing,
        new Date(),
      );
      members.push({
        listingId: sibling.id,
        externalId: sibling.externalId,
        editable,
        versionStamp: editable.listing.externalUpdatedAt?.toISOString() ?? null,
        sku: sibling.mappings[0]?.sku ?? null,
      });
    }
    const categoryId = members[0]?.editable.listing.categoryId ?? null;
    return {
      status: "ok",
      familyId: target.familyId,
      familyName: family?.familyName || members[0]?.editable.listing.familyName || "",
      accountNickname: target.account.nickname,
      definitions: categoryId ? await categoryAttributes(connector, token, categoryId) : [],
      varyingIds: family?.childAttributeIds ?? [],
      members,
    };
  } catch (error) {
    if (error instanceof ReconnectRequiredError || error instanceof MarketplaceAuthError) {
      return { status: "reconnect" };
    }
    if (error instanceof MarketplaceApiError || error instanceof MarketplaceValidationError) {
      return { status: "marketplace_error" };
    }
    throw error;
  }
}

export type NewVariantsResult =
  PublishResult | { status: "not_user_products"; draftId?: undefined };

/**
 * Publishes new variants into the family of `listingId`. When everything went
 * out, the helper draft is deleted; otherwise it stays in Rascunhos (only the
 * variants still missing are sent when published again).
 */
export async function publishNewVariants(
  ctx: Ctx,
  listingId: string,
  variants: CanonicalVariant[],
  options: { canCreateSkus: boolean },
  deps: FamilyDeps = {},
): Promise<NewVariantsResult & { draftId?: string }> {
  const created = await createVariationDraft(ctx, listingId, deps, variants);
  if (created.status !== "created") {
    return created.status === "not_user_products" ? { status: created.status } : created;
  }
  const result = await publishDraft(ctx, created.draftId, deps, options);
  if (result.status === "published") {
    await ctx.tdb.listingDraft.deleteMany({ where: { id: created.draftId } });
    return result;
  }
  return { ...result, draftId: created.draftId };
}

/** Uploads a picture for a new variant with the account of `listingId`. */
export async function uploadFamilyPicture(
  ctx: Ctx,
  listingId: string,
  file: Blob,
  filename: string,
  deps: FamilyDeps = {},
): Promise<
  | { status: "ok"; picture: { id: string; url: string | null } }
  | { status: "not_found" | "invalid" | "reconnect" | "marketplace_error" }
> {
  if (file.size === 0 || file.size > MAX_PICTURE_BYTES) return { status: "invalid" };
  const target = await ctx.tdb.listing.findFirst({
    where: { id: listingId },
    select: { marketplace: true, marketplaceAccountId: true },
  });
  if (!target) return { status: "not_found" };
  const connector = (deps.connectorFor ?? getConnector)(target.marketplace);
  try {
    const token = await getAccessToken(ctx.organizationId, target.marketplaceAccountId, deps);
    return { status: "ok", picture: await connector.uploadPicture(token, file, filename) };
  } catch (error) {
    if (error instanceof ReconnectRequiredError || error instanceof MarketplaceAuthError) {
      return { status: "reconnect" };
    }
    if (error instanceof MarketplaceValidationError) return { status: "invalid" };
    if (error instanceof MarketplaceApiError) return { status: "marketplace_error" };
    throw error;
  }
}
