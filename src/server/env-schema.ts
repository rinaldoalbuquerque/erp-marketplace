import { z } from "zod";

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
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Validates environment variables. Throws a readable error listing the
 * missing/invalid variable names. Never includes the values (they are secrets).
 */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(
      `Invalid or missing environment variables: ${names.join(", ")}. ` +
        "Check your .env file (see .env.example).",
    );
  }
  return result.data;
}
