/*
 * displayName — a node's name out of a description that may carry its whole text
 *
 * Routines carry their authored prose in `description` (their name on line 1, the
 * text below), because `content` is a `Material` property and a routine has no
 * Material any more. Every surface that shows a NAME — the catalog listing,
 * find_node, the explorer's node label — has to stop at line 1, or the library
 * lists entries titled with 900 characters of prose.
 */
import { describe, it, expect } from "vitest";
import { displayName } from "../strings.js";

describe("displayName", () => {
  it("returns a single-line description unchanged", () => {
    // What every non-routine node has, so the helper must be a no-op there.
    expect(displayName("Bilan du chapitre 6")).toBe("Bilan du chapitre 6");
  });

  it("keeps only the first line when the description carries the routine's text", () => {
    const routine = "Fiche de leçon — enseignement explicite (30 min)\n\nStructure fixe d'une fiche…";
    expect(displayName(routine)).toBe("Fiche de leçon — enseignement explicite (30 min)");
  });

  it("trims the name and handles an empty description", () => {
    expect(displayName("  JE FAIS — Modelage  \n\nBut : le maître montre…")).toBe("JE FAIS — Modelage");
    expect(displayName("")).toBe("");
  });
});
