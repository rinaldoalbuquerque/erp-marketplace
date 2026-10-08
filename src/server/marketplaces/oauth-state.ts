import { timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { MarketplaceId } from "@/connectors/types";
import { decryptSecret, encryptSecret } from "@/server/crypto/secret-box";

// While the seller is on the marketplace site authorizing the ERP, we keep the
// OAuth `state` and the PKCE `code_verifier` in a short-lived cookie,
// encrypted (the verifier must stay secret) and authenticated (can't be forged).
// The callback is accepted only if the `state` it receives matches this cookie
// and the same user/organization started the flow.

export const OAUTH_COOKIE_TTL_SECONDS = 10 * 60;

const payloadSchema = z.object({
  marketplace: z.literal("mercadolivre"),
  state: z.string().min(16),
  codeVerifier: z.string().min(43),
  organizationId: z.string(),
  userId: z.string(),
  expiresAt: z.number(),
});
export type OAuthStatePayload = z.infer<typeof payloadSchema>;

export function sealOAuthState(
  payload: Omit<OAuthStatePayload, "expiresAt">,
  key: Buffer,
  now: Date = new Date(),
): string {
  const full: OAuthStatePayload = {
    ...payload,
    expiresAt: now.getTime() + OAUTH_COOKIE_TTL_SECONDS * 1000,
  };
  return encryptSecret(JSON.stringify(full), key);
}

export type OAuthStateCheck =
  | { ok: true; payload: OAuthStatePayload }
  | { ok: false; reason: "missing" | "invalid" | "expired" | "state_mismatch" | "wrong_user" };

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Validates the cookie against the callback's `state` and the logged-in member. */
export function openOAuthState(
  sealed: string | undefined,
  input: {
    state: string | null;
    marketplace: MarketplaceId;
    organizationId: string;
    userId: string;
  },
  key: Buffer,
  now: Date = new Date(),
): OAuthStateCheck {
  if (!sealed) return { ok: false, reason: "missing" };
  let payload: OAuthStatePayload;
  try {
    const parsed = payloadSchema.safeParse(JSON.parse(decryptSecret(sealed, key)));
    if (!parsed.success) return { ok: false, reason: "invalid" };
    payload = parsed.data;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (payload.expiresAt < now.getTime()) return { ok: false, reason: "expired" };
  if (!input.state || !sameString(payload.state, input.state)) {
    return { ok: false, reason: "state_mismatch" };
  }
  if (
    payload.marketplace !== input.marketplace ||
    payload.organizationId !== input.organizationId ||
    payload.userId !== input.userId
  ) {
    return { ok: false, reason: "wrong_user" };
  }
  return { ok: true, payload };
}
