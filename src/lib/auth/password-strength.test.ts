import { describe, expect, it } from "vitest";

import { evaluatePassword } from "@/lib/auth/password-strength";

describe("evaluatePassword", () => {
  it.each(["senha123456", "12345678910", "qwertyuiop12", "brasil2026!"])(
    "rejects common password %s",
    async (password) => {
      expect((await evaluatePassword(password)).acceptable).toBe(false);
    },
  );

  it("rejects passwords shorter than 10 characters even if complex", async () => {
    expect((await evaluatePassword("x7#Kp2!q")).acceptable).toBe(false);
  });

  it("rejects a password built from the user's own data", async () => {
    const result = await evaluatePassword("rinaldoalbuquerque", ["Rinaldo Albuquerque"]);
    expect(result.acceptable).toBe(false);
  });

  it("accepts a long passphrase without symbols", async () => {
    const result = await evaluatePassword("cavalo correto bateria grampo");
    expect(result.acceptable).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(3);
  });

  it("returns feedback in Portuguese", async () => {
    const result = await evaluatePassword("senha123456");
    const text = [result.warning, ...result.suggestions].join(" ");
    expect(text).toMatch(/[a-zà-ú]/i);
    expect(text).not.toMatch(/\b(the|password is|add another word)\b/i);
  });
});
