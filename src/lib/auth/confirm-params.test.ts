import { describe, expect, it } from "vitest";

import { parseConfirmParams } from "@/lib/auth/confirm-params";

const parse = (query: string) => parseConfirmParams(new URLSearchParams(query));

describe("parseConfirmParams", () => {
  it("reads the PKCE code from the default Supabase templates", () => {
    expect(parse("flow=signup&code=abc")).toEqual({ kind: "code", code: "abc", flow: "signup" });
    expect(parse("flow=recovery&code=abc")).toEqual({
      kind: "code",
      code: "abc",
      flow: "recovery",
    });
  });

  it("treats a code without flow as sign-up (never as password reset)", () => {
    expect(parse("code=abc")).toMatchObject({ flow: "signup" });
    expect(parse("flow=other&code=abc")).toMatchObject({ flow: "signup" });
  });

  it("reads token_hash links from custom templates", () => {
    expect(parse("token_hash=t&type=email")).toEqual({
      kind: "token_hash",
      tokenHash: "t",
      type: "email",
      flow: "signup",
    });
    expect(parse("token_hash=t&type=recovery")).toMatchObject({ flow: "recovery" });
  });

  it.each([
    "",
    "flow=signup",
    "token_hash=t",
    "token_hash=t&type=magiclink",
    "error=access_denied&error_code=otp_expired&code=abc",
  ])("rejects %j", (query) => {
    expect(parse(query)).toEqual({ kind: "invalid" });
  });
});
