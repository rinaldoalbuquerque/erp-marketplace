import { z } from "zod";

export const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  DATABASE_URL: z.url(),
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
