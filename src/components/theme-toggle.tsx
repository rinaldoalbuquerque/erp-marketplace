"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

import {
  parseThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string; Icon: LucideIcon }[] = [
  { value: "light", label: "Tema claro", Icon: Sun },
  { value: "dark", label: "Tema escuro", Icon: Moon },
  { value: "system", label: "Usar o tema do sistema", Icon: Monitor },
];

const DARK_QUERY = "(prefers-color-scheme: dark)";

function applyTheme(preference: ThemePreference) {
  const prefersDark = window.matchMedia(DARK_QUERY).matches;
  document.documentElement.dataset.theme = resolveTheme(preference, prefersDark);
}

function readStoredPreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

/** Light / dark / system switch. The choice is saved in this browser. */
export function ThemeToggle() {
  // null until mounted: the server can't know the stored choice.
  const [preference, setPreference] = useState<ThemePreference | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read browser-only storage after mount
    setPreference(readStoredPreference());
  }, []);

  // While on "system", follow OS changes live.
  useEffect(() => {
    if (preference !== "system") return;
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  function choose(value: ThemePreference) {
    setPreference(value);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, value);
    } catch {
      // Private mode or blocked storage: the theme still applies for this visit.
    }
    applyTheme(value);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className="flex items-center rounded-lg border border-border bg-surface-2 p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const selected = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => choose(value)}
            className={`rounded-md p-1.5 transition-colors ${
              selected ? "bg-surface text-brand shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            <Icon className="size-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
