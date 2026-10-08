/** State returned by the auth Server Actions to their forms (useActionState). */
export type FormState = {
  status: "idle" | "error" | "success";
  /** Message shown at the top of the form. */
  message?: string;
  /** Per-field errors: { email: "Informe um e-mail válido." } */
  fieldErrors?: Record<string, string>;
  /** Values to refill the form after an error (never passwords). */
  values?: Record<string, string>;
  /** Show the "resend confirmation e-mail" option (login of an unconfirmed user). */
  showResend?: boolean;
};

export const initialFormState: FormState = { status: "idle" };

/** Reads text fields from a FormData (missing fields become ""). */
export function readFields<K extends string>(formData: FormData, keys: readonly K[]) {
  return Object.fromEntries(
    keys.map((key) => {
      const value = formData.get(key);
      return [key, typeof value === "string" ? value : ""];
    }),
  ) as Record<K, string>;
}
