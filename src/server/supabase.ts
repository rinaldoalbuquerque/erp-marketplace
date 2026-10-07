import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { env } from "@/server/env";

// Based on the official example:
// https://github.com/vercel/next.js/tree/canary/examples/with-supabase
// Session cookies are refreshed in proxy.ts (added with the auth task).

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Create a new one per request; never store it in a global variable.
 * Used for Auth only: business data goes through Prisma (src/server/db.ts).
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component, which cannot set cookies.
            // Safe to ignore because proxy.ts refreshes the session.
          }
        },
      },
    },
  );
}
