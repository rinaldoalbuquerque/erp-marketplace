"use client";

import { useActionState } from "react";

import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { initialFormState } from "@/lib/auth/form-state";

import { forgotPasswordAction } from "../actions";

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(forgotPasswordAction, initialFormState);
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <Field
        label="E-mail"
        name="email"
        type="email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
        error={state.fieldErrors?.email}
      />
      <SubmitButton pendingText="Enviando…">Enviar link</SubmitButton>
    </form>
  );
}
