/*
 * The contract between the authoring model and the renderer.
 *
 * Two things are being defended here, and only one of them is "does it parse":
 *
 *   1. The tree can express what the two live document types actually are —
 *      nested picture grids as readily as a banner of text.
 *   2. It CANNOT express geometry. No colour, no point size, no centimetre.
 *      That is the WP3 split enforced by omission, and it is a test rather than
 *      a comment because it is exactly the kind of line that erodes the first
 *      time someone needs one quick override.
 */
import { describe, it, expect } from "vitest";
import { documentSchema, validateDocumentTree } from "../document.js";

// A pupil-tool answer row, cut down: a grid whose cells hold pictures, inside a
// document that starts a page part-way through.
const NESTED_GRID = {
  blocks: [
    { kind: "line", style: "title", runs: [{ text: "Unité 1" }, { text: "JE FORME…", style: "lessonName" }] },
    {
      kind: "table",
      style: "instructionBox",
      columnsCm: [0.85, 9.35],
      rows: [[
        { style: "marker", blocks: [{ kind: "line", runs: [{ image: { media: "m.png", role: "marker", aspectRatio: 1 } }] }] },
        {
          span: 2,
          blocks: [
            { kind: "line", runs: [{ text: "1. Regardez bien ce panier." }] },
            { kind: "table", rows: [[{ blocks: [
              { kind: "line", runs: [{ image: { media: "a.png", role: "answer", aspectRatio: 1 } }] },
            ] }]] },
          ],
        },
      ]],
    },
    { kind: "table", pageBreak: "before", rows: [[{ blocks: [{ kind: "line", runs: [{ text: "Séance 2" }] }] }]] },
    { kind: "spacer", sizePt: 1, leadingPt: 2 },
  ],
};

describe("what the block tree can say", () => {
  it("holds a grid of pictures nested inside another table", () => {
    expect(validateDocumentTree(NESTED_GRID)).toEqual([]);
  });

  it("holds a line made of several differently styled runs", () => {
    // A line is not one style: the pupil header sets "Unité 1 · Leçon 1" at
    // 12 pt and the lesson title at 16 pt in the same paragraph.
    const parsed = documentSchema.parse(NESTED_GRID);
    const first = parsed.blocks[0];
    expect(first.kind).toBe("line");
    if (first.kind === "line") {
      expect(first.runs).toHaveLength(2);
      expect(first.runs[1]).toMatchObject({ style: "lessonName" });
    }
  });

  it("says WHERE a page starts and not how the break is written", () => {
    // The carrier is the formatter's: the teacher sheet hangs it off a banner's
    // paragraph property, the pupil tool gives it a paragraph of its own.
    const parsed = documentSchema.parse(NESTED_GRID);
    expect(parsed.blocks[2]).toMatchObject({ pageBreak: "before" });
    expect(JSON.stringify(parsed)).not.toContain("pageBreakCarrier");
  });
});

describe("what it refuses", () => {
  it("refuses an unknown key rather than dropping it at render time", () => {
    const errors = validateDocumentTree({
      blocks: [{ kind: "line", runs: [{ text: "x" }], keepTogether: true }],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("keepTogether");
  });

  it("refuses geometry on a line — that is the formatter's half", () => {
    for (const geometry of [{ colour: "FF0000" }, { sizePt: 16 }, { bold: true }, { marginCm: 2 }]) {
      const errors = validateDocumentTree({
        blocks: [{ kind: "line", runs: [{ text: "x" }], ...geometry }],
      });
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it("refuses geometry on a picture, which carries a role instead", () => {
    const errors = validateDocumentTree({
      blocks: [{ kind: "line", runs: [{ image: { media: "a.png", role: "answer", aspectRatio: 1, heightCm: 5 } }] }],
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(" ")).toContain("heightCm");
  });

  it("names the path, so a model knows WHICH cell it got wrong", () => {
    const errors = validateDocumentTree({
      blocks: [{ kind: "table", rows: [[{ blocks: [{ kind: "line", runs: [{ text: 7 }] }] }]] }],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^document\.blocks\.0\.rows\.0\.0\.blocks\.0\.runs\.0/);
  });

  it("refuses a block kind it does not have", () => {
    expect(validateDocumentTree({ blocks: [{ kind: "footnote", text: "x" }] }).length).toBeGreaterThan(0);
  });

  it("refuses a table with no rows — an empty banner is a mistake, not a layout", () => {
    expect(validateDocumentTree({ blocks: [{ kind: "table", rows: [] }] }).length).toBeGreaterThan(0);
  });
});
