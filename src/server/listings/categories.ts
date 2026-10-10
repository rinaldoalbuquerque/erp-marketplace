import "server-only";

import type { MarketplaceConnector, MarketplaceId } from "@/connectors/types";
import type { AttributeDefinition } from "@/domain/listings/attributes";
import { db } from "@/server/db";

import type { Prisma } from "@/generated/prisma/client";

// Category technical sheets change rarely: keep them 24h instead of asking the
// marketplace every time an edit form opens. Public metadata (no organization).
export const CATEGORY_TTL_MS = 24 * 60 * 60 * 1000;

export async function getCategoryAttributesCached(
  marketplace: MarketplaceId,
  categoryId: string,
  fetchFresh: () => Promise<AttributeDefinition[]>,
  now: Date = new Date(),
): Promise<AttributeDefinition[]> {
  const cached = await db.marketplaceCategory.findUnique({
    where: { marketplace_categoryId: { marketplace, categoryId } },
    select: { attributes: true, fetchedAt: true },
  });
  const fresh = cached && now.getTime() - cached.fetchedAt.getTime() < CATEGORY_TTL_MS;
  const definitions = (cached?.attributes ?? []) as unknown as AttributeDefinition[];
  // Sheets cached before the variation flags existed are read again.
  const hasVariationFlags = definitions.some((definition) => "allowsVariations" in definition);
  if (fresh && hasVariationFlags) return definitions;
  const attributes = await fetchFresh();
  const json = attributes as unknown as Prisma.InputJsonValue;
  await db.marketplaceCategory.upsert({
    where: { marketplace_categoryId: { marketplace, categoryId } },
    create: { marketplace, categoryId, attributes: json, fetchedAt: now },
    update: { attributes: json, fetchedAt: now },
  });
  return attributes;
}

/** Convenience: cached attributes through a connector and an access token. */
export function categoryAttributes(
  connector: MarketplaceConnector,
  accessToken: string,
  categoryId: string,
) {
  return getCategoryAttributesCached(connector.id, categoryId, () =>
    connector.getCategoryAttributes(accessToken, categoryId),
  );
}
