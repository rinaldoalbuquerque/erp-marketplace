import "server-only";

import {
  MarketplaceAuthError,
  type MarketplaceConnector,
  type MarketplaceId,
  type OAuthTokens,
} from "@/connectors/types";
import { decryptSecret, encryptSecret } from "@/server/crypto/secret-box";
import { db } from "@/server/db";

import { getConnector, getTokenEncryptionKey } from "./config";

// Access tokens with automatic refresh (CLAUDE.md: "renovação automática é obrigatória").
//
// Mercado Livre refresh tokens are SINGLE-USE and only the latest one is valid
// (https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao, "Refresh token").
// If two requests refreshed at the same time, the second would use a refresh
// token the first already spent, and the account would be locked out. So each
// refresh runs inside a transaction holding a per-account advisory lock: the
// first caller refreshes, the others wait and then reuse the new token.
//
// Internal routine: uses the unscoped `db`, always filtering by organizationId.

/** Refresh when the token has less than this left (ML recommends refreshing only when needed). */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** The account must be connected again by its owner (status needs_reauth / disconnected). */
export class ReconnectRequiredError extends Error {
  constructor(readonly accountId: string) {
    super("Marketplace account must be reconnected.");
    this.name = "ReconnectRequiredError";
  }
}

export type TokenDeps = {
  key?: Buffer;
  now?: () => Date;
  connectorFor?: (marketplace: MarketplaceId) => MarketplaceConnector;
};

/** Encrypted token columns for a set of tokens (used on connect and on refresh). */
export function encryptTokens(tokens: OAuthTokens, key: Buffer) {
  return {
    accessTokenEncrypted: encryptSecret(tokens.accessToken, key),
    refreshTokenEncrypted: encryptSecret(tokens.refreshToken, key),
    accessTokenExpiresAt: tokens.expiresAt,
    scopes: tokens.scopes,
  };
}

const needsRefresh = (expiresAt: Date | null, now: Date) =>
  !expiresAt || expiresAt.getTime() - now.getTime() < REFRESH_MARGIN_MS;

/**
 * A valid access token for the account, refreshing it first if it is about to
 * expire. Throws ReconnectRequiredError when the marketplace no longer accepts
 * the authorization (the account is marked needs_reauth).
 */
export async function getAccessToken(
  organizationId: string,
  accountId: string,
  deps: TokenDeps = {},
): Promise<string> {
  const key = deps.key ?? getTokenEncryptionKey();
  const now = deps.now ?? (() => new Date());
  const connectorFor = deps.connectorFor ?? getConnector;

  const account = await db.marketplaceAccount.findFirst({
    where: { id: accountId, organizationId },
    select: { status: true, accessTokenEncrypted: true, accessTokenExpiresAt: true },
  });
  if (!account || account.status !== "active" || !account.accessTokenEncrypted) {
    throw new ReconnectRequiredError(accountId);
  }
  if (!needsRefresh(account.accessTokenExpiresAt, now())) {
    return decryptSecret(account.accessTokenEncrypted, key);
  }

  const outcome = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`marketplace-token:${accountId}`}))`;

      // Re-read under the lock: another request may have refreshed already.
      const locked = await tx.marketplaceAccount.findFirst({
        where: { id: accountId, organizationId },
        select: {
          marketplace: true,
          status: true,
          accessTokenEncrypted: true,
          refreshTokenEncrypted: true,
          accessTokenExpiresAt: true,
        },
      });
      if (!locked || locked.status !== "active" || !locked.refreshTokenEncrypted) {
        return { kind: "reconnect" } as const;
      }
      if (locked.accessTokenEncrypted && !needsRefresh(locked.accessTokenExpiresAt, now())) {
        return { kind: "token", token: decryptSecret(locked.accessTokenEncrypted, key) } as const;
      }

      try {
        const tokens = await connectorFor(locked.marketplace).refreshTokens(
          decryptSecret(locked.refreshTokenEncrypted, key),
        );
        await tx.marketplaceAccount.update({
          where: { id: accountId },
          data: { ...encryptTokens(tokens, key), lastTokenRefreshAt: now(), lastError: null },
        });
        return { kind: "token", token: tokens.accessToken } as const;
      } catch (error) {
        if (error instanceof MarketplaceAuthError) {
          await tx.marketplaceAccount.update({
            where: { id: accountId },
            data: {
              status: "needs_reauth",
              lastError: "O Mercado Livre não aceita mais a autorização. Reconecte a conta.",
            },
          });
          return { kind: "reconnect" } as const;
        }
        throw error;
      }
    },
    // The refresh is an HTTP call to the marketplace; allow it time inside the lock.
    { timeout: 30_000, maxWait: 30_000 },
  );

  if (outcome.kind === "reconnect") throw new ReconnectRequiredError(accountId);
  return outcome.token;
}
