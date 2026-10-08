import type { ZxcvbnFactory } from "@zxcvbn-ts/core";

/** zxcvbn score from 0 (very weak) to 4 (very strong). */
export type PasswordScore = 0 | 1 | 2 | 3 | 4;

export const PASSWORD_MIN_LENGTH = 10;
/** Supabase Auth (bcrypt) ignores anything after 72 characters. */
export const PASSWORD_MAX_LENGTH = 72;
/** Minimum zxcvbn score accepted (3 = "safely unguessable"). */
export const PASSWORD_MIN_SCORE: PasswordScore = 3;

export const PASSWORD_SCORE_LABELS: Record<PasswordScore, string> = {
  0: "Muito fraca",
  1: "Fraca",
  2: "Razoável",
  3: "Boa",
  4: "Forte",
};

export type PasswordStrength = {
  score: PasswordScore;
  acceptable: boolean;
  /** Feedback in Portuguese, when available. */
  warning: string | null;
  suggestions: string[];
};

let factoryPromise: Promise<ZxcvbnFactory> | null = null;

// The dictionaries are large, so they are loaded only when first needed
// (keeps them out of every page's JavaScript).
function loadFactory(): Promise<ZxcvbnFactory> {
  factoryPromise ??= (async () => {
    const [{ ZxcvbnFactory }, common, ptBr] = await Promise.all([
      import("@zxcvbn-ts/core"),
      import("@zxcvbn-ts/language-common"),
      import("@zxcvbn-ts/language-pt-br"),
    ]);
    return new ZxcvbnFactory({
      dictionary: { ...common.dictionary, ...ptBr.dictionary },
      graphs: common.adjacencyGraphs,
      translations: ptBr.translations,
    });
  })();
  return factoryPromise;
}

/**
 * Estimates password strength. `userInputs` (name, e-mail...) makes passwords
 * based on the user's own data count as weak.
 */
export async function evaluatePassword(
  password: string,
  userInputs: string[] = [],
): Promise<PasswordStrength> {
  const zxcvbn = await loadFactory();
  const result = zxcvbn.check(password.slice(0, PASSWORD_MAX_LENGTH), userInputs);
  const score = result.score as PasswordScore;
  return {
    score,
    acceptable: password.length >= PASSWORD_MIN_LENGTH && score >= PASSWORD_MIN_SCORE,
    warning: result.feedback.warning,
    suggestions: result.feedback.suggestions,
  };
}
