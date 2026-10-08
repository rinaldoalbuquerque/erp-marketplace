import { NextResponse, type NextRequest } from "next/server";

import { requirePermission } from "@/server/auth/session";
import { completeConnection } from "@/server/marketplaces/accounts";
import { getTokenEncryptionKey } from "@/server/marketplaces/config";
import { openOAuthState } from "@/server/marketplaces/oauth-state";
import { getTenantContext } from "@/server/tenant/tenant-db";

import { ML_OAUTH_COOKIE, ML_OAUTH_COOKIE_PATH } from "../oauth-cookie";

// Step 2: Mercado Livre redirects here with ?code=...&state=...
// The redirect URI registered in the application must be exactly this URL.
// Docs: https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao
// ("Mercado Livre não valida este campo" -> we validate `state` ourselves.)
export async function GET(request: NextRequest) {
  const member = await requirePermission("marketplaceAccounts.manage");
  const params = request.nextUrl.searchParams;

  const done = (query: string) => {
    // Codes and tokens never go into the URL we redirect to.
    const response = NextResponse.redirect(new URL(`/contas?${query}`, request.url));
    response.cookies.set(ML_OAUTH_COOKIE, "", { path: ML_OAUTH_COOKIE_PATH, maxAge: 0 });
    return response;
  };

  // The seller clicked "cancel" or Mercado Livre returned an error.
  if (params.get("error")) return done("erro=autorizacao-cancelada");

  const check = openOAuthState(
    request.cookies.get(ML_OAUTH_COOKIE)?.value,
    {
      state: params.get("state"),
      marketplace: "mercadolivre",
      organizationId: member.organizationId,
      userId: member.user.id,
    },
    getTokenEncryptionKey(),
  );
  const code = params.get("code");
  if (!check.ok || !code) {
    return done(check.ok || check.reason !== "expired" ? "erro=link-invalido" : "erro=expirado");
  }

  const { tdb } = await getTenantContext(member);
  const result = await completeConnection(member, tdb, {
    marketplace: "mercadolivre",
    code,
    codeVerifier: check.payload.codeVerifier,
  });

  switch (result.status) {
    case "connected":
      return done(`conectada=${encodeURIComponent(result.nickname)}`);
    case "other_organization":
      return done("erro=outra-empresa");
    case "auth_failed":
      return done("erro=autorizacao-recusada");
    case "marketplace_error":
      return done("erro=mercadolivre-indisponivel");
  }
}
