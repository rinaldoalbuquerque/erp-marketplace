"use client";

import { useActionState } from "react";

import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { initialFormState } from "@/lib/auth/form-state";

import { resendConfirmationAction } from "../actions";

export function ResendConfirmationForm({ defaultEmail }: { defaultEmail?: string }) {
  const [state, formAction] = useActionState(resendConfirmationAction, initialFormState);
  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <Field
        label="E-mail"
        name="email"
        type="email"
        autoComplete="email"
        required
        defaultValue={state.values?.email ?? defaultEmail}
        error={state.fieldErrors?.email}
      />
      <SubmitButton pendingText="Enviando…">Reenviar e-mail de confirmação</SubmitButton>
    </form>
  );
}
