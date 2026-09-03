/*
 * The test that actually asks whether the abstraction holds.
 *
 * The teacher sheet came out right, but one document type can be matched by
 * accident — a renderer written while staring at a single target will fit it
 * whether or not it generalises. So: the SAME renderer, the SAME model, no new
 * code, pointed at a document that looks nothing like it.
 *
 * The pupil tool (`V2-Lecon-1-ensembles-FR.docx`) is that document. 28 pictures
 * against 9. Grids of images in table cells rather than banners of text. Three
 * type sizes. A page break standing on its own instead of riding a banner. If
 * `properties.render` plus this model can carry it, the WP3 claim is real; if
 * it needs a new key or a new branch, the gap is a finding and this file is
 * where it gets recorded.
 *
 * Asked once and answered NO: the spec generalised, the content model did not.
 * Every picture here lives in a table cell, and a cell in the first model held
 * a string — so all 42 were dropped, along with the page break, the title's
 * type size, the bullet rule and any cell holding more than one paragraph.
 *
 * Every one of those was a missing way to DESCRIBE a document rather than a
 * missing render knob, which is the WP3 line holding rather than breaking. So
 * the model was rebuilt around one idea — A BANNER AND AN IMAGE GRID ARE THE
 * SAME THING, a table whose cells hold blocks — and this file now asserts that
 * the SAME renderer carries both document types with no new keys.
 *
 * Set PUPIL_DIR to the folder holding the pupil files.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { renderSpecSchema } from "../kg-recipes/index.js";
import { renderDocx } from "../render/index.js";
import { readGolden, type GoldenMaps } from "./golden.js";
import { unzip } from "../render/index.js";

const PUPIL_DIR = process.env.PUPIL_DIR ?? "";
const PUPIL = PUPIL_DIR ? join(PUPIL_DIR, "V2-Lecon-1-ensembles-FR.docx") : "";
const havePupil = PUPIL !== "" && existsSync(PUPIL);

// The pupil tool, measured off the file. Same keys as the teacher sheet's spec,
// different values — which is the whole WP3 claim, stated as data.
const SPEC = renderSpecSchema.parse({
  page: { size: "A4", orientation: "portrait", marginsCm: { top: 1.3, right: 1.5, bottom: 1.3, left: 1.5 } },
  type: { family: "Andika", sizePt: 12, leadingPt: 12, leadingRule: "auto" },
  blocks: {
    instructionBox: { fill: "FDF1E4" },
    title: { sizePt: 16, bold: true },
    grid: { border: "thin" },
  },
  images: {
    // Seven roles where the teacher sheet has three, because this document
    // sizes its pictures individually rather than by kind. Same key, longer
    // list — no new shape, which is the point.
    maxHeightCm: {
      scene: 5.43, banner: 4.62, answer: 4.99, answerSmall: 3.61,
      marker: 1.15, sign: 0.52, signSmall: 0.46,
    },
    maxWidthCm: 9.8,
    placement: "inline",
    fullWidthAboveAspectRatio: 1.7,
  },
  pagination: { oneSectionPerPage: true, pageBreakCarrier: "paragraph" },
  language: {
    strategy: "per-file",
    variants: [
      { id: "commun", lang: "fr", colour: "000000", inAllFiles: true },
      { id: "fr", lang: "fr", colour: "000000", fileSuffix: "-FR" },
      { id: "wo", lang: "wo", colour: "000000", fileSuffix: "-WO" },
    ],
  },
  overflow: { policy: "allow", neverAdjust: ["margins", "typeSize", "images"] },
});

const MAPS: GoldenMaps = {
  blockOfFill: { FDF1E4: "instructionBox" },
  bulletMarker: undefined,   // a pupil page has no bullets
  styleOfSize: { "32": "title" },
  roleOfHeightCm: {
    "5.43": "scene", "4.62": "banner", "4.99": "answer", "3.61": "answerSmall",
    "1.15": "marker", "0.52": "sign", "0.46": "signSmall",
  },
  variantOfColour: { "000000": "commun" },
  roleOfMedia: {},
};

function facts(bytes: Buffer) {
  const doc = unzip(bytes).get("word/document.xml")!.toString("utf8");
  return {
    pgSz: /<w:pgSz w:w="(\d+)" w:h="(\d+)"/.exec(doc)?.slice(1).join("x"),
    pgMar: /<w:pgMar w:top="(\d+)" w:right="(\d+)" w:bottom="(\d+)" w:left="(\d+)"/.exec(doc)?.slice(1).join("/"),
    fills: [...new Set([...doc.matchAll(/w:fill="([0-9A-Fa-f]{6})"/g)].map((m) => m[1].toUpperCase()))].sort(),
    images: (doc.match(/<wp:extent /g) ?? []).length,
    pageBreaks: (doc.match(/w:type="page"/g) ?? []).length + (doc.match(/<w:pageBreakBefore\/>/g) ?? []).length,
    tables: (doc.match(/<w:tbl>/g) ?? []).length,
    cells: (doc.match(/<w:tc>/g) ?? []).length,
    imageSizes: [...doc.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)]
      .map((m) => `${(Number(m[1]) / 360000).toFixed(2)}x${(Number(m[2]) / 360000).toFixed(2)}`),
    sizes: [...new Set([...doc.matchAll(/<w:sz w:val="(\d+)"\/>/g)].map((m) => m[1]))].sort(),
    texts: [...doc.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
      .map((p) => [...p[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(""))
      .map((t) => t.replace(/\s+/g, " ").trim())
      .filter(Boolean),
  };
}

describe.skipIf(!havePupil)("does the same renderer carry a second document type?", () => {
  const goldenBytes = havePupil ? readFileSync(PUPIL) : Buffer.alloc(0);
  const gold = havePupil ? facts(goldenBytes) : ({} as ReturnType<typeof facts>);
  const model = havePupil ? readGolden(goldenBytes, MAPS) : null;
  const mine = havePupil ? facts(renderDocx(model!, SPEC)) : ({} as ReturnType<typeof facts>);

  // ── The declared geometry, from a spec with the same keys ─────────────────

  it("carries the page geometry, which is not the teacher sheet's", () => {
    expect(mine.pgSz).toBe(gold.pgSz);
    expect(mine.pgMar).toBe(gold.pgMar);
    // Same keys, different values — 1.3/1.5 here against 2.5 all round there.
    expect(gold.pgMar).toBe("737/850/737/850");
  });

  it("carries the block fill, from a palette of one instead of ten", () => {
    expect(mine.fills).toEqual(gold.fills);
    expect(gold.fills).toEqual(["FDF1E4"]);
  });

  // ── The content model, which is what had to be rebuilt ────────────────────

  it("reproduces every picture, all of which live inside table cells", () => {
    // This is the assertion the rebuild exists for. A pupil page IS a grid of
    // pictures — 42 placements over 28 files, in tables nested inside tables —
    // and under the old model, where a cell held a string, every one was lost.
    expect(gold.images).toBe(42);
    expect(mine.images).toBe(gold.images);
  });

  it("reproduces the table structure, nesting and all", () => {
    expect(mine.tables).toBe(gold.tables);
    expect(mine.cells).toBe(gold.cells);
    expect(gold.cells).toBe(70);
  });

  it("carries a page break the formatter says rides a paragraph", () => {
    // The teacher sheet hangs its break off a banner's paragraph property,
    // because a paragraph carrying a break leaves a blank page when the page
    // before it is full. This document does the opposite, and both are declared
    // rather than assumed: the model says WHERE a page starts, the spec says HOW.
    expect(mine.pageBreaks).toBe(gold.pageBreaks);
    expect(gold.pageBreaks).toBe(1);
  });

  it("applies a block's own type size", () => {
    // blocks.title.sizePt is 16 in the spec above, and the old renderer read
    // fill, textColour and bold off a block style while ignoring sizePt. Only a
    // document with more than one type size ever exposed it.
    expect(gold.sizes).toContain("32");
    expect(mine.sizes).toContain("32");
  });

  it("reproduces every printed line, word for word", () => {
    // Including the instruction box's three numbered questions, which a
    // one-string cell used to concatenate — and without bulleting the page
    // title, which a document-wide marker used to do.
    expect(mine.texts).toEqual(gold.texts);
  });

  it("puts every picture back at the size the golden gives it", () => {
    // The sizes come from images.maxHeightCm, so getting them right means the
    // roles were right — and a role has to be AUTHORED. Five of this document's
    // seven picture sizes are square, so shape cannot tell them apart the way
    // it can on the teacher sheet. Nothing here is a new render key; it is a
    // longer list under an existing one.
    expect(mine.images).toBe(gold.images);
    // Within a tenth of a millimetre, not exactly. The heights come straight
    // from the spec and match to the digit; two of the 42 widths land 0.01 cm
    // out, because the spec declares its ceilings to two decimals and every
    // width is derived from one. That is a rounding difference, not a layout
    // one, and asserting a tolerance says so where rounding to a decimal place
    // would just move the boundary.
    const cm = (row: string) => row.split("x").map(Number);
    expect(mine.imageSizes.length).toBe(gold.imageSizes.length);
    mine.imageSizes.forEach((row, i) => {
      const [mw, mh] = cm(row);
      const [gw, gh] = cm(gold.imageSizes[i]);
      // Compared in micrometres so binary float noise does not decide it.
      expect(Math.round(Math.abs(mw - gw) * 1000)).toBeLessThanOrEqual(10);
      expect(Math.round(Math.abs(mh - gh) * 1000)).toBeLessThanOrEqual(10);
    });
  });

  it("so: one renderer, two document types, no new render keys", () => {
    // Stated as an assertion so it cannot quietly stop being true. Between this
    // file and render.spike.test.ts the same code produces a bannered teacher
    // sheet and a picture-grid pupil page, told apart only by their formatters.
    expect(mine.pgMar).toBe(gold.pgMar);
    expect(mine.fills).toEqual(gold.fills);
    expect(mine.images).toBe(gold.images);
    expect(mine.cells).toBe(gold.cells);
    expect(mine.texts).toEqual(gold.texts);
  });
});
