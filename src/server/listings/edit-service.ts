import "server-only";

import {
  MarketplaceApiError,
  MarketplaceAuthError,
  MarketplaceValidationError,
  type EditableListing,
  type ListingPatch,
  type MarketplaceConnector,
  type MarketplaceId,
} from "@/connectors/types";
import {
  diffAttributes,
  type AttributeDefinition,
  type AttributeInput,
} from "@/domain/listings/attributes";
import { getConnector } from "@/server/marketplaces/config";
import {
  getAccessToken,
  ReconnectRequiredError,
  type TokenDeps,
} from "@/server/marketplaces/token-service";
import type { TenantDb } from "@/server/tenant/tenant-db";

import { categoryAttributes } from "./categories";
import { saveListing } from "./import-service";

import type { Prisma } from "@/generated/prisma/client";

// Editing a listing in the marketplace (Phase 2B). Safety rules:
// - only accounts with allowWrites (off by default) can be changed;
// - the latest version is read before saving; if it changed since the form
//   opened (last_updated differs), nothing is sent ("conflict");
// - only changed fields are sent; every attempt is recorded in listing_edits.

export type EditDeps = TokenDeps & {
  connectorFor?: (marketplace: MarketplaceId) => MarketplaceConnector;
};

type Context = {
  tdb: TenantDb;
  organizationId: string;
  userId: string | null;
  /** May close listings (permission listings.delete). */
  canClose: boolean;
};

async function loadTarget(tdb: TenantDb, listingId: string) {
  return tdb.listing.findFirst({
    where: { id: listingId },
    select: {
      id: true,
      externalId: true,
      categoryId: true,
      marketplace: true,
      marketplaceAccountId: true,
      account: { select: { id: true, nickname: true, allowWrites: true, status: true } },
    },
  });
}

export type LoadForEditResult =
  | {
      status: "ok";
      listingId: string;
      accountNickname: string;
      editable: EditableListing;
      definitions: AttributeDefinition[];
      /** Version stamp to detect concurrent changes on save. */
      versionStamp: string | null;
    }
  | { status: "not_found" | "writes_disabled" | "reconnect" | "marketplace_error" };

export async function loadForEdit(
  ctx: Context,
  listingId: string,
  deps: EditDeps = {},
): Promise<LoadForEditResult> {
  const target = await loadTarget(ctx.tdb, listingId);
  if (!target) return { status: "not_found" };
  if (!target.account.allowWrites) return { status: "writes_disabled" };
  const connector = (deps.connectorFor ?? getConnector)(target.marketplace);
  try {
    const token = await getAccessToken(ctx.organizationId, target.marketplaceAccountId, deps);
    const editable = await connector.getListingForEdit(token, target.externalId);
    // Keep the local copy in sync with what the form shows.
    await saveListing(
      ctx.tdb,
      ctx.organizationId,
      target.marketplaceAccountId,
      target.marketplace,
      editable.listing,
      new Date(),
    );
    const categoryId = editable.listing.categoryId ?? target.categoryId;
    const definitions = categoryId ? await categoryAttributes(connector, token, categoryId) : [];
    return {
      status: "ok",
      listingId: target.id,
      accountNickname: target.account.nickname,
      editable,
      definitions,
      versionStamp: editable.listing.externalUpdatedAt?.toISOString() ?? null,
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

export type EditInput = {
  versionStamp: string | null;
  title?: string;
  familyName?: string;
  priceCents?: number;
  status?: "active" | "paused" | "closed";
  description?: string;
  attributes?: Record<string, AttributeInput>;
};

type Change = { field: string; before: unknown; after: unknown };

export type SaveEditResult =
  | { status: "saved"; warnings: string[]; changes: Change[] }
  | { status: "no_changes" }
  | { status: "invalid"; fieldErrors: Record<string, string> }
  | { status: "refused"; causes: string[] }
  | { status: "conflict" }
  | {
      status:
        | "not_found"
        | "writes_disabled"
        | "forbidden"
        | "reconnect"
        | "marketplace_error"
        /** Bug or unknown failure: logged on the server, shown as a generic message. */
        | "unexpected";
    };

/** Builds the patch from the form, comparing with the latest marketplace version. */
export function buildPatch(
  fresh: EditableListing,
  definitions: AttributeDefinition[],
  input: EditInput,
): {
  patch: ListingPatch;
  description?: string;
  changes: Change[];
  fieldErrors: Record<string, string>;
} {
  const patch: ListingPatch = {};
  const changes: Change[] = [];
  const fieldErrors: Record<string, string> = {};
  const { listing, rules } = fresh;

  const title = input.title?.trim();
  if (title !== undefined && title !== listing.title) {
    if (!rules.titleEditable) fieldErrors.title = "O título deste anúncio não pode ser alterado.";
    // Length limits are validated by the marketplace (its message is shown on refusal).
    else if (!title) fieldErrors.title = "O título não pode ficar vazio.";
    else {
      patch.title = title;
      changes.push({ field: "title", before: listing.title, after: title });
    }
  }

  const familyName = input.familyName?.trim();
  if (familyName !== undefined && familyName !== (listing.familyName ?? "")) {
    if (!rules.familyNameEditable) fieldErrors.familyName = "Este anúncio não usa nome de família.";
    else if (!familyName) fieldErrors.familyName = "O nome da família não pode ficar vazio.";
    else {
      patch.familyName = familyName;
      changes.push({ field: "familyName", before: listing.familyName, after: familyName });
    }
  }

  if (input.priceCents !== undefined && input.priceCents !== listing.priceCents) {
    if (!Number.isInteger(input.priceCents) || input.priceCents <= 0) {
      fieldErrors.price = "Informe um preço maior que zero.";
    } else {
      patch.priceCents = input.priceCents;
      changes.push({ field: "price", before: listing.priceCents, after: input.priceCents });
    }
  }

  if (input.status !== undefined && input.status !== listing.status) {
    patch.status = input.status;
    changes.push({ field: "status", before: listing.status, after: input.status });
  }

  let description: string | undefined;
  if (input.description !== undefined) {
    const text = input.description.replace(/\r\n/g, "\n");
    if (text !== (fresh.description ?? "")) {
      description = text;
      changes.push({ field: "description", before: fresh.description, after: text });
    }
  }

  if (input.attributes) {
    const diff = diffAttributes(definitions, fresh.attributes, input.attributes);
    Object.assign(
      fieldErrors,
      Object.fromEntries(
        Object.entries(diff.errors).map(([id, message]) => [`attr.${id}`, message]),
      ),
    );
    if (diff.changes.length) {
      patch.attributes = diff.changes.map((change) => change.after);
      for (const change of diff.changes) {
        changes.push({
          field: `attribute:${change.id}`,
          before: change.before ?? null,
          after: change.after,
        });
      }
    }
  }
  return { patch, description, changes, fieldErrors };
}

async function record(
  ctx: Context,
  listingId: string,
  changes: Change[],
  status: "success" | "partial" | "failed",
  message: string | null,
) {
  await ctx.tdb.listingEdit.create({
    data: {
      organizationId: ctx.organizationId,
      listingId,
      userId: ctx.userId,
      changes: changes as unknown as Prisma.InputJsonValue,
      status,
      message,
    },
  });
}

export async function saveEdit(
  ctx: Context,
  listingId: string,
  input: EditInput,
  deps: EditDeps = {},
): Promise<SaveEditResult> {
  const target = await loadTarget(ctx.tdb, listingId);
  if (!target) return { status: "not_found" };
  if (!target.account.allowWrites) return { status: "writes_disabled" };
  if (input.status === "closed" && !ctx.canClose) return { status: "forbidden" };

  const connector = (deps.connectorFor ?? getConnector)(target.marketplace);
  let changes: Change[] = [];
  try {
    const token = await getAccessToken(ctx.organizationId, target.marketplaceAccountId, deps);
    const fresh = await connector.getListingForEdit(token, target.externalId);
    const freshStamp = fresh.listing.externalUpdatedAt?.toISOString() ?? null;
    if (input.versionStamp !== freshStamp) return { status: "conflict" };

    const categoryId = fresh.listing.categoryId ?? target.categoryId;
    const definitions = categoryId ? await categoryAttributes(connector, token, categoryId) : [];
    const built = buildPatch(fresh, definitions, input);
    changes = built.changes;
    if (Object.keys(built.fieldErrors).length) {
      return { status: "invalid", fieldErrors: built.fieldErrors };
    }
    if (changes.length === 0) return { status: "no_changes" };

    const { warnings } = await connector.updateListing(token, target.externalId, built.patch);
    if (built.description !== undefined) {
      try {
        await connector.updateListingDescription(
          token,
          target.externalId,
          built.description,
          fresh.description !== null,
        );
      } catch (error) {
        if (error instanceof MarketplaceValidationError) {
          warnings.push(`Descrição não salva: ${error.causes.join("; ")}`);
        } else throw error;
      }
    }

    // Refresh the local copy with what the marketplace now has.
    const after = await connector.getListingForEdit(token, target.externalId);
    await saveListing(
      ctx.tdb,
      ctx.organizationId,
      target.marketplaceAccountId,
      target.marketplace,
      after.listing,
      new Date(),
    );
    await record(
      ctx,
      listingId,
      changes,
      warnings.length ? "partial" : "success",
      warnings.join("; ") || null,
    );
    return { status: "saved", warnings, changes };
  } catch (error) {
    if (error instanceof MarketplaceValidationError) {
      await record(ctx, listingId, changes, "failed", error.causes.join("; "));
      return { status: "refused", causes: error.causes };
    }
    if (error instanceof ReconnectRequiredError || error instanceof MarketplaceAuthError) {
      return { status: "reconnect" };
    }
    if (error instanceof MarketplaceApiError) {
      if (changes.length)
        await record(ctx, listingId, changes, "failed", "Mercado Livre não respondeu.");
      return { status: "marketplace_error" };
    }
    throw error;
  }
}
