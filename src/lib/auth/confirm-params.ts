// Reads the query string of /auth/confirm. Two link formats exist:
//
// 1. Default Supabase e-mail templates (current setup): the link goes to Supabase,
//    which redirects back to our `emailRedirectTo`/`redirectTo` with `?code=...`
//    (PKCE flow). We add `flow=signup|recovery` to that URL ourselves.
//    Docs: https://supabase.com/docs/guides/auth/sessions/pkce-flow
// 2. Custom templates (need custom SMTP): `?token_hash=...&type=email|recovery`.
//    Docs: https://supabase.com/docs/guides/auth/server-side/nextjs
//
// On failure Supabase redirects with `?error=...&error_code=...`.

export type ConfirmFlow = "signup" | "recovery";

export type ConfirmRequest =
  | {
      kind: "token_hash";
      tokenHash: string;
      type: "email" | "signup" | "recovery";
      flow: ConfirmFlow;
    }
  | { kind: "code"; code: string; flow: ConfirmFlow }
  | { kind: "invalid" };

const TOKEN_TYPES = new Set(["email", "signup", "recovery"]);

export function parseConfirmParams(params: URLSearchParams): ConfirmRequest {
  if (params.get("error") || params.get("error_code")) return { kind: "invalid" };

  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  if (tokenHash && type && TOKEN_TYPES.has(type)) {
    const tokenType = type as "email" | "signup" | "recovery";
    return {
      kind: "token_hash",
      tokenHash,
      type: tokenType,
      flow: tokenType === "recovery" ? "recovery" : "signup",
    };
  }

  const code = params.get("code");
  if (code) {
    return { kind: "code", code, flow: params.get("flow") === "recovery" ? "recovery" : "signup" };
  }

  return { kind: "invalid" };
}
