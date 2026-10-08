"use client";

import { useActionState, useState } from "react";

import { PasswordStrengthMeter } from "@/components/auth/password-strength-meter";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { initialFormState } from "@/lib/auth/form-state";

import { resetPasswordAction } from "../actions";

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(resetPasswordAction, initialFormState);
  const [password, setPassword] = useState("");
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <Field
        label="Nova senha"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={errors.password}
        hint={<PasswordStrengthMeter password={password} />}
      />
      <Field
        label="Repita a nova senha"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        error={errors.confirmPassword}
      />
      <SubmitButton pendingText="Salvando…">Salvar nova senha</SubmitButton>
    </form>
  );
}
