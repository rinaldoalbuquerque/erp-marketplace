import "server-only";

import {
  normalizeSkuForMatch,
  planAutoMatches,
  type MatchTarget,
} from "@/domain/listings/auto-match";
import type { TenantDb } from "@/server/tenant/tenant-db";

import { Prisma } from "@/generated/prisma/client";

// Mapping ERP SKU <-> listing/variation (CLAUDE.md: "Anúncios ficam vinculados
// a SKUs pela tela de Mapeamento"). A listing with variations is linked per
// variation; a listing without variations (incl. each User Products item) as a whole.
// One SKU per listing/variation (unique listing_id + variation_key).

export const MAPPING_PAGE_SIZE = 40;

export type MappingFilters = {
  search?: string;
  accountIds?: string[];
  showMapped?: boolean;
  page?: number;
};

/** Listings still needing a link: no variations and no mapping, or some variation unmapped. */
const UNMAPPED: Prisma.ListingWhereInput = {
  OR: [
    { variations: { none: {} }, mappings: { none: {} } },
    { variations: { some: { mappings: { none: {} } } } },
  ],
};

export async function listMappingRows(tdb: TenantDb, filters: MappingFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const conditions: Prisma.ListingWhereInput[] = [{ removedAt: null }];
  if (!filters.showMapped) conditions.push(UNMAPPED);
  if (filters.accountIds?.length) {
    conditions.push({ marketplaceAccountId: { in: filters.accountIds } });
  }
  const term = filters.search?.trim();
  if (term) {
    const idTerm = term.toUpperCase().replace(/[^A-Z0-9]/g, "");
    conditions.push({
      OR: [
        { title: { contains: term, mode: "insensitive" } },
        { sellerSku: { contains: term, mode: "insensitive" } },
        { variations: { some: { sellerSku: { contains: term, mode: "insensitive" } } } },
        ...(idTerm ? [{ externalId: { contains: idTerm } }] : []),
      ],
    });
  }
  const where: Prisma.ListingWhereInput = conditions.length ? { AND: conditions } : {};

  const mappingSelect = {
    id: true,
    variationKey: true,
    sku: { select: { id: true, code: true, product: { select: { id: true, name: true } } } },
  } as const;

  const [total, listings] = await Promise.all([
    tdb.listing.count({ where }),
    tdb.listing.findMany({
      where,
      orderBy: [{ status: "asc" }, { title: "asc" }],
      skip: (page - 1) * MAPPING_PAGE_SIZE,
      take: MAPPING_PAGE_SIZE,
      select: {
        id: true,
        externalId: true,
        title: true,
        status: true,
        thumbnailUrl: true,
        sellerSku: true,
        account: { select: { nickname: true } },
        mappings: { select: mappingSelect },
        variations: {
          orderBy: { externalId: "asc" },
          select: { id: true, externalId: true, attributes: true, sellerSku: true },
        },
      },
    }),
  ]);
  return {
    total,
    listings,
    page,
    pageCount: Math.max(1, Math.ceil(total / MAPPING_PAGE_SIZE)),
  };
}

export type LinkResult =
  | { status: "linked"; skuCode: string }
  | { status: "sku_not_found" }
  | { status: "target_not_found" }
  | { status: "variation_required" };

/** Links (or re-links) a listing/variation to the ERP SKU with this code. */
export async function linkSku(
  tdb: TenantDb,
  organizationId: string,
  userId: string | null,
  input: { listingId: string; variationId: string | null; skuCode: string },
): Promise<LinkResult> {
  const code = normalizeSkuForMatch(input.skuCode);
  const [listing, sku] = await Promise.all([
    tdb.listing.findFirst({
      where: { id: input.listingId },
      select: { id: true, variations: { select: { id: true } } },
    }),
    code ? tdb.sku.findFirst({ where: { code }, select: { id: true, code: true } }) : null,
  ]);
  if (!listing) return { status: "target_not_found" };
  if (input.variationId) {
    if (!listing.variations.some((variation) => variation.id === input.variationId)) {
      return { status: "target_not_found" };
    }
  } else if (listing.variations.length > 0) {
    return { status: "variation_required" };
  }
  if (!sku) return { status: "sku_not_found" };

  const variationKey = input.variationId ?? "";
  await tdb.skuListingMapping.upsert({
    where: { listingId_variationKey: { listingId: listing.id, variationKey } },
    create: {
      organizationId,
      skuId: sku.id,
      listingId: listing.id,
      listingVariationId: input.variationId,
      variationKey,
      createdById: userId,
    },
    update: { skuId: sku.id, createdById: userId },
  });
  return { status: "linked", skuCode: sku.code };
}

export async function unlinkMappings(tdb: TenantDb, mappingIds: string[]): Promise<number> {
  if (mappingIds.length === 0) return 0;
  const result = await tdb.skuListingMapping.deleteMany({ where: { id: { in: mappingIds } } });
  return result.count;
}

export type AutoMatchItem = {
  mappingId: string;
  listingTitle: string;
  externalId: string;
  skuCode: string;
};

/**
 * Links every unmapped listing/variation whose marketplace SKU equals an ERP
 * SKU code. Never touches existing links. Returns what was linked (for undo).
 */
export async function autoMatch(
  tdb: TenantDb,
  organizationId: string,
  userId: string | null,
): Promise<AutoMatchItem[]> {
  const [skus, listings] = await Promise.all([
    tdb.sku.findMany({ select: { id: true, code: true } }),
    tdb.listing.findMany({
      where: { ...UNMAPPED, removedAt: null },
      select: {
        id: true,
        sellerSku: true,
        mappings: { select: { variationKey: true } },
        variations: {
          select: { id: true, sellerSku: true, mappings: { select: { id: true } } },
        },
      },
    }),
  ]);
  if (skus.length === 0) return [];

  const targets: MatchTarget[] = [];
  for (const listing of listings) {
    if (listing.variations.length === 0) {
      if (listing.mappings.length === 0) {
        targets.push({ listingId: listing.id, variationId: null, sellerSku: listing.sellerSku });
      }
    } else {
      for (const variation of listing.variations) {
        if (variation.mappings.length === 0) {
          targets.push({
            listingId: listing.id,
            variationId: variation.id,
            // A variation without its own SKU does not inherit the listing's.
            sellerSku: variation.sellerSku,
          });
        }
      }
    }
  }

  const planned = planAutoMatches(targets, skus);
  if (planned.length === 0) return [];

  const created = await tdb.skuListingMapping.createManyAndReturn({
    data: planned.map((match) => ({
      organizationId,
      skuId: match.skuId,
      listingId: match.listingId,
      listingVariationId: match.variationId,
      variationKey: match.variationId ?? "",
      createdById: userId,
    })),
    // A link created meanwhile by someone else wins; never overwrite it.
    skipDuplicates: true,
    select: {
      id: true,
      listing: { select: { title: true, externalId: true } },
      sku: { select: { code: true } },
    },
  });
  return created.map((mapping) => ({
    mappingId: mapping.id,
    listingTitle: mapping.listing.title,
    externalId: mapping.listing.externalId,
    skuCode: mapping.sku.code,
  }));
}
