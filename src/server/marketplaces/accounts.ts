import "server-only";

import {
  MarketplaceApiError,
  MarketplaceAuthError,
  type MarketplaceConnector,
  type MarketplaceId,
} from "@/connectors/types";
import type { CurrentMember } from "@/server/auth/session";
import { db } from "@/server/db";
import type { TenantDb } from "@/server/tenant/tenant-db";

import { getConnector, getTokenEncryptionKey } from "./config";
import { encryptTokens, getAccessToken, ReconnectRequiredError } from "./token-service";

export type ConnectResult =
  | { status: "connected"; accountId: string; nickname: string }
  | { status: "other_organization" }
  | { status: "auth_failed" }
  | { status: "marketplace_error" };

/**
 * Finishes the OAuth flow: exchanges the code for tokens, reads who the account
 * is, and saves it (tokens encrypted). Reconnecting an existing account updates
 * it in place. An account already linked to ANOTHER organization is refused.
 */
export async function completeConnection(
  member: CurrentMember,
  tdb: TenantDb,
  input: { marketplace: MarketplaceId; code: string; codeVerifier: string },
  deps: { connector?: MarketplaceConnector; key?: Buffer } = {},
): Promise<ConnectResult> {
  const connector = deps.connector ?? getConnector(input.marketplace);
  const key = deps.key ?? getTokenEncryptionKey();

  let tokens;
  let profile;
  try {
    tokens = await connector.exchangeCode({ code: input.code, codeVerifier: input.codeVerifier });
    profile = await connector.getAccountProfile(tokens.accessToken);
  } catch (error) {
    if (error instanceof MarketplaceAuthError) return { status: "auth_failed" };
    if (error instanceof MarketplaceApiError) return { status: "marketplace_error" };
    throw error;
  }
  if (profile.externalUserId !== tokens.externalUserId) return { status: "auth_failed" };

  // Global check (unscoped on purpose): one marketplace account, one organization.
  const existing = await db.marketplaceAccount.findUnique({
    where: {
      marketplace_externalUserId: {
        marketplace: input.marketplace,
        externalUserId: profile.externalUserId,
      },
    },
    select: { organizationId: true },
  });
  if (existing && existing.organizationId !== member.organizationId) {
    return { status: "other_organization" };
  }

  const data = {
    nickname: profile.nickname,
    siteId: profile.siteId,
    listingModel: profile.listingModel,
    multiWarehouse: profile.multiWarehouse,
    status: "active" as const,
    ...encryptTokens(tokens, key),
    lastTokenRefreshAt: new Date(),
    lastError: null,
    connectedById: member.user.id,
  };
  const account = await tdb.marketplaceAccount.upsert({
    where: {
      marketplace_externalUserId: {
        marketplace: input.marketplace,
        externalUserId: profile.externalUserId,
      },
    },
    create: {
      organizationId: member.organizationId,
      marketplace: input.marketplace,
      externalUserId: profile.externalUserId,
      ...data,
    },
    update: data,
    select: { id: true, nickname: true },
  });
  return { status: "connected", accountId: account.id, nickname: account.nickname };
}

/** Accounts of the organization for the "Contas de marketplace" page (never the tokens). */
export function listAccounts(tdb: TenantDb) {
  return tdb.marketplaceAccount.findMany({
    orderBy: [{ status: "asc" }, { nickname: "asc" }],
    select: {
      id: true,
      marketplace: true,
      externalUserId: true,
      nickname: true,
      siteId: true,
      listingModel: true,
      status: true,
      allowWrites: true,
      stockSyncEnabled: true,
      multiWarehouse: true,
      orderStockEnabled: true,
      orderStockSince: true,
      lastError: true,
      lastSyncAt: true,
      createdAt: true,
      connectedBy: { select: { fullName: true } },
    },
  });
}

/** Erases the tokens and marks the account as disconnected (the row stays for history). */
export async function disconnectAccount(tdb: TenantDb, accountId: string) {
  const result = await tdb.marketplaceAccount.updateMany({
    where: { id: accountId },
    data: {
      status: "disconnected",
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      accessTokenExpiresAt: null,
      lastError: null,
    },
  });
  return result.count > 0;
}

export type TestResult =
  | { status: "ok"; nickname: string }
  | { status: "reconnect" }
  | { status: "error" }
  | { status: "not_found" };

/** Calls the marketplace with the stored token (refreshing it if needed) and updates the account data. */
export async function testConnection(
  member: CurrentMember,
  tdb: TenantDb,
  accountId: string,
): Promise<TestResult> {
  const account = await tdb.marketplaceAccount.findFirst({
    where: { id: accountId },
    select: { marketplace: true },
  });
  if (!account) return { status: "not_found" };
  try {
    const token = await getAccessToken(member.organizationId, accountId);
    const profile = await getConnector(account.marketplace).getAccountProfile(token);
    await tdb.marketplaceAccount.updateMany({
      where: { id: accountId },
      data: {
        nickname: profile.nickname,
        siteId: profile.siteId,
        listingModel: profile.listingModel,
        multiWarehouse: profile.multiWarehouse,
        lastError: null,
      },
    });
    return { status: "ok", nickname: profile.nickname };
  } catch (error) {
    if (error instanceof ReconnectRequiredError) return { status: "reconnect" };
    if (error instanceof MarketplaceAuthError) {
      await tdb.marketplaceAccount.updateMany({
        where: { id: accountId },
        data: {
          status: "needs_reauth",
          lastError: "O Mercado Livre recusou o acesso. Reconecte a conta.",
        },
      });
      return { status: "reconnect" };
    }
    if (error instanceof MarketplaceApiError) {
      await tdb.marketplaceAccount.updateMany({
        where: { id: accountId },
        data: { lastError: "Não foi possível falar com o Mercado Livre agora. Tente de novo." },
      });
      return { status: "error" };
    }
    throw error;
  }
}
