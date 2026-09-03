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
 * The answer is NO, and the shape of the no is the useful part. The SPEC
 * generalises — same keys, different values, and the geometry comes out right.
 * What does not generalise is the spike's DOCUMENT MODEL: banners of text
 * cells, lines, spacers. A pupil page is a grid of pictures, and this model has
 * no way to say that. So WP4 needs a richer content model, not more render
 * keys — which is the WP3 line (geometry declared, structure authored) holding
 * up rather than breaking.
 *
 * The assertions below RECORD that, failures included. Set PUPIL_DIR to the
 * folder holding the pupil files.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { renderSpecSchema } from "../kg-recipes/index.js";
import { renderDocx } from "./renderer.js";
import { readGolden, type GoldenMaps } from "./golden.js";
import { unzip } from "./zip.js";

const PUPIL_DIR = process.env.PUPIL_DIR ?? "";
const PUPIL = PUPIL_DIR ? join(PUPIL_DIR, "V2-Lecon-1-ensembles-FR.docx") : "";
const havePupil = PUPIL !== "" && existsSync(PUPIL);

// The pupil tool, measured off the file. Same keys as the teacher sheet's spec,
// different values — which is the whole WP3 claim, stated as data.
const SPEC = renderSpecSchema.parse({
  page: { size: "A4", orientation: "portrait", marginsCm: { top: 1.3, right: 1.5, bottom: 1.3, left: 1.5 } },
  type: { family: "Andika", sizePt: 12, leadingPt: 12, leadingRule: "auto" },
  blocks: {
    instructionBox: { fill: "FDF1E4", bold: false },
    title: { sizePt: 16, bold: true },
    grid: { border: "thin" },
  },
  images: {
    maxHeightCm: { scene: 5.43, cell: 4.99, marker: 1.15, sign: 0.46 },
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

  // ── What carries over: the declared geometry ──────────────────────────────

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

  // ── What does not: the content model ──────────────────────────────────────

  it("FINDING 1 — every picture is lost, because they all live in table cells", () => {
    // Not most. All of them. A pupil page IS a grid of pictures — 42 placements
    // over 28 files — and a banner cell in this model holds a string. The
    // teacher sheet hid this: its pictures sit in paragraphs, which the model
    // does have. This is the single biggest gap between the two document types.
    expect(gold.images).toBe(42);
    expect(mine.images).toBe(0);
  });

  it("FINDING 2 — a page break not carried by a banner is lost", () => {
    // The spec offers three carriers and this document uses "paragraph": a
    // paragraph holding nothing but <w:br type="page"/>. The model reads a
    // textless, pictureless paragraph as a spacer, and the renderer acts only
    // on "banner-property". The VALUE is declared and read; nothing honours it.
    expect(gold.pageBreaks).toBe(1);
    expect(mine.pageBreaks).toBe(0);
  });

  it("FINDING 3 — a block's declared type size is never applied", () => {
    // blocks.title.sizePt is 16 above and appears nowhere in the output. The
    // renderer takes fill, textColour and bold off a block style and ignores
    // sizePt. The key exists in the schema; nothing consumes it. The pupil
    // title is 16 pt and the teacher sheet has one size throughout, so again
    // only the second document type exposes it.
    expect(mine.sizes).not.toContain("32");
    expect(gold.sizes).toContain("32");
  });

  it("FINDING 4 — the bullet marker is document-wide, not per block", () => {
    // spec.blocks.bullet.marker exists, but the model carries ONE marker and
    // the renderer puts it on every line. Here that bullets the page title.
    expect(mine.texts[0]).toBe("• " + gold.texts[0]);
  });

  it("FINDING 5 — a cell holding several paragraphs collapses into one line", () => {
    // The instruction box holds three numbered questions as three paragraphs.
    // A cell is one string in this model, so they come out concatenated, with
    // no space and no line break between them.
    expect(gold.texts.slice(1, 4)).toEqual([
      "1. Regardez bien ce panier. Quels fruits voyez-vous ?",
      "2. Combien de fruits différents avons-nous ?",
      "3. Quel est le fruit qui est le plus nombreux ?",
    ]);
    expect(mine.texts[1]).toBe(gold.texts.slice(1, 4).join(""));
  });

  it("so: the spec generalised and the content model did not", () => {
    // Stated as an assertion so it cannot quietly stop being true. Every
    // failure above is a missing way to DESCRIBE the document; none of them is
    // a missing render knob.
    expect(mine.pgMar).toBe(gold.pgMar);       // geometry: carried
    expect(mine.fills).toEqual(gold.fills);    // style: carried
    expect(mine.images).toBe(0);               // structure: not
  });
});
