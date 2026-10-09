import "server-only";

import type { TenantDb } from "@/server/tenant/tenant-db";

import type { Prisma } from "@/generated/prisma/client";

export const LISTINGS_PAGE_SIZE = 50;

/** Status filter options of the listings page (ML raw statuses + "no stock"). */
export const LISTING_STATUS_FILTERS = {
  ativo: { status: "active" },
  pausado: { status: "paused" },
  finalizado: { status: "closed" },
  "em-revisao": { status: "under_review" },
  "sem-estoque": { availableQuantity: 0 },
} as const satisfies Record<string, Prisma.ListingWhereInput>;
export type ListingStatusFilter = keyof typeof LISTING_STATUS_FILTERS;

export type ListingFilters = {
  search?: string;
  accountIds?: string[];
  status?: ListingStatusFilter;
  familyId?: string;
  /** Only listings/variations without an ERP SKU linked. */
  unmapped?: boolean;
  page?: number;
};

export function listingWhere(filters: ListingFilters): Prisma.ListingWhereInput {
  const where: Prisma.ListingWhereInput = {};
  if (filters.accountIds?.length) where.marketplaceAccountId = { in: filters.accountIds };
  if (filters.status) Object.assign(where, LISTING_STATUS_FILTERS[filters.status]);
  if (filters.familyId) where.familyId = filters.familyId;
  if (filters.unmapped) where.mappings = { none: {} };

  const term = filters.search?.trim();
  if (term) {
    const conditions: Prisma.ListingWhereInput[] = [
      { title: { contains: term, mode: "insensitive" } },
      { sellerSku: { contains: term, mode: "insensitive" } },
      { familyName: { contains: term, mode: "insensitive" } },
      { variations: { some: { sellerSku: { contains: term, mode: "insensitive" } } } },
    ];
    // "MLB-123" or "mlb123" -> "MLB123". Skip when nothing is left (an empty
    // "contains" would match every listing).
    const idTerm = term.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (idTerm) conditions.push({ externalId: { contains: idTerm } });
    where.OR = conditions;
  }
  return where;
}

/** Server-side paginated listing search (screens read the local copy, never the API). */
export async function listListings(tdb: TenantDb, filters: ListingFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const where = listingWhere(filters);
  const [total, listings] = await Promise.all([
    tdb.listing.count({ where }),
    tdb.listing.findMany({
      where,
      orderBy: [{ status: "asc" }, { title: "asc" }],
      skip: (page - 1) * LISTINGS_PAGE_SIZE,
      take: LISTINGS_PAGE_SIZE,
      select: {
        id: true,
        externalId: true,
        title: true,
        status: true,
        subStatus: true,
        priceCents: true,
        availableQuantity: true,
        soldQuantity: true,
        permalink: true,
        thumbnailUrl: true,
        listingModel: true,
        familyId: true,
        familyName: true,
        sellerSku: true,
        syncedAt: true,
        account: { select: { id: true, nickname: true, allowWrites: true } },
        _count: { select: { variations: true, mappings: true } },
      },
    }),
  ]);
  return {
    total,
    listings,
    page,
    pageCount: Math.max(1, Math.ceil(total / LISTINGS_PAGE_SIZE)),
  };
}

/** Accounts for the filter, with their last sync date. */
export function listingAccounts(tdb: TenantDb) {
  return tdb.marketplaceAccount.findMany({
    where: { status: { not: "disconnected" } },
    orderBy: { nickname: "asc" },
    select: { id: true, nickname: true, lastSyncAt: true, status: true },
  });
}
