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
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-gray-800">
        {label}
      </label>
      <input
        id={inputId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`rounded-md border px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 ${
          error ? "border-red-500" : "border-gray-300"
        }`}
        {...inputProps}
      />
      {error ? (
        <p id={`${inputId}-error`} className="text-sm text-red-600">
          {error}
        </p>
      ) : hint ? (
        <div id={`${inputId}-hint`} className="text-sm text-gray-500">
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
      className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
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
      className={`rounded-md px-3 py-2 text-sm ${
        isError ? "bg-red-50 text-red-700" : "bg-green-50 text-green-800"
      }`}
    >
      {state.message}
    </p>
  );
}
