import { describe, expect, it } from "vitest";

import { isActivePath, NAV_SECTIONS, navForRole } from "@/lib/navigation";

const labels = (role: Parameters<typeof navForRole>[0]) =>
  navForRole(role).flatMap((section) => section.items.map((item) => item.label));

describe("navForRole", () => {
  it("owner sees every item", () => {
    const all = NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.label));
    expect(labels("owner")).toEqual(all);
  });

  it("admin sees everything except company settings", () => {
    expect(labels("admin")).toContain("Contas de marketplace");
    expect(labels("admin")).not.toContain("Configurações");
  });

  it("operator doesn't see marketplace accounts or settings", () => {
    const operator = labels("operator");
    expect(operator).not.toContain("Contas de marketplace");
    expect(operator).not.toContain("Configurações");
    expect(operator).toEqual(
      expect.arrayContaining(["Painel", "Anúncios", "Pedidos", "Separação", "Estoque"]),
    );
  });

  it("drops sections that end up empty", () => {
    const titles = navForRole("operator").map((section) => section.title);
    expect(titles).not.toContain("Administração");
  });

  it("uses unique links", () => {
    const hrefs = NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("isActivePath", () => {
  it("matches the page and its sub-pages only", () => {
    expect(isActivePath("/anuncios", "/anuncios")).toBe(true);
    expect(isActivePath("/anuncios/123", "/anuncios")).toBe(true);
    expect(isActivePath("/anunciosx", "/anuncios")).toBe(false);
    expect(isActivePath("/painel", "/anuncios")).toBe(false);
  });
});
