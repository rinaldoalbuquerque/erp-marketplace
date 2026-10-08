"use client";

import { useActionState } from "react";

import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { initialFormState } from "@/lib/auth/form-state";

import { loginAction } from "../actions";
import { ResendConfirmationForm } from "../verifique-seu-email/resend-form";

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, formAction] = useActionState(loginAction, initialFormState);
  const errors = state.fieldErrors ?? {};
  // A notice from the URL (e.g. expired link) is shown until the first attempt.
  const shownState =
    state.status === "idle" && notice ? { status: "error" as const, message: notice } : state;

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <FormMessage state={shownState} />
        {/* The server only accepts internal paths here (safeNextPath). */}
        <input type="hidden" name="next" value={next ?? ""} />
        <Field
          label="E-mail"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.values?.email}
          error={errors.email}
        />
        <Field
          label="Senha"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          error={errors.password}
        />
        <SubmitButton pendingText="Entrando…">Entrar</SubmitButton>
      </form>
      {state.showResend ? (
        <div className="border-t border-border pt-4">
          <ResendConfirmationForm defaultEmail={state.values?.email} />
        </div>
      ) : null}
    </div>
  );
}
