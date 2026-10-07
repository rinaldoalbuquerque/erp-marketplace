import { describe, expect, it } from "vitest";

import { parseServerEnv } from "@/server/env-schema";

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  DATABASE_URL: "postgresql://user:pass@localhost:6543/postgres",
};

describe("parseServerEnv", () => {
  it("accepts a complete environment", () => {
    expect(parseServerEnv(valid)).toEqual(valid);
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
});
