import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  MarketplaceAuthError,
  type MarketplaceConnector,
  type OAuthTokens,
} from "@/connectors/types";
import { decryptSecret } from "@/server/crypto/secret-box";
import { db } from "@/server/db";
import {
  encryptTokens,
  getAccessToken,
  ReconnectRequiredError,
} from "@/server/marketplaces/token-service";

// Real database (`npm run test:db`), TEMPORARY organization deleted at the end.
// The marketplace is simulated: no call reaches Mercado Livre.

const key = randomBytes(32);
let organizationId: string;
let accountId: string;
let now = new Date();

/** Fake connector whose refresh behaves like Mercado Livre's single-use refresh tokens. */
function fakeConnector() {
  let validRefreshToken = "refresh-0";
  let generation = 0;
  const calls = { refresh: 0 };
  const connector: MarketplaceConnector = {
    id: "mercadolivre",
    label: "Mercado Livre",
    buildAuthorizationUrl: () => "",
    exchangeCode: async () => {
      throw new Error("not used");
    },
    getAccountProfile: async () => {
      throw new Error("not used");
    },
    listListingIds: async () => [],
    getListings: async () => [],
    refreshTokens: async (refreshToken): Promise<OAuthTokens> => {
      calls.refresh++;
      await new Promise((resolve) => setTimeout(resolve, 50)); // network latency
      if (refreshToken !== validRefreshToken) {
        throw new MarketplaceAuthError("used refresh token", "invalid_grant");
      }
      generation++;
      validRefreshToken = `refresh-${generation}`;
      return {
        accessToken: `access-${generation}`,
        refreshToken: validRefreshToken,
        expiresAt: new Date(now.getTime() + 6 * 60 * 60 * 1000),
        scopes: "offline_access read write",
        externalUserId: "1234567",
      };
    },
  };
  return { connector, calls };
}

async function setTokens(expiresInMs: number) {
  await db.marketplaceAccount.update({
    where: { id: accountId },
    data: {
      status: "active",
      ...encryptTokens(
        {
          accessToken: "access-0",
          refreshToken: "refresh-0",
          expiresAt: new Date(now.getTime() + expiresInMs),
          scopes: null,
          externalUserId: "1234567",
        },
        key,
      ),
    },
  });
}

beforeAll(async () => {
  organizationId = (await db.organization.create({ data: { name: "[teste] tokens" } })).id;
  accountId = (
    await db.marketplaceAccount.create({
      data: {
        organizationId,
        marketplace: "mercadolivre",
        externalUserId: `test-${randomUUID()}`,
        nickname: "TESTE",
      },
    })
  ).id;
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

beforeEach(() => {
  now = new Date();
});

describe("getAccessToken against the database", () => {
  it("returns the stored token without refreshing while it is valid", async () => {
    await setTokens(60 * 60 * 1000);
    const { connector, calls } = fakeConnector();
    const token = await getAccessToken(organizationId, accountId, {
      key,
      connectorFor: () => connector,
    });
    expect(token).toBe("access-0");
    expect(calls.refresh).toBe(0);
  });

  it("refreshes an expiring token and stores the new (encrypted) pair", async () => {
    await setTokens(60 * 1000); // 1 minute left
    const { connector, calls } = fakeConnector();
    const token = await getAccessToken(organizationId, accountId, {
      key,
      connectorFor: () => connector,
    });
    expect(token).toBe("access-1");
    expect(calls.refresh).toBe(1);
    const row = await db.marketplaceAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(row.refreshTokenEncrypted).not.toContain("refresh-1");
    expect(decryptSecret(row.refreshTokenEncrypted as string, key)).toBe("refresh-1");
  });

  it("10 simultaneous requests with an expired token refresh only ONCE", async () => {
    await setTokens(-1000); // already expired
    const { connector, calls } = fakeConnector();
    const tokens = await Promise.all(
      Array.from({ length: 10 }, () =>
        getAccessToken(organizationId, accountId, { key, connectorFor: () => connector }),
      ),
    );
    expect(calls.refresh).toBe(1);
    expect(new Set(tokens)).toEqual(new Set(["access-1"]));
    const row = await db.marketplaceAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(row.status).toBe("active");
  });

  it("invalid_grant marks the account as needing reconnection", async () => {
    await setTokens(-1000);
    const { connector } = fakeConnector();
    // Spend the stored refresh token elsewhere, like a revoked authorization.
    await connector.refreshTokens("refresh-0");
    await expect(
      getAccessToken(organizationId, accountId, { key, connectorFor: () => connector }),
    ).rejects.toBeInstanceOf(ReconnectRequiredError);
    const row = await db.marketplaceAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(row.status).toBe("needs_reauth");
    expect(row.lastError).toBeTruthy();
  });

  it("another organization can't get this account's token", async () => {
    await setTokens(60 * 60 * 1000);
    const { connector } = fakeConnector();
    await expect(
      getAccessToken(randomUUID(), accountId, { key, connectorFor: () => connector }),
    ).rejects.toBeInstanceOf(ReconnectRequiredError);
  });
});
