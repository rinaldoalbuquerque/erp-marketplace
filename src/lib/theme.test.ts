import { describe, expect, it } from "vitest";

import { parseThemePreference, resolveTheme, THEME_INIT_SCRIPT } from "@/lib/theme";

describe("theme", () => {
  it("accepts only known preferences, defaulting to system", () => {
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
    expect(parseThemePreference("blue")).toBe("system");
  });

  it("resolves system using the OS preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("init script applies the same rules before paint", () => {
    const run = (stored: string | null, prefersDark: boolean) => {
      const documentElement = { dataset: {} as Record<string, string> };
      const sandbox = {
        localStorage: { getItem: () => stored },
        window: { matchMedia: () => ({ matches: prefersDark }) },
        document: { documentElement },
      };
      new Function("localStorage", "window", "document", THEME_INIT_SCRIPT)(
        sandbox.localStorage,
        sandbox.window,
        sandbox.document,
      );
      return documentElement.dataset.theme;
    };
    expect(run("dark", false)).toBe("dark");
    expect(run("light", true)).toBe("light");
    expect(run(null, true)).toBe("dark");
    expect(run("system", false)).toBe("light");
  });
});
