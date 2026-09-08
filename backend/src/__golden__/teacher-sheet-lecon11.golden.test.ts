/*
 * Does the renderer still reproduce the sheets that were actually delivered?
 *
 * The corpus is the 6 September 2026 run — ten lessons, French and Wolof, the
 * geometry decided on 5 September (A4, margins 1,22 / 1,07 / 1,27 / 1,27, Andika
 * 12 pt on an EXACT 14 pt leading).
 *
 * It replaces `teacher-sheet.golden.test.ts`, which pointed at the 2 September
 * corpus this run superseded. That suite did not fail when its target vanished
 * — it SKIPPED, exactly as it does when the corpus is simply absent, and so the
 * renderer's only regression check reported success for six days while checking
 * nothing. A skipping regression test is worse than none.
 *
 * WHY LESSON 11 AND NOT A SYNTHETIC PAGE: this sheet was built by the producer's
 * own script and accepted by the expert, so it is the only statement we have of
 * what the output must look like. The model is recovered FROM it (readGolden)
 * and rendered again, so the renderer cannot mark its own homework: identical
 * words in, and every difference that comes out is the renderer's.
 *
 * The golden files are not in the repo — several megabytes each — so this SKIPS
 * unless GOLDEN_DIR names the folder holding the lesson folders:
 *
 *     GOLDEN_DIR="…/Guide d'utilisation de l'outil de l'élève/Outputs" npx vitest run src/__golden__
 *
 * THE SPEC BELOW IS A COPY of the published formatter's geometry, deliberately:
 * a test that fetched it would need the network, and this suite is about the
 * RENDERER, not about what the graph currently holds. If the two drift, this
 * test keeps passing while production changes — so a geometry change in the
 * graph belongs here too.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { renderSpecSchema } from "../kg-recipes/index.js";
import { renderDocx, unzip } from "../render/index.js";
import { readGolden, type GoldenMaps } from "./golden.js";

const GOLDEN_DIR = process.env.GOLDEN_DIR ?? "";
const GOLDEN = GOLDEN_DIR
  ? join(GOLDEN_DIR, "lecon_11", "Guide-Lecon-11-inclusion-partition-FR.docx")
  : "";
const haveGolden = GOLDEN !== "" && existsSync(GOLDEN);

// senegal/ci/maths, formatter « Guide de l'enseignant — gabarit répété d'une
// fiche », as published on 8 September 2026.
const SPEC = renderSpecSchema.parse({
  page: { size: "A4", orientation: "portrait", marginsCm: { top: 1.22, bottom: 1.07, left: 1.27, right: 1.27 } },
  type: { family: "Andika", sizePt: 12, leadingPt: 14, leadingRule: "exact", colour: "000000" },
  budget: { maxPages: 2, linesPerPage: 56, maxCharsPerLine: 88, maxCharsBesideImage: 48, reserveBottomCm: 2 },
  blocks: {
    "bandeau-semaine": { fill: "2EAEE5", textColour: "FFFFFF", bold: true, sizePt: 12, border: "none", cellMarginsCm: 0.07, keepWithNext: true },
    "bandeau-lecon": { fill: "57BC49", textColour: "FFFFFF", bold: true, sizePt: 12, border: "none", cellMarginsCm: 0.07, keepWithNext: true },
    "bandeau-jour": { fill: "C0504D", textColour: "FFFFFF", bold: true, sizePt: 12, border: "none", cellMarginsCm: 0.07, keepWithNext: true },
    "bandeau-os": { fill: "3E4D9E", textColour: "FFFFFF", bold: true, sizePt: 12, border: "none", cellMarginsCm: 0.07, fullWidth: true, keepWithNext: true },
    "bandeau-materiel": { fill: "00B0F0", textColour: "FFFFFF", bold: true, sizePt: 12, border: "none", cellMarginsCm: 0.07, fullWidth: true, keepWithNext: true },
    "bandeau-seance": { fill: "09A9E1", textColour: "FFFFFF", bold: true, sizePt: 12, border: "none", cellMarginsCm: 0.07, keepWithNext: true },
    "bandeau-phase-bleu": { fill: "79D0F0", textColour: "000000", bold: true, sizePt: 12, border: "none", cellMarginsCm: 0.07, keepWithNext: true },
    "bandeau-phase-vert": { fill: "9DD485", textColour: "000000", bold: true, sizePt: 12, border: "none", cellMarginsCm: 0.07, keepWithNext: true },
    "bandeau-phase-orange": { fill: "E88169", textColour: "000000", bold: true, sizePt: 12, border: "none", cellMarginsCm: 0.07, keepWithNext: true },
    "bandeau-phase-grisbleu": { fill: "92CDDC", textColour: "000000", bold: true, sizePt: 12, border: "none", cellMarginsCm: 0.07, keepWithNext: true },
    puce: { marker: "•" },
  },
  images: {
    placement: "float-right",
    maxHeightCm: { amorce: 2.6, notion: 2.2, bande: 2.5, scene: 2.8 },
    maxWidthCm: 10.5,
    inlineHeightCm: { marqueur: 0.42, "picto-section": 0.42, "picto-materiel": 0.5 },
    paragraphLeadingRule: "auto",
    caption: false,
  },
  pagination: { oneSectionPerPage: true, pageBreakCarrier: "banner-property" },
  visibility: { printedPrefixes: ["N", "FR", "WO"], neverPrint: ["n", "fr", "wo"] },
  language: {
    strategy: "per-file",
    variants: [
      { id: "N", lang: "fr", colour: "000000", inAllFiles: true },
      { id: "FR", lang: "fr", colour: "C0504D", bold: true, prefix: "[FR]", fileSuffix: "-FR" },
      { id: "WO", lang: "wo", colour: "0070C0", bold: true, prefix: "[WO]", fileSuffix: "-WO" },
    ],
  },
  overflow: { policy: "tighten-text", neverAdjust: ["margins", "leading", "typeSize"] },
});

const MAPS: GoldenMaps = {
  blockOfFill: {
    "2EAEE5": "bandeau-semaine", "57BC49": "bandeau-lecon", "C0504D": "bandeau-jour",
    "3E4D9E": "bandeau-os", "00B0F0": "bandeau-materiel", "09A9E1": "bandeau-seance",
    "79D0F0": "bandeau-phase-bleu", "9DD485": "bandeau-phase-vert",
    "E88169": "bandeau-phase-orange", "92CDDC": "bandeau-phase-grisbleu",
  },
  variantOfColour: { "000000": "N", C0504D: "FR", "0070C0": "WO" },
  roleOfMedia: {},   // assigned below from each picture's measured shape
  bulletMarker: { marker: "•", style: "puce" },
};

const body = (bytes: Buffer) => unzip(bytes).get("word/document.xml")!.toString("utf8");

/*
 * What a READER sees, one entry per printed line: the words, the colours, and
 * whether the line is bold.
 *
 * Counting RUNS instead would report differences that do not exist. The two
 * files split their runs differently — the delivered sheet carries the bullet
 * inside the line's own text run, this renderer emits it as a run of its own,
 * and a phase banner's pictogram rides in an empty run — so run counts differ by
 * dozens on a page that is visually identical. An inherited colour and an
 * explicit black also render the same, and are read as the same here.
 */
function printedLines(bytes: Buffer): string[] {
  const out: string[] = [];
  for (const paragraph of body(bytes).matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const runs = [...paragraph[0].matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)]
      .map((m) => m[0])
      .filter((run) => /<w:t/.test(run))
      .filter((run) => textOf(run).trim() !== "");
    const text = runs.map(textOf).join("").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const colours = [...new Set(runs.map((run) =>
      (/<w:color w:val="([0-9A-Fa-f]{6})"/.exec(run) ?? [])[1]?.toUpperCase() ?? "000000"))];
    const bold = runs.every((run) => run.includes("<w:b/>"));
    out.push(`${bold ? "B" : "-"} ${colours.join("+")} ${text}`);
  }
  return out;
}

const textOf = (xml: string) =>
  [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");

const countOf = (xml: string, pattern: RegExp) => (xml.match(pattern) ?? []).length;

describe.skipIf(!haveGolden)("the delivered teacher sheet — lesson 11, 6 September 2026", () => {
  const goldenBytes = haveGolden ? readFileSync(GOLDEN) : Buffer.alloc(0);

  // Roles come from each picture's measured shape, which is what the formatter's
  // prose says decides them: a band is the wide one, an opening scene is taller,
  // anything shorter than a line is a pictogram set in the text.
  const model = haveGolden ? (() => {
    const recovered = readGolden(goldenBytes, MAPS);
    const walk = (blocks: typeof recovered.blocks): void => {
      for (const block of blocks) {
        if (block.kind === "table") {
          for (const row of block.rows) for (const cell of row) walk(cell.blocks);
          continue;
        }
        if (block.kind !== "line") continue;
        for (const run of block.runs) {
          if (!("image" in run)) continue;
          const ratio = run.image.aspectRatio;
          run.image.role = ratio > 4 ? "bande" : ratio > 1.7 ? "amorce" : "picto-section";
        }
      }
    };
    walk(recovered.blocks);
    return recovered;
  })() : null;

  const mineBytes = haveGolden ? renderDocx(model!, SPEC) : Buffer.alloc(0);

  it("produces a file Word will open", () => {
    const parts = unzip(mineBytes);
    for (const required of ["[Content_Types].xml", "_rels/.rels", "word/document.xml",
                            "word/_rels/document.xml.rels", "word/styles.xml"]) {
      expect(parts.has(required)).toBe(true);
    }
  });

  it("matches the page size and all four margins", () => {
    const of = (xml: string) => ({
      size: /<w:pgSz w:w="(\d+)" w:h="(\d+)"/.exec(xml)?.slice(1).join("x"),
      margins: /<w:pgMar w:top="(\d+)" w:right="(\d+)" w:bottom="(\d+)" w:left="(\d+)"/.exec(xml)?.slice(1).join("/"),
    });
    expect(of(body(mineBytes))).toEqual(of(body(goldenBytes)));
  });

  it("matches every banner fill and every text colour", () => {
    const of = (xml: string, pattern: RegExp) =>
      [...new Set([...xml.matchAll(pattern)].map((m) => m[1].toUpperCase()))].sort();
    expect(of(body(mineBytes), /w:fill="([0-9A-Fa-f]{6})"/g))
      .toEqual(of(body(goldenBytes), /w:fill="([0-9A-Fa-f]{6})"/g));
    expect(of(body(mineBytes), /<w:color w:val="([0-9A-Fa-f]{6})"\/>/g))
      .toEqual(of(body(goldenBytes), /<w:color w:val="([0-9A-Fa-f]{6})"\/>/g));
  });

  it("reproduces every banner and carries the page break once", () => {
    expect(countOf(body(mineBytes), /<w:tbl>/g)).toBe(countOf(body(goldenBytes), /<w:tbl>/g));
    expect(countOf(body(mineBytes), /<w:pageBreakBefore\/>/g)).toBe(1);
    expect(countOf(body(goldenBytes), /<w:pageBreakBefore\/>/g)).toBe(1);
  });

  it("places every picture, floating and inline alike", () => {
    for (const pattern of [/<wp:anchor /g, /<wp:inline/g, /<wp:extent /g]) {
      expect(countOf(body(mineBytes), pattern)).toBe(countOf(body(goldenBytes), pattern));
    }
  });

  /*
   * The assertion that matters. Two defects hid behind the weaker ones: the
   * language variant's WEIGHT was dropped, so every French and Wolof line came
   * out red-but-plain, and no bullet was emitted at all. Both are invisible to a
   * count of lines or colours, and both change every page a teacher reads.
   */
  it("reproduces every printed line — words, colour and weight", () => {
    expect(printedLines(mineBytes)).toEqual(printedLines(goldenBytes));
  });
});
