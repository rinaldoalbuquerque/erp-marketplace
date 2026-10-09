import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MarketplaceApiError,
  MarketplaceValidationError,
  type MarketplaceListing,
} from "@/connectors/types";
import { db } from "@/server/db";
import {
  addDraftPicture,
  createDraft,
  loadDraft,
  publishDraft,
  saveDraftContent,
  validateDraft,
} from "@/server/listings/draft-service";
import { encryptTokens } from "@/server/marketplaces/token-service";
import { tenantDb } from "@/server/tenant/tenant-db";
import { fakeConnector } from "@/test/fake-connector";

// Real database (`npm run test:db`) in a TEMPORARY organization deleted at the end.
// Mercado Livre is simulated: nothing is published anywhere.

const key = randomBytes(32);
let organizationId: string;
let accountId: string;
let skuId: string;

const ctx = () => ({ tdb: tenantDb(organizationId), organizationId, userId: null });

function created(externalId: string): MarketplaceListing {
  return {
    externalId,
    title: "Borracha Panela de Pressão 4,5 L Clock",
    status: "active",
    subStatus: [],
    priceCents: 2990,
    currency: "BRL",
    availableQuantity: 5,
    soldQuantity: 0,
    permalink: null,
    thumbnailUrl: null,
    categoryId: "MLB1234",
    listingTypeId: "gold_special",
    condition: "new",
    listingModel: "user_products",
    userProductId: "MLBU1",
    familyId: "1",
    familyName: "Borracha Panela de Pressão 4,5 L",
    sellerSku: null,
    logisticType: "xd_drop_off",
    externalUpdatedAt: new Date(),
    variations: [],
    raw: {},
  };
}

async function readyDraft() {
  const result = await createDraft(ctx(), { accountId, skuId });
  if (result.status !== "created") throw new Error(result.status);
  const draft = await loadDraft(ctx().tdb, result.draftId);
  await saveDraftContent(ctx().tdb, result.draftId, {
    ...draft!.listing,
    categoryId: "MLB1234",
    priceCents: 2990,
    description: "Borracha de silicone.",
    pictures: [{ id: "123-MLB1_1", url: null }],
  });
  return result.draftId;
}

beforeAll(async () => {
  organizationId = (await db.organization.create({ data: { name: "[teste] rascunhos" } })).id;
  accountId = (
    await db.marketplaceAccount.create({
      data: {
        organizationId,
        marketplace: "mercadolivre",
        externalUserId: `test-${randomUUID()}`,
        nickname: "TESTE",
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
  const productId = (
    await db.product.create({
      data: { organizationId, name: "Borracha Panela de Pressão 4,5 L", brand: "Clock" },
    })
  ).id;
  skuId = (
    await db.sku.create({
      data: {
        organizationId,
        productId,
        code: `TESTE-${randomUUID().slice(0, 8)}`,
        ean: "7891234567895",
        stockOnHand: 5,
      },
    })
  ).id;
});

afterAll(async () => {
  await db.listingDraft.deleteMany({ where: { organizationId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

beforeEach(async () => {
  await db.marketplaceAccount.update({ where: { id: accountId }, data: { allowWrites: true } });
});

describe("listing drafts against the database", () => {
  it("a draft from a SKU starts with name, brand, EAN and stock", async () => {
    const result = await createDraft(ctx(), { accountId, skuId });
    const draft = await loadDraft(ctx().tdb, result.status === "created" ? result.draftId : "");
    expect(draft).toMatchObject({ status: "draft", model: "user_products", editable: true });
    expect(draft?.listing).toMatchObject({
      familyName: "Borracha Panela de Pressão 4,5 L",
      availableQuantity: 5,
      attributes: [
        { id: "BRAND", valueName: "Clock" },
        { id: "GTIN", valueName: "7891234567895" },
      ],
    });
  });

  it("validation: incomplete first, then the marketplace refusal is kept on the draft", async () => {
    const result = await createDraft(ctx(), { accountId, skuId });
    const draftId = result.status === "created" ? result.draftId : "";
    const connector = fakeConnector({
      validateListing: async () => {
        throw new MarketplaceValidationError(["Atributo MODEL obrigatório."]);
      },
    });
    const deps = { key, connectorFor: () => connector };
    expect(await validateDraft(ctx(), draftId, deps)).toMatchObject({ status: "incomplete" });

    const ready = await readyDraft();
    expect(await validateDraft(ctx(), ready, deps)).toEqual({
      status: "refused",
      errors: ["Atributo MODEL obrigatório."],
    });
    expect(await loadDraft(ctx().tdb, ready)).toMatchObject({
      status: "failed",
      lastErrors: ["Atributo MODEL obrigatório."],
    });
  });

  it("publishes once: imports the listing, links the SKU, sends the description", async () => {
    const draftId = await readyDraft();
    const externalId = `MLB${Date.now()}`;
    const publish = vi.fn(async () => created(externalId));
    const descriptions: string[] = [];
    const connector = fakeConnector({
      publishListing: publish,
      updateListingDescription: async (_token, _id, text, exists) => {
        expect(exists).toBe(false);
        descriptions.push(text);
      },
    });
    const deps = { key, connectorFor: () => connector };

    const result = await publishDraft(ctx(), draftId, deps);
    expect(result).toMatchObject({ status: "published", externalId, descriptionFailed: false });
    expect(descriptions).toEqual(["Borracha de silicone."]);

    const listing = await db.listing.findFirstOrThrow({ where: { organizationId, externalId } });
    const mapping = await db.skuListingMapping.findFirst({ where: { listingId: listing.id } });
    expect(mapping?.skuId).toBe(skuId);
    expect(await loadDraft(ctx().tdb, draftId)).toMatchObject({
      status: "published",
      externalId,
      listingId: listing.id,
      editable: false,
    });

    // Second click / second tab: nothing is published again.
    expect(await publishDraft(ctx(), draftId, deps)).toEqual({ status: "locked" });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("needs the account switch to publish", async () => {
    const draftId = await readyDraft();
    await db.marketplaceAccount.update({ where: { id: accountId }, data: { allowWrites: false } });
    const connector = fakeConnector();
    expect(await publishDraft(ctx(), draftId, { key, connectorFor: () => connector })).toEqual({
      status: "writes_disabled",
    });
  });

  it("a lost answer is not retried and asks the user to check first", async () => {
    const draftId = await readyDraft();
    const publish = vi.fn(async () => {
      throw new MarketplaceApiError("no answer", null);
    });
    const result = await publishDraft(ctx(), draftId, {
      key,
      connectorFor: () => fakeConnector({ publishListing: publish }),
    });
    expect(result).toEqual({ status: "unconfirmed" });
    expect(publish).toHaveBeenCalledTimes(1);
    const draft = await loadDraft(ctx().tdb, draftId);
    expect(draft?.status).toBe("failed");
    expect(draft?.lastErrors[0]).toContain("não confirmou");
  });

  it("uploaded pictures are appended to the draft", async () => {
    const draftId = await readyDraft();
    const connector = fakeConnector({
      uploadPicture: async () => ({ id: "999-MLB_2", url: "https://http2.mlstatic.com/x.jpg" }),
    });
    const result = await addDraftPicture(ctx(), draftId, new Blob(["img"]), "foto.jpg", {
      key,
      connectorFor: () => connector,
    });
    expect(result.status).toBe("ok");
    const draft = await loadDraft(ctx().tdb, draftId);
    expect(draft?.listing.pictures.map((picture) => picture.id)).toEqual([
      "123-MLB1_1",
      "999-MLB_2",
    ]);
  });
});
