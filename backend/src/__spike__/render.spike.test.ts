/*
 * WP4 spike — does this runtime produce the sheets the project already ships?
 *
 * The renderer's source was lost, so WP4 is a rebuild whichever language it
 * lands in. That makes the choice an empirical one: build one sheet here, hold
 * it against the real file, and see what fights back.
 *
 * The target is `Guide-Lecon-1-ensembles-FR.docx` from the 2 September run — two
 * pages, nine pictures, ten banner colours, 15.5 pt exact leading, the page
 * break carried by the séance-2 banner. It is the harder of the two document
 * types and it exercises every knob in `properties.render`.
 *
 * The golden file is not in the repo — a megabyte per sheet, twenty sheets — so
 * these tests SKIP unless GOLDEN_DIR names the folder holding them:
 *
 *     GOLDEN_DIR="…/Guide d'utilisation de l'outil de l'élève/Outputs" npm test
 *
 * That the corpus lives on one laptop and nowhere else is a real risk, not a
 * packaging detail. See docs/design-notes/renderer-spike.md.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { renderSpecSchema } from "../kg-recipes/index.js";
import { renderDocx } from "./renderer.js";
import { readGolden, type GoldenMaps } from "./golden.js";
import { unzip } from "./zip.js";

const GOLDEN_DIR = process.env.GOLDEN_DIR ?? "";
const GOLDEN = GOLDEN_DIR ? join(GOLDEN_DIR, "Guide-Lecon-1-ensembles-FR.docx") : "";
const haveGolden = GOLDEN !== "" && existsSync(GOLDEN);

// The CI-maths teacher sheet, measured off the twenty 2 September files.
const SPEC = renderSpecSchema.parse({
  page: { size: "A4", orientation: "portrait", marginsCm: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 } },
  type: { family: "Andika", sizePt: 12, leadingPt: 15.5, leadingRule: "exact" },
  budget: { linesPerPage: 45, lineHeightCm: 0.547, maxCharsPerLine: 72, maxCharsBesideImage: 52 },
  blocks: {
    weekCell: { fill: "2EAEE5", textColour: "FFFFFF" },
    lessonCell: { fill: "57BC49", textColour: "FFFFFF" },
    dayCell: { fill: "C0504D", textColour: "FFFFFF" },
    objectiveBanner: { fill: "3E4D9E", textColour: "FFFFFF" },
    materialsBox: { fill: "00B0F0", textColour: "FFFFFF" },
    sessionBanner: { fill: "09A9E1", textColour: "FFFFFF" },
    phaseBanner: { fill: "79D0F0", textColour: "000000", keepWithNext: true },
    retainBanner: { fill: "9DD485", textColour: "000000" },
    objectivationBanner: { fill: "E88169", textColour: "000000" },
    evaluationBanner: { fill: "92CDDC", textColour: "000000" },
    bullet: { marker: "•", maxChars: 72, maxCharsBesideImage: 52 },
  },
  images: {
    maxHeightCm: { amorce: 2.4, notion: 2, bande: 2, pictogram: 0.5, marker: 0.42 },
    maxWidthCm: 7.5,
    placement: "float-right",
    maxPerSection: 2,
    fullWidthAboveAspectRatio: 4,
    paragraphLeadingRule: "auto",
  },
  pagination: { oneSectionPerPage: true, pageBreakCarrier: "banner-property" },
  visibility: { printedPrefixes: ["[N]", "[FR]", "[WO]", "[IMAGE :"], neverPrint: ["assemblyGuide"] },
  language: {
    strategy: "per-file",
    variants: [
      { id: "commun", lang: "fr", colour: "000000", inAllFiles: true },
      { id: "fr", lang: "fr", colour: "C0504D", prefix: "[FR]", fileSuffix: "-FR" },
      { id: "wo", lang: "wo", colour: "0070C0", prefix: "[WO]", fileSuffix: "-WO" },
    ],
  },
  overflow: { policy: "tighten-text", neverAdjust: ["margins", "leading", "typeSize", "images"] },
});

const MAPS: GoldenMaps = {
  blockOfFill: {
    "2EAEE5": "weekCell", "57BC49": "lessonCell", "C0504D": "dayCell",
    "3E4D9E": "objectiveBanner", "00B0F0": "materialsBox", "09A9E1": "sessionBanner",
    "79D0F0": "phaseBanner", "9DD485": "retainBanner", "E88169": "objectivationBanner",
    "92CDDC": "evaluationBanner",
  },
  variantOfColour: { "000000": "commun", C0504D: "fr", "0070C0": "wo" },
  roleOfMedia: {},   // filled below from each image's measured shape
};

type Facts = {
  pgSz: string | undefined; pgMar: string | undefined;
  leading: [string, string][]; fills: string[]; colours: string[];
  images: [number, number][]; breakBefore: number; tables: number; texts: string[];
  /** "<kind>|<line>/<rule>" -> paragraphs. The shape of the image-crop bug. */
  leadingByParagraph: Record<string, number>;
};

function facts(bytes: Buffer): Facts {
  const doc = unzip(bytes).get("word/document.xml")!.toString("utf8");
  const round = (emu: string) => Math.round((Number(emu) / 360000) * 100) / 100;
  return {
    pgSz: /<w:pgSz w:w="(\d+)" w:h="(\d+)"/.exec(doc)?.slice(1).join("x"),
    pgMar: /<w:pgMar w:top="(\d+)" w:right="(\d+)" w:bottom="(\d+)" w:left="(\d+)"/.exec(doc)?.slice(1).join("/"),
    leading: [...new Set([...doc.matchAll(/w:line="(\d+)"[^/>]*w:lineRule="(\w+)"/g)]
      .map((m) => `${m[1]}/${m[2]}`))].map((s) => s.split("/") as [string, string]),
    fills: [...new Set([...doc.matchAll(/w:fill="([0-9A-Fa-f]{6})"/g)].map((m) => m[1].toUpperCase()))].sort(),
    colours: [...new Set([...doc.matchAll(/<w:color w:val="([0-9A-Fa-f]{6})"\/>/g)].map((m) => m[1].toUpperCase()))].sort(),
    images: [...doc.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)].map((m) => [round(m[1]), round(m[2])]),
    breakBefore: (doc.match(/<w:pageBreakBefore\/>/g) ?? []).length,
    tables: (doc.match(/<w:tbl>/g) ?? []).length,
    // Per PARAGRAPH, not per run: the golden splits a line across several runs
    // wherever a word is emphasised, and the comparison is about the line.
    leadingByParagraph: (() => {
      const body = /<w:body>([\s\S]*)<\/w:body>/.exec(doc)![1];
      const out: Record<string, number> = {};
      for (const p of body.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
        const kind = p[0].includes("<wp:inline") ? "inline-img" : "text";
        const sp = /w:line="(\d+)"[^/>]*w:lineRule="(\w+)"/.exec(p[0]);
        const key = `${kind}|${sp ? `${sp[1]}/${sp[2]}` : "inherit"}`;
        out[key] = (out[key] ?? 0) + 1;
      }
      return out;
    })(),
    texts: [...doc.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
      .map((p) => [...p[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(""))
      .map((t) => t.replace(/\s+/g, " ").trim())
      .filter(Boolean),
  };
}

describe.skipIf(!haveGolden)("WP4 spike — rebuild lesson 1's teacher sheet", () => {
  const goldenBytes = haveGolden ? readFileSync(GOLDEN) : Buffer.alloc(0);
  const gold = haveGolden ? facts(goldenBytes) : ({} as Facts);

  // Roles are assigned from each picture's measured shape, which is what the
  // formatter's prose says decides them: a band is the wide one, the opening
  // scene is taller, anything under a line's height is a pictogram.
  const model = haveGolden ? (() => {
    const m = readGolden(goldenBytes, MAPS);
    for (const b of m.blocks) {
      if (b.kind !== "line") continue;
      for (const r of b.runs) {
        if (!("image" in r)) continue;
        const ar = r.image.aspectRatio;
        r.image.role = ar > 4 ? "bande" : ar > 1.7 ? "amorce" : "pictogram";
      }
    }
    return m;
  })() : null;

  const mineBytes = haveGolden ? renderDocx(model!, SPEC) : Buffer.alloc(0);
  const mine = haveGolden ? facts(mineBytes) : ({} as Facts);

  // Written out so a human can open it. Not an assertion -- the eye is the only
  // check for the thing measurement missed last time (see the 5 mm crop).
  it("writes the rendered sheet to /tmp for inspection", () => {
    writeFileSync("/tmp/spike-Guide-Lecon-1-ensembles-FR.docx", mineBytes);
    expect(mineBytes.length).toBeGreaterThan(10000);
  });

  it("produces a file Word will open — a valid zip with the required parts", () => {
    const parts = unzip(mineBytes);
    for (const required of ["[Content_Types].xml", "_rels/.rels", "word/document.xml",
                            "word/_rels/document.xml.rels", "word/styles.xml"]) {
      expect(parts.has(required)).toBe(true);
    }
    expect(parts.get("word/media/image1.png")!.length).toBeGreaterThan(0);
  });

  it("matches the page geometry", () => {
    expect(mine.pgSz).toBe(gold.pgSz);
    expect(mine.pgMar).toBe(gold.pgMar);
  });

  it("matches the leading, exact rule and all", () => {
    expect(mine.leading).toContainEqual(["310", "exact"]);
    expect(gold.leading).toContainEqual(["310", "exact"]);
  });

  it("matches every banner colour and every text colour", () => {
    expect(mine.fills).toEqual(gold.fills);
    expect(mine.colours).toEqual(gold.colours);
  });

  it("carries the page break on the banner, once", () => {
    expect(mine.breakBefore).toBe(gold.breakBefore);
    expect(mine.breakBefore).toBe(1);
  });

  it("reproduces every banner", () => {
    expect(mine.tables).toBe(gold.tables);
  });

  // Both sides are stripped of the bullet marker: the golden carries it inside
  // the line's own text run, this renderer emits it as a run of its own. They
  // render identically, and the comparison is about the words.
  it("reproduces every printed line, word for word", () => {
    const strip = (rows: string[]) =>
      rows.map((t) => t.replace(/^•\s*/, "")).filter(Boolean);
    expect(strip(mine.texts)).toEqual(strip(gold.texts));
  });

  /*
   * The strongest assertion here, and the reason for the schema change.
   *
   * A paragraph's leading rule decides whether Word grows the line to fit a
   * picture or crops the picture to fit the line, and the golden sheets do BOTH:
   * pictograms sit on the exact rule, the two tall pictures do not. Reproducing
   * that split — rather than just "images get automatic leading", which relaxes
   * every pictogram line too — is what makes the output the same length.
   */
  it("gives each paragraph the leading the golden gives it, crop rule and all", () => {
    expect(mine.leadingByParagraph).toEqual(gold.leadingByParagraph);
  });

  it("embeds every picture, sized from the spec rather than the file", () => {
    expect(mine.images.length).toBe(gold.images.length);
    // Heights come from images.maxHeightCm by role -- so they must equal the
    // declared ceiling, not whatever the source picture happened to be.
    for (const [, h] of mine.images) {
      expect([2.4, 2, 0.5]).toContain(h);
    }
  });
});
