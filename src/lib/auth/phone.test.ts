import { describe, expect, it } from "vitest";

import { normalizeBrazilianMobile } from "@/lib/auth/phone";

describe("normalizeBrazilianMobile", () => {
  it.each([
    ["(11) 98765-4321", "+5511987654321"],
    ["11987654321", "+5511987654321"],
    ["+55 21 99876-5432", "+5521998765432"],
    ["5521998765432", "+5521998765432"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeBrazilianMobile(input)).toBe(expected);
  });

  it.each([
    ["landline", "(11) 3456-7890"],
    ["missing DDD", "98765-4321"],
    ["invalid DDD", "(01) 98765-4321"],
    ["too long", "119876543210"],
    ["empty", ""],
  ])("rejects %s", (_label, input) => {
    expect(normalizeBrazilianMobile(input)).toBeNull();
  });
});
