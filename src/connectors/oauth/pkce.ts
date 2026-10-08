import { createHash, randomBytes } from "node:crypto";

// PKCE (RFC 7636, https://www.rfc-editor.org/rfc/rfc7636) with the S256 method.
// Generic OAuth helper, used by any connector whose marketplace supports PKCE.

/** S256: BASE64URL(SHA256(verifier)). */
export function codeChallengeS256(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
}

/** Random verifier (43 chars, inside RFC's 43-128 range) and its S256 challenge. */
export function createPkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString("base64url");
  return { codeVerifier, codeChallenge: codeChallengeS256(codeVerifier) };
}

/** Unpredictable value tying the callback to the request that started it (CSRF protection). */
export function createOAuthState(): string {
  return randomBytes(24).toString("base64url");
}
