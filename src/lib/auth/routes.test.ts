import { describe, expect, it } from "vitest";

import { resolveAccessRedirect, safeNextPath } from "@/lib/auth/routes";

describe("resolveAccessRedirect", () => {
  it("sends logged-out users to login, remembering the page", () => {
    expect(resolveAccessRedirect("/painel", false)).toBe("/entrar?next=%2Fpainel");
    expect(resolveAccessRedirect("/anuncios/123", false)).toBe("/entrar?next=%2Fanuncios%2F123");
    expect(resolveAccessRedirect("/", false)).toBe("/entrar");
  });

  it("lets logged-out users open public pages", () => {
    for (const path of ["/entrar", "/cadastro", "/esqueci-a-senha", "/termos", "/auth/confirm"]) {
      expect(resolveAccessRedirect(path, false)).toBeNull();
    }
  });

  it("does not treat look-alike paths as public", () => {
    expect(resolveAccessRedirect("/entrarx", false)).toBe("/entrar?next=%2Fentrarx");
  });

  it("requires login for password reset (needs the recovery session)", () => {
    expect(resolveAccessRedirect("/redefinir-senha", false)).not.toBeNull();
  });

  it("sends logged-in users away from login and signup", () => {
    expect(resolveAccessRedirect("/entrar", true)).toBe("/painel");
    expect(resolveAccessRedirect("/cadastro", true)).toBe("/painel");
    expect(resolveAccessRedirect("/painel", true)).toBeNull();
  });
});

describe("safeNextPath", () => {
  it.each(["/painel", "/anuncios?status=ativo", "/redefinir-senha"])("accepts %s", (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    null,
    "",
    "painel",
    "//evil.com",
    "/\\evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "/%2F%2Fevil.com",
    "/%5Cevil.com",
  ])("rejects %j", (path) => {
    expect(safeNextPath(path)).toBe("/painel");
  });
});
