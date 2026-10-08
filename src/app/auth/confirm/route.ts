import { NextResponse, type NextRequest } from "next/server";

import { parseConfirmParams } from "@/lib/auth/confirm-params";
import { ROUTES } from "@/lib/auth/routes";
import { provisionUserInDatabase } from "@/server/auth/provisioning-store";
import { env } from "@/server/env";
import { createSupabaseServerClient } from "@/server/supabase";

// Handles the links in Supabase e-mails (sign-up confirmation and password reset).
// Accepts both link formats, see src/lib/auth/confirm-params.ts:
// - default templates: ?flow=signup|recovery&code=...   (PKCE, current setup)
// - custom templates:  ?token_hash=...&type=email|recovery  (needs custom SMTP)
// Based on: https://supabase.com/docs/guides/auth/server-side/nextjs
// and https://supabase.com/docs/guides/auth/sessions/pkce-flow

export async function GET(request: NextRequest) {
  // Redirect URLs never carry the token/code (keeps them out of history and logs).
  const go = (path: string) => NextResponse.redirect(new URL(path, request.url));
  const invalidLink = () => go(`${ROUTES.login}?erro=link-invalido`);

  const confirm = parseConfirmParams(request.nextUrl.searchParams);
  if (confirm.kind === "invalid") return invalidLink();

  const supabase = await createSupabaseServerClient();
  const { data, error } =
    confirm.kind === "code"
      ? await supabase.auth.exchangeCodeForSession(confirm.code)
      : await supabase.auth.verifyOtp({ type: confirm.type, token_hash: confirm.tokenHash });

  if (error || !data.user) {
    // PKCE codes only work in the browser where sign-up/reset started.
    // For sign-up, logging in completes the setup (provisioning runs on login).
    if (confirm.kind === "code" && confirm.flow === "signup") {
      return go(`${ROUTES.login}?erro=entre-para-continuar`);
    }
    return invalidLink();
  }

  if (confirm.flow === "recovery") {
    // The user now has a session that allows changing the password.
    return go(ROUTES.resetPassword);
  }

  try {
    const result = await provisionUserInDatabase({
      userId: data.user.id,
      metadata: data.user.user_metadata,
      allowPublicSignup: env.ALLOW_PUBLIC_SIGNUP,
    });
    if (result === "created" || result === "already_provisioned") {
      return go(`${ROUTES.home}?bem-vindo=1`);
    }
    return go(ROUTES.noAccess);
  } catch (provisioningError) {
    // E-mail is confirmed; provisioning is retried on the next login.
    console.error("Provisioning failed after e-mail confirmation", {
      userId: data.user.id,
      error: provisioningError instanceof Error ? provisioningError.message : "unknown",
    });
    return go(`${ROUTES.login}?erro=tente-novamente`);
  }
}
