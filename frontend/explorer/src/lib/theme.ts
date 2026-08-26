/*
 * explorer/lib · light / dark theme
 *
 * The explorer was dark-only. It now starts on whatever the OS asks for and
 * remembers an explicit choice, which is written to <html data-theme> — the one
 * hook the palette in index.css keys on.
 *
 * Resolving the system preference HERE rather than in a CSS media query is what
 * lets index.css carry a single light block instead of two identical ones (an
 * explicit override plus a "no preference expressed" twin).
 */

export type Theme = "light" | "dark";

const STORAGE_KEY = "kg-explorer-theme";

/** The OS preference, defaulting to dark — the explorer's original look. */
export function systemTheme(): Theme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/**
 * The theme to open with: a remembered choice if there is one, else the OS.
 *
 * Storage can throw outright, not just come back empty — Safari's "block all
 * cookies" makes localStorage itself raise — so every access is guarded.
 */
export function initialTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // No storage (private window, blocked site data) — fall through to the OS.
  }
  return systemTheme();
}

/** Point the palette at `theme`, and remember it as this reader's choice. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not persisting is survivable; the theme still applies for this visit.
  }
}
