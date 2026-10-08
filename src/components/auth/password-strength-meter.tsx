"use client";

import { useEffect, useState } from "react";

import {
  evaluatePassword,
  PASSWORD_MIN_LENGTH,
  PASSWORD_SCORE_LABELS,
  type PasswordStrength,
} from "@/lib/auth/password-strength";

// Weak = danger, middling = amber signal, acceptable = success.
const BAR_COLORS = ["bg-danger", "bg-danger", "bg-signal", "bg-success", "bg-success"];

/**
 * Live password strength indicator. Only a guide: the server checks again.
 * `userInputs` (name, e-mail) make passwords based on them count as weak.
 */
export function PasswordStrengthMeter({
  password,
  userInputs = [],
}: {
  password: string;
  userInputs?: string[];
}) {
  const [strength, setStrength] = useState<PasswordStrength | null>(null);
  const inputsKey = userInputs.join("\n");

  useEffect(() => {
    if (!password) return;
    let cancelled = false;
    // Small delay so it doesn't recalculate on every keystroke.
    const timer = setTimeout(() => {
      void evaluatePassword(password, inputsKey ? inputsKey.split("\n") : []).then((result) => {
        if (!cancelled) setStrength(result);
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [password, inputsKey]);

  if (!password) {
    return <p>Use pelo menos {PASSWORD_MIN_LENGTH} caracteres. Uma frase longa é uma boa senha.</p>;
  }
  if (!strength) return <p>Avaliando a senha…</p>;

  const tooShort = password.length < PASSWORD_MIN_LENGTH;
  const tip = tooShort
    ? `Faltam ${PASSWORD_MIN_LENGTH - password.length} caracteres.`
    : (strength.warning ?? strength.suggestions[0] ?? null);

  return (
    <div className="flex flex-col gap-1" aria-live="polite">
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((index) => (
          <span
            key={index}
            className={`h-1.5 flex-1 rounded ${
              index <= strength.score ? BAR_COLORS[strength.score] : "bg-surface-2"
            }`}
          />
        ))}
      </div>
      <p>
        Força: <strong className="text-ink">{PASSWORD_SCORE_LABELS[strength.score]}</strong>
        {strength.acceptable ? " ✓" : ""}
        {tip ? `. ${tip}` : ""}
      </p>
    </div>
  );
}
