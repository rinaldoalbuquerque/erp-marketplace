import { describe, expect, it } from "vitest";

import { parseServerEnv } from "@/server/env-schema";

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  DATABASE_URL: "postgresql://user:pass@localhost:6543/postgres",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
};

describe("parseServerEnv", () => {
  it("accepts a complete environment", () => {
    expect(parseServerEnv(valid)).toEqual({ ...valid, ALLOW_PUBLIC_SIGNUP: false });
  });

  it("lists missing variable names", () => {
    expect(() => parseServerEnv({ ...valid, SUPABASE_SECRET_KEY: undefined })).toThrow(
      /SUPABASE_SECRET_KEY/,
    );
  });

  it("never leaks secret values in the error message", () => {
    const secret = "sb_secret_do_not_leak";
    expect(() =>
      parseServerEnv({ ...valid, SUPABASE_SECRET_KEY: secret, DATABASE_URL: "not-a-url" }),
    ).toThrow(expect.objectContaining({ message: expect.not.stringContaining(secret) }));
  });

  it("ignores invisible whitespace pasted around values", () => {
    const env = parseServerEnv({
      ...valid,
      NEXT_PUBLIC_SITE_URL: "https://erp.exemplo.com\n",
      SUPABASE_SECRET_KEY: " sb_secret_test\r\n",
    });
    expect(env.NEXT_PUBLIC_SITE_URL).toBe("https://erp.exemplo.com");
    expect(env.SUPABASE_SECRET_KEY).toBe("sb_secret_test");
  });

  it("removes a trailing slash from the site URL", () => {
    const env = parseServerEnv({ ...valid, NEXT_PUBLIC_SITE_URL: "https://erp.exemplo.com/" });
    expect(env.NEXT_PUBLIC_SITE_URL).toBe("https://erp.exemplo.com");
  });

  it.each([
    ["true", true],
    [undefined, false],
    ["", false],
    ["false", false],
    ["TRUE", false],
    ["true ", false],
    ["1", false],
  ])("ALLOW_PUBLIC_SIGNUP=%j -> %s", (value, expected) => {
    expect(parseServerEnv({ ...valid, ALLOW_PUBLIC_SIGNUP: value }).ALLOW_PUBLIC_SIGNUP).toBe(
      expected,
    );
  });
});
