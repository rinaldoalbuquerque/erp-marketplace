"use server";

import { redirect } from "next/navigation";

import { authErrorMessage, GENERIC_ERROR, SIGNUP_CLOSED } from "@/lib/auth/error-messages";
import { readFields, type FormState } from "@/lib/auth/form-state";
import { evaluatePassword } from "@/lib/auth/password-strength";
import { ROUTES, safeNextPath } from "@/lib/auth/routes";
import {
  emailOnlySchema,
  fieldErrors,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
} from "@/lib/auth/schemas";
import { provisionUserInDatabase } from "@/server/auth/provisioning-store";
import { isPwnedPassword } from "@/server/auth/pwned-password";
import { getAuthUser } from "@/server/auth/session";
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

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = readFields(formData, ["email", "password", "next"]);
  const values = { email: raw.email };
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrors(parsed.error), values };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    // Only reachable with the right password, so it doesn't reveal accounts.
    if (error?.code === "email_not_confirmed") {
      return { status: "error", message: authErrorMessage(error.code), values, showResend: true };
    }
    return { status: "error", message: authErrorMessage(error?.code), values };
  }

  // Retry provisioning in case it failed when the e-mail was confirmed. Idempotent.
  let result;
  try {
    result = await provisionUserInDatabase({
      userId: data.user.id,
      metadata: data.user.user_metadata,
      allowPublicSignup: env.ALLOW_PUBLIC_SIGNUP,
    });
  } catch (provisioningError) {
    console.error("Provisioning failed on login", {
      userId: data.user.id,
      error: provisioningError instanceof Error ? provisioningError.message : "unknown",
    });
    await supabase.auth.signOut({ scope: "local" });
    return { status: "error", message: GENERIC_ERROR, values };
  }
  if (result === "signup_closed" || result === "invalid_metadata") {
    redirect(ROUTES.noAccess);
  }

  redirect(safeNextPath(raw.next));
}

export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  // "local": ends this browser's session only.
  await supabase.auth.signOut({ scope: "local" });
  redirect(ROUTES.login);
}

export async function forgotPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = readFields(formData, ["email"]);
  const parsed = emailOnlySchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrors(parsed.error), values: raw };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: confirmUrl(),
  });
  if (error?.code === "over_email_send_rate_limit" || error?.code === "over_request_rate_limit") {
    return { status: "error", message: authErrorMessage(error.code), values: raw };
  }

  // Same answer whether or not the e-mail has an account.
  return {
    status: "success",
    message:
      "Se esse e-mail tiver uma conta, enviamos um link para criar uma nova senha. Confira também a caixa de spam.",
    values: raw,
  };
}

export async function resetPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // Needs the session created by the recovery link (see /auth/confirm).
  const user = await getAuthUser();
  if (!user) {
    return {
      status: "error",
      message: "Sua sessão expirou. Peça um novo link em “Esqueci minha senha”.",
    };
  }

  const raw = readFields(formData, ["password", "confirmPassword"]);
  const parsed = resetPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrors(parsed.error) };
  }

  const problem = await passwordProblem(parsed.data.password, [user.email]);
  if (problem) {
    return { status: "error", fieldErrors: { password: problem } };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { status: "error", message: authErrorMessage(error.code) };
  }

  redirect(`${ROUTES.home}?senha-alterada=1`);
}
