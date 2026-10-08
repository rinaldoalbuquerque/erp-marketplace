"use client";

import { useFormStatus } from "react-dom";

import type { FormState } from "@/lib/auth/form-state";

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
  error?: string;
  hint?: React.ReactNode;
};

export function Field({ label, name, error, hint, id, ...inputProps }: FieldProps) {
  const inputId = id ?? name;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={inputId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`h-10 rounded-lg border bg-surface px-3 text-ink transition-colors outline-none placeholder:text-muted/70 focus:border-brand focus:ring-3 focus:ring-brand/20 ${
          error ? "border-danger" : "border-border hover:border-muted/60"
        }`}
        {...inputProps}
      />
      {error ? (
        <p id={`${inputId}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <div id={`${inputId}-hint`} className="text-sm text-muted">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function SubmitButton({
  children,
  pendingText,
}: {
  children: React.ReactNode;
  pendingText: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-10 rounded-lg bg-brand px-4 font-semibold text-on-brand transition-colors hover:bg-brand-hover disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? pendingText : children}
    </button>
  );
}

/** Message at the top of a form (error in red, success in green). */
export function FormMessage({ state }: { state: FormState }) {
  if (!state.message) return null;
  const isError = state.status === "error";
  return (
    <p
      role={isError ? "alert" : "status"}
      className={`rounded-lg border-l-4 px-3 py-2 text-sm ${
        isError
          ? "border-danger bg-danger-soft text-danger"
          : "border-success bg-success-soft text-success"
      }`}
    >
      {state.message}
    </p>
  );
}
