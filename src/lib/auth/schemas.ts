import { z } from "zod";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password-strength";
import { normalizeBrazilianMobile } from "./phone";

// Validation shared by the forms (browser) and the Server Actions (server).
// The server always validates again: browser checks are only for convenience.

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Informe um e-mail válido." }));

export const newPasswordField = z
  .string()
  .min(PASSWORD_MIN_LENGTH, {
    error: `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`,
  })
  .max(PASSWORD_MAX_LENGTH, {
    error: `A senha pode ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`,
  });

export const signupSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, { error: "Informe seu nome." })
    .max(120, { error: "Nome muito longo." }),
  email,
  phone: z.string().transform((value, ctx) => {
    const normalized = normalizeBrazilianMobile(value);
    if (!normalized) {
      ctx.addIssue({ code: "custom", message: "Informe um celular válido com DDD." });
      return z.NEVER;
    }
    return normalized;
  }),
  password: newPasswordField,
  acceptTerms: z.literal(true, { error: "É preciso aceitar os termos para continuar." }),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email,
  // No length rules on login: just "is it filled in".
  password: z.string().min(1, { error: "Informe sua senha." }),
});

export const emailOnlySchema = z.object({ email });

export const resetPasswordSchema = z
  .object({
    password: newPasswordField,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    error: "As senhas não conferem.",
    path: ["confirmPassword"],
  });

/** Turns Zod errors into { field: "first message" } for the forms. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    result[key] ??= issue.message;
  }
  return result;
}
