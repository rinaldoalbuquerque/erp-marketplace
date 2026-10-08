"use server";

import { redirect } from "next/navigation";

import { authErrorMessage, SIGNUP_CLOSED } from "@/lib/auth/error-messages";
import { readFields, type FormState } from "@/lib/auth/form-state";
import { evaluatePassword } from "@/lib/auth/password-strength";
import { ROUTES } from "@/lib/auth/routes";
import { emailOnlySchema, fieldErrors, signupSchema } from "@/lib/auth/schemas";
import { isPwnedPassword } from "@/server/auth/pwned-password";
import { env } from "@/server/env";
import { createSupabaseServerClient } from "@/server/supabase";

// Server Actions are public endpoints: each one validates its input on the
// server, regardless of what the form in the browser already checked.

const confirmUrl = () => `${env.NEXT_PUBLIC_SITE_URL}${ROUTES.emailConfirm}`;

/** Server-side password checks shared by sign-up and password reset. */
async function passwordProblem(password: string, userInputs: string[]): Promise<string | null> {
  const strength = await evaluatePassword(password, userInputs);
  if (!strength.acceptable) {
    return `Senha fraca.${strength.warning ? ` ${strength.warning}` : ""} Tente uma frase longa.`;
  }
  if (await isPwnedPassword(password)) {
    return "Essa senha já apareceu em vazamentos de dados na internet. Escolha outra.";
  }
  return null;
}

export async function signupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!env.ALLOW_PUBLIC_SIGNUP) {
    return { status: "error", message: SIGNUP_CLOSED };
  }

  const raw = readFields(formData, ["fullName", "email", "phone", "password"]);
  const values = { fullName: raw.fullName, email: raw.email, phone: raw.phone };
  const parsed = signupSchema.safeParse({
    ...raw,
    acceptTerms: formData.get("acceptTerms") === "on",
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrors(parsed.error), values };
  }
  const input = parsed.data;

  const problem = await passwordProblem(input.password, [input.fullName, input.email]);
  if (problem) {
    return { status: "error", fieldErrors: { password: problem }, values };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: confirmUrl(),
      // Read back (and validated again) when the e-mail is confirmed.
      data: {
        full_name: input.fullName,
        phone: input.phone,
        terms_accepted_at: new Date().toISOString(),
      },
    },
  });
  if (error) {
    return { status: "error", message: authErrorMessage(error.code), values };
  }

  // Supabase answers the same way when the e-mail already has an account,
  // so this page can't be used to discover registered e-mails.
  redirect(ROUTES.checkEmail);
}

export async function resendConfirmationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = readFields(formData, ["email"]);
  const parsed = emailOnlySchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrors(parsed.error), values: raw };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
    options: { emailRedirectTo: confirmUrl() },
  });
  if (error?.code === "over_email_send_rate_limit" || error?.code === "over_request_rate_limit") {
    return { status: "error", message: authErrorMessage(error.code), values: raw };
  }

  return {
    status: "success",
    message:
      "Se houver um cadastro aguardando confirmação para esse e-mail, enviamos um novo link. Confira também a caixa de spam.",
    values: raw,
  };
}
