import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createOAuthState, createPkcePair } from "@/connectors/oauth/pkce";
import { openOAuthState, sealOAuthState } from "@/server/marketplaces/oauth-state";

const key = randomBytes(32);
const state = createOAuthState();
const { codeVerifier } = createPkcePair();
const base = {
  marketplace: "mercadolivre" as const,
  state,
  codeVerifier,
  organizationId: "org-1",
  userId: "user-1",
};
const callback = {
  state,
  marketplace: "mercadolivre" as const,
  organizationId: "org-1",
  userId: "user-1",
};
const now = new Date("2026-10-08T12:00:00Z");

describe("OAuth state cookie", () => {
  it("accepts the callback that matches the cookie", () => {
    const sealed = sealOAuthState(base, key, now);
    const result = openOAuthState(sealed, callback, key, now);
    expect(result).toEqual({ ok: true, payload: expect.objectContaining({ codeVerifier }) });
  });

  it("does not expose the verifier in the cookie", () => {
    expect(sealOAuthState(base, key, now)).not.toContain(codeVerifier);
  });

  it("rejects a missing cookie", () => {
    expect(openOAuthState(undefined, callback, key, now)).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects a different state (forged callback / CSRF)", () => {
    const sealed = sealOAuthState(base, key, now);
    expect(openOAuthState(sealed, { ...callback, state: createOAuthState() }, key, now)).toEqual({
      ok: false,
      reason: "state_mismatch",
    });
    expect(openOAuthState(sealed, { ...callback, state: null }, key, now)).toMatchObject({
      ok: false,
    });
  });

  it("rejects after 10 minutes", () => {
    const sealed = sealOAuthState(base, key, now);
    const later = new Date(now.getTime() + 11 * 60 * 1000);
    expect(openOAuthState(sealed, callback, key, later)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects another user or organization", () => {
    const sealed = sealOAuthState(base, key, now);
    expect(openOAuthState(sealed, { ...callback, userId: "user-2" }, key, now)).toEqual({
      ok: false,
      reason: "wrong_user",
    });
    expect(openOAuthState(sealed, { ...callback, organizationId: "org-2" }, key, now)).toEqual({
      ok: false,
      reason: "wrong_user",
    });
  });

  it("rejects a tampered cookie or another key", () => {
    const sealed = sealOAuthState(base, key, now);
    // Flip one character in the middle of the payload (a trailing extra
    // character would just be ignored by base64url decoding).
    const middle = Math.floor(sealed.length / 2);
    const flipped = sealed[middle] === "A" ? "B" : "A";
    const tampered = sealed.slice(0, middle) + flipped + sealed.slice(middle + 1);
    expect(openOAuthState(tampered, callback, key, now)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(openOAuthState(sealed, callback, randomBytes(32), now)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
