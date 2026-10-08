import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { ROUTES } from "@/lib/auth/routes";
import { provisionUserInDatabase } from "@/server/auth/provisioning-store";
import { env } from "@/server/env";
import { createSupabaseServerClient } from "@/server/supabase";

// Handles the links in Supabase e-mails (sign-up confirmation and password reset).
// The e-mail templates must point here:
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email     (Confirm signup)
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery  (Reset password)
// Based on: https://supabase.com/docs/guides/auth/server-side/nextjs
// and https://github.com/supabase/supabase/blob/master/examples/user-management/nextjs-user-management/app/auth/confirm/route.ts

const ALLOWED_TYPES = new Set<EmailOtpType>(["email", "signup", "recovery"]);

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;

  // Redirect URLs never carry the token (keeps it out of history and logs).
  const go = (path: string) => NextResponse.redirect(new URL(path, request.url));
  const invalidLink = () => go(`${ROUTES.login}?erro=link-invalido`);

  if (!tokenHash || !type || !ALLOWED_TYPES.has(type)) {
    return invalidLink();
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error || !data.user) {
    return invalidLink();
  }

  if (type === "recovery") {
    // The user now has a short session that allows changing the password.
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
