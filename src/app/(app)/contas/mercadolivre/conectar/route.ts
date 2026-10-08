import { NextResponse, type NextRequest } from "next/server";

import { createOAuthState, createPkcePair } from "@/connectors/oauth/pkce";
import { requirePermission } from "@/server/auth/session";
import {
  getConnector,
  getTokenEncryptionKey,
  IntegrationNotConfiguredError,
} from "@/server/marketplaces/config";
import { OAUTH_COOKIE_TTL_SECONDS, sealOAuthState } from "@/server/marketplaces/oauth-state";

import { ML_OAUTH_COOKIE, ML_OAUTH_COOKIE_PATH } from "../oauth-cookie";

// Step 1 of connecting a Mercado Livre account: remember state + PKCE verifier
// in an encrypted cookie and send the seller to Mercado Livre to authorize.
// Docs: https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao
export async function GET(request: NextRequest) {
  const member = await requirePermission("marketplaceAccounts.manage");

  let connector;
  let key;
  try {
    connector = getConnector("mercadolivre");
    key = getTokenEncryptionKey();
  } catch (error) {
    if (error instanceof IntegrationNotConfiguredError) {
      return NextResponse.redirect(new URL("/contas?erro=nao-configurado", request.url));
    }
    throw error;
  }

  const state = createOAuthState();
  const { codeVerifier, codeChallenge } = createPkcePair();
  const sealed = sealOAuthState(
    {
      marketplace: "mercadolivre",
      state,
      codeVerifier,
      organizationId: member.organizationId,
      userId: member.user.id,
    },
    key,
  );

  const response = NextResponse.redirect(connector.buildAuthorizationUrl({ state, codeChallenge }));
  response.cookies.set(ML_OAUTH_COOKIE, sealed, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    // "lax": the cookie is sent when Mercado Livre redirects back (top-level GET).
    sameSite: "lax",
    path: ML_OAUTH_COOKIE_PATH,
    maxAge: OAUTH_COOKIE_TTL_SECONDS,
  });
  return response;
}
