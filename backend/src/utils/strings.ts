/*
 * Module: utils · internal
 *
 * Pure, dependency-free string helpers. This module imports nothing from the
 * project (a core leaf), so any layer can use it without risk of a cycle.
 */

// Strip accents/diacritics and lowercase, for accent-insensitive matching
// (e.g. comparing "leçons" and "lecons").
export const noAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Folder-safe identifier: lowercase, ascii, dash-separated. Used to normalize a
// grade or subject into the name of its sources/ folder and bucket namespace.
export const slug = (s: string) => noAccents(s).trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// First run of digits in a string as an integer, or null. Used to read a scope
// number (e.g. the chapter/week) out of a document's subfolder name.
export const firstInt = (s: string): number | null => { const m = s.match(/\d+/); return m ? parseInt(m[0], 10) : null; };

// An email as an identity KEY: trimmed + lowercased. Local parts are formally
// case-sensitive, but no provider we sign in against treats them that way, and
// an invite written for "Awa@idinsight.org" must still match a token carrying
// "awa@idinsight.org" — so both sides fold to lowercase.
export const normalizeEmail = (s: string) => s.trim().toLowerCase();

// Shape check only — it says "this looks like an address someone typed", not
// "this mailbox exists". Deliberately loose: an invite that never matches a
// real login is harmless, whereas a clever regex that rejects a valid address
// blocks a real person.
export const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

// A node's display NAME out of its `description`. A routine carries its whole
// authored text there (its name on the first line, the prose below), so anything
// showing a name — the catalog listing, find_node, the explorer's node label —
// takes line 1. For the single-line descriptions every other node has, this
// returns the string unchanged.
export const displayName = (s: string): string => {
  const end = s.indexOf("\n");
  return (end === -1 ? s : s.slice(0, end)).trim();
};

// The other half of `displayName`: everything BELOW the name line. A routine's
// summary (on the entry) or a step's script (on the step) lives there now, so the
// catalog renderer reads a body from here instead of from a Material's `content`.
// Empty for the single-line descriptions every other node has.
export const descriptionBody = (s: string): string => {
  const end = s.indexOf("\n");
  return end === -1 ? "" : s.slice(end + 1).trim();
};
