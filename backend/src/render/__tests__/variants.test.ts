/*
 * One source, two documents.
 *
 * CI maths composes a page once and produces a French file and a Wolof one:
 * black lines in both, red French only in the French file, blue Wolof only in
 * the Wolof. The renderer honoured the COLOURS of that from the start and
 * ignored the split, which is a quiet failure — each file came out carrying the
 * other language as well, and it reads as a formatting oddity rather than as
 * the wrong document.
 */
import { describe, it, expect } from "vitest";
import { renderSpecSchema } from "../../kg-recipes/index.js";
import { splitByVariant, deriveVariant } from "../variants.js";
import type { DocumentTree } from "../document.js";

const PER_FILE = renderSpecSchema.parse({
  language: {
    strategy: "per-file",
    variants: [
      { id: "commun", lang: "fr", colour: "000000", inAllFiles: true },
      { id: "fr", lang: "fr", colour: "C0504D", prefix: "[FR]", fileSuffix: "-FR" },
      { id: "wo", lang: "wo", colour: "0070C0", prefix: "[WO]", fileSuffix: "-WO" },
    ],
  },
});

const TREE: DocumentTree = {
  media: [],
  blocks: [
    // A banner: structure, and it has no variant at all.
    { kind: "table", rows: [[{ style: "sessionBanner", blocks: [
      { kind: "line", runs: [{ text: "Séance 1" }] },
    ] }]] },
    { kind: "line", variant: "commun", runs: [{ text: "E. pose des cailloux." }] },
    { kind: "line", variant: "fr", runs: [{ text: "Nommez ces objets." }] },
    { kind: "line", variant: "wo", runs: [{ text: "Tudd-leen yëf yii." }] },
    { kind: "spacer", sizePt: 1, leadingPt: 2 },
  ],
};

const textsOf = (tree: DocumentTree): string[] => {
  const out: string[] = [];
  const walk = (blocks: DocumentTree["blocks"]): void => {
    for (const b of blocks) {
      if (b.kind === "table") { for (const row of b.rows) for (const cell of row) walk(cell.blocks); continue; }
      if (b.kind !== "line") continue;
      for (const r of b.runs) if ("text" in r) out.push(r.text);
    }
  };
  walk(tree.blocks);
  return out;
};

describe("splitting one tree into the files the formatter declares", () => {
  it("gives each language a file, and neither the other's lines", () => {
    const files = splitByVariant(TREE, PER_FILE);
    expect(files.map((f) => f.id)).toEqual(["fr", "wo"]);
    expect(textsOf(files[0].tree)).toEqual(["Séance 1", "E. pose des cailloux.", "Nommez ces objets."]);
    expect(textsOf(files[1].tree)).toEqual(["Séance 1", "E. pose des cailloux.", "Tudd-leen yëf yii."]);
  });

  it("names the files the way the formatter says", () => {
    expect(splitByVariant(TREE, PER_FILE).map((f) => f.fileSuffix)).toEqual(["-FR", "-WO"]);
  });

  it("keeps a banner in both files — a banner is structure, not speech", () => {
    // Dropping it would leave a file missing its scaffolding rather than its
    // translation, which is a much harder thing to notice on the page.
    for (const file of splitByVariant(TREE, PER_FILE)) {
      expect(file.tree.blocks[0].kind).toBe("table");
      expect(textsOf(file.tree)).toContain("Séance 1");
    }
  });

  it("keeps the furniture, so the two files paginate alike", () => {
    for (const file of splitByVariant(TREE, PER_FILE)) {
      expect(file.tree.blocks.some((b) => b.kind === "spacer")).toBe(true);
    }
  });

  it("is ONE file for anything that is not per-file", () => {
    for (const strategy of [{ strategy: "monolingual" }, { strategy: "inline", separator: " / " }, undefined]) {
      const spec = renderSpecSchema.parse(strategy ? { language: { ...strategy, variants: [
        { id: "wo", lang: "wo", prefix: "[WO]" }, { id: "fr", lang: "fr", prefix: "[FR]" },
      ] } } : {});
      const files = splitByVariant(TREE, spec);
      expect(files).toHaveLength(1);
      expect(textsOf(files[0].tree)).toHaveLength(4);
    }
  });
});

describe("deriving the language a tree does not carry", () => {
  // Injected rather than imported: this module must not know Gemini exists, and
  // a test must be able to derive a variant without spending a metered call.
  const shout = async (text: string) => `WO(${text})`;

  const FRENCH_ONLY: DocumentTree = {
    media: [],
    blocks: [
      { kind: "line", variant: "commun", runs: [{ text: "E. pose des cailloux." }] },
      { kind: "line", variant: "fr", style: "bullet", runs: [{ text: "Nommez ces objets." }] },
    ],
  };

  it("adds a translated twin for every line of the source language", async () => {
    const out = await deriveVariant(FRENCH_ONLY, "fr", "wo", "fr", "wo", shout);
    expect(textsOf(out)).toEqual([
      "E. pose des cailloux.", "Nommez ces objets.", "WO(Nommez ces objets.)",
    ]);
  });

  it("puts the twin IMMEDIATELY after its source, not in a block at the end", async () => {
    // Once the split drops the other language, position is the only thing that
    // still lands a line between the right banner and the right picture.
    const out = await deriveVariant(FRENCH_ONLY, "fr", "wo", "fr", "wo", shout);
    const wo = splitByVariant(out, PER_FILE).find((f) => f.id === "wo")!;
    expect(textsOf(wo.tree)).toEqual(["E. pose des cailloux.", "WO(Nommez ces objets.)"]);
  });

  it("keeps the source line's style and leaves shared lines alone", async () => {
    const out = await deriveVariant(FRENCH_ONLY, "fr", "wo", "fr", "wo", shout);
    const derived = out.blocks[2];
    expect(derived).toMatchObject({ kind: "line", variant: "wo", style: "bullet" });
  });

  it("carries pictures across untranslated", async () => {
    const withImage: DocumentTree = { media: [], blocks: [
      { kind: "line", variant: "fr", runs: [
        { image: { media: "a.png", role: "band", aspectRatio: 6 } }, { text: "Regardez." },
      ] },
    ] };
    const out = await deriveVariant(withImage, "fr", "wo", "fr", "wo", shout);
    const derived = out.blocks[1];
    if (derived.kind !== "line") throw new Error("expected a line");
    expect(derived.runs[0]).toMatchObject({ image: { media: "a.png" } });
    expect(derived.runs[1]).toMatchObject({ text: "WO(Regardez.)" });
  });

  it("leaves the page break on the SOURCE line only", async () => {
    // Both lines starting a page would leave a blank one in whichever file kept
    // them both.
    const breaking: DocumentTree = { media: [], blocks: [
      { kind: "line", variant: "fr", pageBreak: "before", runs: [{ text: "Séance 2" }] },
    ] };
    const out = await deriveVariant(breaking, "fr", "wo", "fr", "wo", shout);
    expect(out.blocks[0]).toMatchObject({ pageBreak: "before" });
    expect(out.blocks[1]).not.toHaveProperty("pageBreak");
  });

  it("REFUSES to touch a tree that already has that language", async () => {
    // Deriving over the top would double every line, and translating what an
    // author wrote by hand is the one thing this must never do.
    let called = 0;
    const out = await deriveVariant(TREE, "fr", "wo", "fr", "wo", async (t) => { called++; return t; });
    expect(called).toBe(0);
    expect(out).toBe(TREE);
  });

  it("reaches lines nested inside a table cell", async () => {
    const nested: DocumentTree = { media: [], blocks: [
      { kind: "table", rows: [[{ blocks: [
        { kind: "line", variant: "fr", runs: [{ text: "Dans la cellule." }] },
      ] }]] },
    ] };
    const out = await deriveVariant(nested, "fr", "wo", "fr", "wo", shout);
    expect(textsOf(out)).toEqual(["Dans la cellule.", "WO(Dans la cellule.)"]);
  });
});
