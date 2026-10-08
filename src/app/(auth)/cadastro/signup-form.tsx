"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { PasswordStrengthMeter } from "@/components/auth/password-strength-meter";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { initialFormState } from "@/lib/auth/form-state";
import { ROUTES } from "@/lib/auth/routes";

import { signupAction } from "../actions";

export function SignupForm() {
  const [state, formAction] = useActionState(signupAction, initialFormState);
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <Field
        label="Nome completo"
        name="fullName"
        autoComplete="name"
        required
        defaultValue={state.values?.fullName}
        onChange={(event) => setFullName(event.target.value)}
        error={errors.fullName}
      />
      <Field
        label="E-mail"
        name="email"
        type="email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
        onChange={(event) => setEmail(event.target.value)}
        error={errors.email}
      />
      <Field
        label="Celular (com DDD)"
        name="phone"
        type="tel"
        autoComplete="tel-national"
        placeholder="(11) 98765-4321"
        required
        defaultValue={state.values?.phone}
        error={errors.phone}
      />
      <Field
        label="Senha"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={errors.password}
        hint={<PasswordStrengthMeter password={password} userInputs={[fullName, email]} />}
      />
      {/* Show the meter under the error too, so the user sees what to fix. */}
      {errors.password ? (
        <div className="-mt-2 text-sm text-gray-500">
          <PasswordStrengthMeter password={password} userInputs={[fullName, email]} />
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            name="acceptTerms"
            className="mt-1"
            aria-invalid={errors.acceptTerms ? true : undefined}
          />
          <span>
            Li e aceito os{" "}
            <Link href={ROUTES.terms} target="_blank" className="text-blue-600 hover:underline">
              Termos de Uso
            </Link>{" "}
            e a{" "}
            <Link href={ROUTES.privacy} target="_blank" className="text-blue-600 hover:underline">
              Política de Privacidade
            </Link>
            .
          </span>
        </label>
        {errors.acceptTerms ? <p className="text-sm text-red-600">{errors.acceptTerms}</p> : null}
      </div>

      <SubmitButton pendingText="Criando conta…">Criar conta</SubmitButton>
    </form>
  );
}
