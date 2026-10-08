import { createBrowserClient } from "@supabase/ssr";

// Based on the official example:
// https://github.com/vercel/next.js/tree/canary/examples/with-supabase

/**
 * Supabase client for Client Components. Auth only (login, logout, sign-up):
 * the browser never reads business data from the database directly.
 */
export function createSupabaseBrowserClient() {
  // NEXT_PUBLIC_* vars must be read literally so Next.js can inline them.
  // Trimmed: pasted values can carry an invisible trailing newline.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example).",
    );
  }
  return createBrowserClient(url, key);
}
