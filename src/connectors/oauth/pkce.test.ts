import { describe, expect, it } from "vitest";

import { codeChallengeS256, createOAuthState, createPkcePair } from "@/connectors/oauth/pkce";

describe("PKCE", () => {
  it("matches the RFC 7636 appendix B example", () => {
    expect(codeChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("creates a valid, random pair", () => {
    const first = createPkcePair();
    const second = createPkcePair();
    expect(first.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(first.codeChallenge).toBe(codeChallengeS256(first.codeVerifier));
    expect(first.codeVerifier).not.toBe(second.codeVerifier);
  });

  it("creates unpredictable states", () => {
    expect(createOAuthState()).not.toBe(createOAuthState());
    expect(createOAuthState().length).toBeGreaterThanOrEqual(32);
  });
});
