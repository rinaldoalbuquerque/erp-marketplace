import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  MarketplaceApiError,
  MarketplaceValidationError,
  type ListingForCopy,
  type MarketplaceListing,
} from "@/connectors/types";
import { emptyListing } from "@/domain/listings/canonical";
import { db } from "@/server/db";
import {
  batchProgress,
  runBatchRound,
  startPublish,
  startReplicate,
} from "@/server/listings/batch-service";
import { encryptTokens } from "@/server/marketplaces/token-service";
import { fakeConnector } from "@/test/fake-connector";

// Real database (`npm run test:db`) in a TEMPORARY organization deleted at the end.
// Mercado Livre is simulated: nothing is copied or published anywhere.

const key = randomBytes(32);
let organizationId: string;
let accountId: string;
const later = () => new Date(Date.now() + 60_000);

function source(id: string, hasVariations = false): ListingForCopy {
  return {
    listing: {
      ...emptyListing(),
      familyName: `Produto ${id}`,
      title: `Produto ${id}`,
      categoryId: null, // no category sheet lookup in this test
      priceCents: 1000,
      pictures: [{ id: null, url: "https://http2.mlstatic.com/x.jpg" }],
    },
    sellerId: "2",
    listingModel: "user_products",
    hasVariations,
    permalink: null,
    title: `Produto ${id}`,
  };
}

function created(externalId: string): MarketplaceListing {
  return {
    externalId,
    title: "Produto",
    status: "active",
    subStatus: [],
    priceCents: 1000,
    currency: "BRL",
    availableQuantity: 1,
    soldQuantity: 0,
    permalink: null,
    thumbnailUrl: null,
    categoryId: "MLB1",
    listingTypeId: "gold_special",
    condition: "new",
    listingModel: "user_products",
    userProductId: null,
    familyId: null,
    familyName: "Produto",
    sellerSku: null,
    logisticType: null,
    externalUpdatedAt: new Date(),
    variations: [],
    raw: {},
  };
}

beforeAll(async () => {
  organizationId = (await db.organization.create({ data: { name: "[teste] lotes" } })).id;
  accountId = (
    await db.marketplaceAccount.create({
      data: {
        organizationId,
        marketplace: "mercadolivre",
        externalUserId: `test-${randomUUID()}`,
        nickname: "DESTINO",
        listingModel: "user_products",
        allowWrites: true,
        ...encryptTokens(
          {
            accessToken: "access",
            refreshToken: "refresh",
            expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
            scopes: null,
            externalUserId: "1",
          },
          key,
        ),
      },
    })
  ).id;
});

afterAll(async () => {
  await db.listingDraft.deleteMany({ where: { organizationId } });
  await db.syncJob.deleteMany({ where: { organizationId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

describe("batch jobs against the database", () => {
  it("replicates many listings into drafts, with a report", async () => {
    const start = await startReplicate(organizationId, null, {
      targetAccountId: accountId,
      sourceExternalIds: ["MLB1000001", "MLB1000002", "MLB1000003", "MLB1000001"],
      params: { price: { percent: 10, roundTo90: false }, listingTypeId: "gold_pro" },
    });
    expect(start.status).toBe("started");
    const jobId = start.status === "started" ? start.jobId : "";
    const connector = fakeConnector({
      getListingForCopy: async (_token, id) => source(id, id === "MLB1000003"),
    });
    expect(
      await runBatchRound(organizationId, jobId, later(), { key, connectorFor: () => connector }),
    ).toBe("completed");
    expect(await batchProgress(organizationId, jobId)).toMatchObject({
      status: "completed",
      total: 3,
      processed: 3,
      done: 2,
      skipped: 0,
      failed: 1,
      errors: [{ id: "MLB1000003", message: "Anúncio com variações: ainda não é copiado." }],
    });
    const drafts = await db.listingDraft.findMany({ where: { batchJobId: jobId } });
    expect(drafts).toHaveLength(2);
    expect(
      drafts.every((draft) => (draft.content as { priceCents: number }).priceCents === 1100),
    ).toBe(true);
  });

  it("pauses when the marketplace is unavailable and resumes from the same item", async () => {
    const start = await startReplicate(organizationId, null, {
      targetAccountId: accountId,
      sourceExternalIds: ["MLB2000001", "MLB2000002"],
      params: { price: null, listingTypeId: null },
    });
    const jobId = start.status === "started" ? start.jobId : "";
    let down = true;
    const connector = fakeConnector({
      getListingForCopy: async (_token, id) => {
        if (down && id === "MLB2000002") throw new MarketplaceApiError("down", 503);
        return source(id);
      },
    });
    const deps = { key, connectorFor: () => connector };
    expect(await runBatchRound(organizationId, jobId, later(), deps)).toBe("paused");
    expect(await batchProgress(organizationId, jobId)).toMatchObject({ processed: 1, done: 1 });
    down = false;
    expect(await runBatchRound(organizationId, jobId, later(), deps)).toBe("completed");
    expect(await batchProgress(organizationId, jobId)).toMatchObject({ processed: 2, done: 2 });
  });

  it("publishes drafts in batch: each once, refusals reported", async () => {
    const replicate = await startReplicate(organizationId, null, {
      targetAccountId: accountId,
      sourceExternalIds: ["MLB3000001", "MLB3000002"],
      params: { price: null, listingTypeId: null },
    });
    const replicateId = replicate.status === "started" ? replicate.jobId : "";
    await runBatchRound(organizationId, replicateId, later(), {
      key,
      connectorFor: () => fakeConnector({ getListingForCopy: async (_t, id) => source(id) }),
    });
    const drafts = await db.listingDraft.findMany({
      where: { batchJobId: replicateId },
      orderBy: { sourceExternalId: "asc" },
    });
    // Give them a category so they are complete for publishing.
    for (const draft of drafts) {
      await db.listingDraft.update({
        where: { id: draft.id },
        data: { content: { ...(draft.content as object), categoryId: "MLB1" } },
      });
    }

    const publish = await startPublish(
      organizationId,
      null,
      drafts.map((draft) => draft.id),
    );
    const publishId = publish.status === "started" ? publish.jobId : "";
    let count = 0;
    const connector = fakeConnector({
      publishListing: async () => {
        count++;
        if (count === 2) throw new MarketplaceValidationError(["Categoria exige atributo MODEL."]);
        return created(`MLB${Date.now()}${count}`);
      },
    });
    const deps = { key, connectorFor: () => connector };
    expect(await runBatchRound(organizationId, publishId, later(), deps)).toBe("completed");
    expect(await batchProgress(organizationId, publishId)).toMatchObject({
      done: 1,
      failed: 1,
      errors: [{ message: "Categoria exige atributo MODEL." }],
    });

    // Running the same drafts again never republishes the published one.
    const again = await startPublish(
      organizationId,
      null,
      drafts.map((draft) => draft.id),
    );
    expect(again.status).toBe("started"); // only the refused draft is still pending
    const againId = again.status === "started" ? again.jobId : "";
    expect((await batchProgress(organizationId, againId))?.total).toBe(1);
  });
});
