import { describe, expect, it } from "vitest";

import { fieldErrors, resetPasswordSchema, signupSchema } from "@/lib/auth/schemas";

const valid = {
  fullName: "  Maria Silva ",
  email: " Maria@Exemplo.COM ",
  phone: "(11) 98765-4321",
  password: "cavalo correto bateria grampo",
  acceptTerms: true,
};

describe("signupSchema", () => {
  it("accepts valid input and normalizes it", () => {
    const result = signupSchema.parse(valid);
    expect(result).toMatchObject({
      fullName: "Maria Silva",
      email: "maria@exemplo.com",
      phone: "+5511987654321",
    });
  });

  it.each([
    ["fullName", { fullName: " " }],
    ["email", { email: "maria@" }],
    ["phone", { phone: "3456-7890" }],
    ["password", { password: "curta123" }],
    ["acceptTerms", { acceptTerms: false }],
  ])("reports an error on %s", (field, override) => {
    const result = signupSchema.safeParse({ ...valid, ...override });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result.error)[field]).toBeTruthy();
    }
  });

  it("uses Portuguese messages", () => {
    const result = signupSchema.safeParse({ ...valid, password: "curta" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result.error).password).toBe(
        "A senha precisa ter pelo menos 10 caracteres.",
      );
    }
  });
});

describe("resetPasswordSchema", () => {
  it("requires matching passwords", () => {
    const result = resetPasswordSchema.safeParse({
      password: "cavalo correto bateria grampo",
      confirmPassword: "outra coisa qualquer",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result.error).confirmPassword).toBe("As senhas não conferem.");
    }
  });
});
