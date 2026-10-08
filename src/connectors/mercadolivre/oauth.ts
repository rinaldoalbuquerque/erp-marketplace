import { z } from "zod";

import { MarketplaceApiError, MarketplaceAuthError, type OAuthTokens } from "../types";
import { ML_API_BASE, mlFetch, readErrorBody, type FetchFn } from "./http";

// OAuth 2.0 Authorization Code (server side) with PKCE.
// Docs: https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao
// - Authorization URL for Brazil: https://auth.mercadolivre.com.br/authorization
// - Token endpoint: POST https://api.mercadolibre.com/oauth/token (form body)
// - access_token lasts 6h (expires_in: 21600); refresh_token is SINGLE-USE and
//   a new one comes in every refresh; refresh_token expires after 6 months.

export const ML_AUTHORIZATION_URL = "https://auth.mercadolivre.com.br/authorization";
export const ML_TOKEN_URL = `${ML_API_BASE}/oauth/token`;

export type MercadoLivreAppConfig = {
  clientId: string;
  clientSecret: string;
  /** Must match exactly the one registered in the application (no variable parts). */
  redirectUri: string;
};

export function buildAuthorizationUrl(
  config: MercadoLivreAppConfig,
  { state, codeChallenge }: { state: string; codeChallenge: string },
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${ML_AUTHORIZATION_URL}?${params.toString()}`;
}

// Response documented as:
// { access_token, token_type: "bearer", expires_in: 21600, scope: "offline_access read write",
//   user_id: 1234567, refresh_token }
const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
  user_id: z.union([z.number(), z.string()]),
  refresh_token: z.string().min(1),
});

/** Errors that mean the seller must authorize again (doc: "Referencia de códigos de erro"). */
const REAUTH_ERRORS = new Set(["invalid_grant", "unauthorized_client"]);

async function requestTokens(
  fetchFn: FetchFn,
  body: Record<string, string>,
  now: () => Date,
): Promise<OAuthTokens> {
  const response = await mlFetch(fetchFn, ML_TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });

  if (!response.ok) {
    const error = await readErrorBody(response);
    const code = error.error ?? `http_${response.status}`;
    if (REAUTH_ERRORS.has(code)) {
      throw new MarketplaceAuthError("Mercado Livre authorization is no longer valid.", code);
    }
    throw new MarketplaceApiError("Mercado Livre token request failed.", response.status, code);
  }

  const parsed = tokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new MarketplaceApiError("Unexpected token response from Mercado Livre.", response.status);
  }
  const data = parsed.data;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(now().getTime() + data.expires_in * 1000),
    scopes: data.scope ?? null,
    externalUserId: String(data.user_id),
  };
}

export function exchangeCode(
  config: MercadoLivreAppConfig,
  fetchFn: FetchFn,
  { code, codeVerifier }: { code: string; codeVerifier: string },
  now: () => Date = () => new Date(),
): Promise<OAuthTokens> {
  return requestTokens(
    fetchFn,
    {
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
      code_verifier: codeVerifier,
    },
    now,
  );
}

export function refreshTokens(
  config: MercadoLivreAppConfig,
  fetchFn: FetchFn,
  refreshToken: string,
  now: () => Date = () => new Date(),
): Promise<OAuthTokens> {
  return requestTokens(
    fetchFn,
    {
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
    },
    now,
  );
}
