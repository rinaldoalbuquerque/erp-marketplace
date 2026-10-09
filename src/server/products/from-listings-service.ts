import "server-only";

import {
  buildProposal,
  type Proposal,
  type SourceAttribute,
  type SourceListing,
} from "@/domain/products/from-listings";
import type { VariationAttribute } from "@/domain/products/schemas";
import { db } from "@/server/db";
import { autoMatch } from "@/server/listings/mapping-service";
import { adjustStock } from "@/server/stock/stock-service";
import type { TenantDb } from "@/server/tenant/tenant-db";

import { Prisma } from "@/generated/prisma/client";

/** Products created per database transaction. */
const PRODUCTS_PER_TRANSACTION = 25;
/** Initial stock entries written in parallel. */
const STOCK_CONCURRENCY = 5;
const INITIAL_STOCK_REASON = "Estoque inicial importado do Mercado Livre";

type ListingRow = {
  id: string;
  external_id: string;
  title: string;
  permalink: string | null;
  family_id: string | null;
  family_name: string | null;
  seller_sku: string | null;
  available_quantity: number | null;
  attributes: unknown;
};

/** Imported listings of the organization in the shape the proposal builder needs. */
async function loadSources(tdb: TenantDb, organizationId: string): Promise<SourceListing[]> {
  // Only the attributes array of the stored payload is needed; reading it in SQL
  // avoids loading every full listing JSON. Internal read, filtered by organization.
  const rows = await db.$queryRaw<ListingRow[]>`
    SELECT id, external_id, title, permalink, family_id, family_name, seller_sku,
           available_quantity, raw->'attributes' AS attributes
    FROM listings
    WHERE organization_id = ${organizationId}::uuid
    ORDER BY external_id
  `;
  const variations = await tdb.listingVariation.findMany({
    select: {
      id: true,
      listingId: true,
      sellerSku: true,
      attributes: true,
      availableQuantity: true,
    },
  });
  const byListing = new Map<string, typeof variations>();
  for (const variation of variations) {
    byListing.set(variation.listingId, [...(byListing.get(variation.listingId) ?? []), variation]);
  }

  return rows.map((row) => ({
    listingId: row.id,
    externalId: row.external_id,
    title: row.title,
    permalink: row.permalink,
    familyId: row.family_id,
    familyName: row.family_name,
    sellerSku: row.seller_sku,
    availableQuantity: row.available_quantity,
    attributes: Array.isArray(row.attributes) ? (row.attributes as SourceAttribute[]) : [],
    variations: (byListing.get(row.id) ?? []).map((variation) => ({
      variationId: variation.id,
      sellerSku: variation.sellerSku,
      attributes: Array.isArray(variation.attributes)
        ? (variation.attributes as VariationAttribute[])
        : [],
      availableQuantity: variation.availableQuantity,
    })),
  }));
}

export async function getProductProposal(tdb: TenantDb, organizationId: string): Promise<Proposal> {
  const [sources, skus] = await Promise.all([
    loadSources(tdb, organizationId),
    tdb.sku.findMany({ select: { code: true } }),
  ]);
  return buildProposal(sources, new Set(skus.map((sku) => sku.code)));
}

export type CreateFromListingsReport = {
  productsCreated: number;
  skusCreated: number;
  skippedExisting: number;
  stockEntries: number;
  linked: number;
};

/**
 * Creates the selected proposed SKUs (and their products). The proposal is
 * rebuilt here from the database: the browser only says which codes to create.
 * Idempotent: a code that exists by now is skipped, never duplicated.
 */
export async function createFromListings(
  tdb: TenantDb,
  member: { organizationId: string; userId: string | null; canAdjustStock: boolean },
  input: { codes: string[]; includeStock: boolean },
): Promise<CreateFromListingsReport> {
  const selected = new Set(input.codes);
  const proposal = await getProductProposal(tdb, member.organizationId);
  const products = proposal.products
    .map((product) => ({
      ...product,
      skus: product.skus.filter((sku) => !sku.blocked && selected.has(sku.code)),
    }))
    .filter((product) => product.skus.length > 0);

  const report: CreateFromListingsReport = {
    productsCreated: 0,
    skusCreated: 0,
    skippedExisting: 0,
    stockEntries: 0,
    linked: 0,
  };
  const stockToAdd: Array<{ skuId: string; quantity: number }> = [];

  for (let start = 0; start < products.length; start += PRODUCTS_PER_TRANSACTION) {
    const chunk = products.slice(start, start + PRODUCTS_PER_TRANSACTION);
    await tdb.$transaction(
      async (tx) => {
        const codes = chunk.flatMap((product) => product.skus.map((sku) => sku.code));
        const taken = new Set(
          (await tx.sku.findMany({ where: { code: { in: codes } }, select: { code: true } })).map(
            (sku) => sku.code,
          ),
        );
        for (const product of chunk) {
          const fresh = product.skus.filter((sku) => !taken.has(sku.code));
          report.skippedExisting += product.skus.length - fresh.length;
          if (fresh.length === 0) continue;

          const created = await tx.product.create({
            data: {
              organizationId: member.organizationId,
              name: product.name,
              brand: product.brand,
            },
            select: { id: true },
          });
          report.productsCreated++;
          for (const sku of fresh) {
            const row = await tx.sku.create({
              data: {
                organizationId: member.organizationId,
                productId: created.id,
                code: sku.code,
                ean: sku.ean,
                variation: sku.variation ?? Prisma.DbNull,
                weightGrams: sku.weightGrams,
                heightCm: sku.heightCm,
                widthCm: sku.widthCm,
                lengthCm: sku.lengthCm,
              },
              select: { id: true },
            });
            report.skusCreated++;
            if (input.includeStock && sku.initialStock && sku.initialStock > 0) {
              stockToAdd.push({ skuId: row.id, quantity: sku.initialStock });
            }
          }
        }
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
  }

  // Stock only through adjustStock (balance + history), idempotent per SKU.
  // Different SKUs don't contend, so a few run at once (keeps hundreds of SKUs
  // well inside the hosting time limit) without exhausting the connection pool.
  if (member.canAdjustStock) {
    const queue = [...stockToAdd];
    const worker = async () => {
      for (let entry = queue.shift(); entry; entry = queue.shift()) {
        const result = await adjustStock(tdb, {
          organizationId: member.organizationId,
          skuId: entry.skuId,
          type: "manual_in",
          quantity: entry.quantity,
          reason: INITIAL_STOCK_REASON,
          idempotencyKey: `initial-stock-from-listings:${entry.skuId}`,
          createdById: member.userId,
        });
        if (result.status === "applied") report.stockEntries++;
      }
    };
    await Promise.all(Array.from({ length: STOCK_CONCURRENCY }, worker));
  }

  report.linked = (await autoMatch(tdb, member.organizationId, member.userId)).length;
  return report;
}
