import "server-only";

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { resolveAccessRedirect } from "@/lib/auth/routes";
import { env } from "@/server/env";

// Based on the official example:
// https://github.com/vercel/next.js/tree/canary/examples/with-supabase (lib/supabase/proxy.ts)

/**
 * Runs on every page request (see src/proxy.ts): refreshes the Supabase session
 * cookies and redirects logged-out users away from internal pages.
 * This is the first layer only: pages and Server Actions check the user again.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and getClaims(): it can cause
  // users to be randomly logged out (per Supabase docs).
  // getClaims() verifies the token signature, unlike getSession().
  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = Boolean(data?.claims?.sub);

  const target = resolveAccessRedirect(request.nextUrl.pathname, isLoggedIn);
  if (target) {
    const redirect = NextResponse.redirect(new URL(target, request.url));
    // Keep refreshed session cookies on the redirect response.
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  return response;
}
