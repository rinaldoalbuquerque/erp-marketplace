import { describe, expect, it } from "vitest";

import { authErrorMessage, GENERIC_ERROR, INVALID_LOGIN } from "@/lib/auth/error-messages";

describe("authErrorMessage", () => {
  it("maps known Supabase codes to Portuguese", () => {
    expect(authErrorMessage("invalid_credentials")).toBe("E-mail ou senha incorretos.");
    expect(authErrorMessage("over_email_send_rate_limit")).toMatch(/Aguarde alguns minutos/);
  });

  it("uses a generic message for unknown or missing codes", () => {
    expect(authErrorMessage("something_new")).toBe(GENERIC_ERROR);
    expect(authErrorMessage(undefined)).toBe(GENERIC_ERROR);
  });

  it("does not reveal whether the e-mail exists", () => {
    // Unknown user and wrong password must look the same.
    expect(authErrorMessage("user_not_found")).not.toMatch(/não existe|não encontrado/i);
    expect(INVALID_LOGIN).not.toMatch(/não existe|não encontrado/i);
  });
});
