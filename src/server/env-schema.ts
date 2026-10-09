import { z } from "zod";

/** Optional variable: empty string counts as "not set". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

export const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  DATABASE_URL: z.url(),
  /** Base URL used in e-mail links, e.g. http://localhost:3000 (no trailing slash). */
  NEXT_PUBLIC_SITE_URL: z.url().transform((url) => url.replace(/\/+$/, "")),
  /** Open sign-up. Only the exact value "true" enables it; anything else keeps it closed. */
  ALLOW_PUBLIC_SIGNUP: z
    .string()
    .optional()
    .transform((value) => value === "true"),

  // Marketplace integration. Optional so the rest of the ERP runs without them;
  // the Mercado Livre connector checks them when used (requireMercadoLivreConfig).
  /** base64 of 32 random bytes; encrypts marketplace tokens. Same value everywhere (local + Vercel). */
  TOKEN_ENCRYPTION_KEY: optional(z.string()),
  ML_CLIENT_ID: optional(z.string()),
  ML_CLIENT_SECRET: optional(z.string()),
  /** Must match exactly the redirect URI registered in the Mercado Livre application. */
  ML_REDIRECT_URI: optional(z.url()),
  /** Vercel Cron sends it as "Authorization: Bearer ..."; the daily order catch-up checks it. */
  CRON_SECRET: optional(z.string().min(16)),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Validates environment variables. Throws a readable error listing the
 * missing/invalid variable names. Never includes the values (they are secrets).
 */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  // Values pasted into .env or the Vercel dashboard often carry an invisible
  // trailing newline/space. Trim them, except the sign-up flag, which stays
  // strict on purpose (anything but exactly "true" keeps sign-up closed).
  const trimmed = Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      key,
      key === "ALLOW_PUBLIC_SIGNUP" ? value : value?.trim(),
    ]),
  );
  const result = serverEnvSchema.safeParse(trimmed);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(
      `Invalid or missing environment variables: ${names.join(", ")}. ` +
        "Check your .env file (see .env.example).",
    );
  }
  return result.data;
}
