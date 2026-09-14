/*
 * Counting pages on the render.
 *
 * The two parsers are the testable half — poppler's output is fixed and
 * machine-first, so it can be checked against captured samples without either
 * binary present. `measureDocx` itself needs LibreOffice, so the tests here
 * assert the thing that matters most when it is absent: that it says so, rather
 * than guessing.
 *
 * That distinction is the whole reason this module exists. The project has been
 * burnt twice by counts derived from the source — one document estimated at 2.5
 * pages rendered at eleven — so a missing number is a feature and a wrong one
 * is the defect.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { parsePdfInfo, parseBBox, parseWords, parseImages, measurePages, measureDocx, parsePdfFonts, fontAsDeclared } from "../measure.js";
import { renderDocx } from "../docx.js";
import { resolveRenderSpec } from "../resolve-spec.js";
import { rasterizeSvg } from "../raster.js";

// Real `pdfinfo` output shape, trimmed to the lines that are read.
const PDFINFO_A4 = `Title:          Guide-Lecon-1
Producer:       LibreOffice 24.2
Pages:          2
Page size:      595.276 x 841.89 pts (A4)
Page rot:       0
File size:      767252 bytes`;

const PDFINFO_LETTER = `Pages:          5
Page size:      612 x 792 pts (letter)`;

describe("reading what pdfinfo says", () => {
  it("takes the page count and the page size", () => {
    const info = parsePdfInfo(PDFINFO_A4)!;
    expect(info.pages).toBe(2);
    expect(info.size).toBe("A4");
    expect(Math.round(info.widthPt)).toBe(595);
  });

  it("reads the size even when it is the wrong one", () => {
    // Not an aside: a production run silently came out Letter instead of A4 and
    // lost 1.8 cm a page. The size is measured for the same reason the count is.
    const info = parsePdfInfo(PDFINFO_LETTER)!;
    expect(info.size).toBe("letter");
    expect(info.pages).toBe(5);
  });

  it("returns null rather than a half-read result", () => {
    expect(parsePdfInfo("Pages:          2")).toBeNull();
    expect(parsePdfInfo("")).toBeNull();
  });
});

// `pdftotext -bbox`, in points. A4 is 841.89 pt tall.
const A4_PT = 841.89;
const BBOX = `<?xml version="1.0" encoding="UTF-8"?>
<html><body>
<page width="595.276000" height="841.890000">
  <word xMin="70.86" yMin="70.86" xMax="120.00" yMax="85.00">Semaine</word>
  <word xMin="125.00" yMin="70.86" xMax="160.00" yMax="85.00">1</word>
  <word xMin="70.86" yMin="780.00" xMax="200.00" yMax="795.00">derniere</word>
</page>
<page width="595.276000" height="841.890000">
  <word xMin="70.86" yMin="70.86" xMax="120.00" yMax="85.00">Seance</word>
</page>
</body></html>`;

describe("reading where the ink lands", () => {
  it("reports one measurement per page, in centimetres", () => {
    const pages = parseBBox(BBOX, A4_PT);
    expect(pages).toHaveLength(2);
    expect(pages[0].page).toBe(1);
    expect(pages[0].words).toBe(3);
    expect(pages[0].textTopCm).toBeCloseTo(2.5, 1);
    expect(pages[0].textBottomCm).toBeCloseTo(28.05, 1);
  });

  it("reports the whitespace left below the last line", () => {
    // The number the tightening watched: the tightest of the twenty sheets came
    // in at 1.4 cm, and anything at zero has already overflowed.
    const pages = parseBBox(BBOX, A4_PT);
    expect(pages[0].freeBelowCm).toBeCloseTo(1.65, 1);
    expect(pages[1].freeBelowCm).toBeGreaterThan(25);
  });

  it("handles a page with no words rather than reporting nonsense", () => {
    const [page] = parseBBox(`<page width="595" height="841.89"></page>`, A4_PT);
    expect(page.words).toBe(0);
    expect(page.textTopCm).toBeNull();
    expect(page.freeBelowCm).toBeNull();
  });

  it("returns nothing for output with no pages in it", () => {
    expect(parseBBox("<html><body></body></html>", A4_PT)).toEqual([]);
  });
});

// `pdftohtml -xml -zoom 1`, captured from a LibreOffice PDF of a page with two
// floated bands anchored to two one-line activities — the second band drawn
// 32 pt into the first, which is the defect this exists to see.
const IMAGES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<pdf2xml producer="poppler" version="26.09.0">
<page number="1" position="absolute" top="0" left="0" height="841" width="595">
	<fontspec id="0" size="12" family="Andika" color="#000000"/>
<image top="56.450764" left="340.200000" width="212.550000" height="46.200000" src="probe-1_1.png"/>
<image top="70.450764" left="340.200000" width="212.550000" height="46.200000" src="probe-1_2.png"/>
<text top="56.972764" left="42.600000" width="217.726000" height="13.680000" font="0">• Quel signe manque ?</text>
</page>
<page number="2" position="absolute" top="0" left="0" height="841" width="595">
</page>
</pdf2xml>`;

const TWO_BANDS = `<html><body>
<page width="595.303937" height="841.889764">
  <word xMin="42.60" yMin="56.97" xMax="46.80" yMax="70.65">•</word>
  <word xMin="49.80" yMin="56.97" xMax="73.30" yMax="70.65">Quel</word>
  <word xMin="42.60" yMin="70.97" xMax="46.80" yMax="84.65">•</word>
  <word xMin="49.80" yMin="70.97" xMax="97.00" yMax="84.65">Combien</word>
</page>
<page width="595.303937" height="841.889764">
</page>
</body></html>`;

describe("reading where the pictures landed", () => {
  it("reports each picture's box in centimetres, scaled by the page height pdfinfo gave", () => {
    const pages = parseImages(IMAGES_XML, A4_PT);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(2);
    expect(pages[1]).toHaveLength(0);
    const measured = measurePages(parseWords(TWO_BANDS), pages, A4_PT);
    expect(measured[0].images[0]).toMatchObject({ topCm: 1.99, leftCm: 12.01, widthCm: 7.51, heightCm: 1.63 });
  });

  it("rescales boxes that poppler emitted at its default zoom", () => {
    // pdftohtml's default zoom is 1.5: the page declares height 1263 for an A4
    // page of 841.89 pt, and every box is half again too far down unless
    // scaled by what the page itself says.
    const zoomed = IMAGES_XML.replace('height="841" width="595"', 'height="1263" width="892"')
      .replace('top="56.450764" left="340.200000" width="212.550000" height="46.200000"', 'top="84.68" left="510.30" width="318.83" height="69.30"');
    const [page] = parseImages(zoomed, A4_PT);
    expect(page[0].top).toBeCloseTo(56.45, 0);
    expect(page[0].right - page[0].left).toBeCloseTo(212.55, 0);
  });

  it("measures the whitespace below the last MARK, picture or word", () => {
    // The number that overstated the room left on every page ending in a band:
    // words stop at 84.65 pt, the lower band at 116.65.
    const [page] = measurePages(parseWords(TWO_BANDS), parseImages(IMAGES_XML, A4_PT), A4_PT);
    expect(page.textBottomCm).toBeCloseTo(2.99, 1);
    expect(page.imageBottomCm).toBeCloseTo(4.11, 1);
    expect(page.inkBottomCm).toBe(page.imageBottomCm);
    expect(page.freeBelowCm).toBeCloseTo(29.7 - 4.11, 1);
  });

  it("reports a band drawn over the band before it, and by how much", () => {
    const [page] = measurePages(parseWords(TWO_BANDS), parseImages(IMAGES_XML, A4_PT), A4_PT);
    expect(page.overlaps).toEqual([{ kind: "image-over-image", images: [1, 2], overlapCm: 1.14 }]);
  });

  it("reports a picture drawn over words, naming them", () => {
    const words = parseWords(`<html><body><page width="595" height="841.89">
      <word xMin="345.00" yMin="104.00" xMax="400.00" yMax="117.00">RÉPONSE</word>
      <word xMin="403.00" yMin="104.00" xMax="410.00" yMax="117.00">:</word>
      <word xMin="42.60" yMin="104.00" xMax="60.00" yMax="117.00">beside</word>
    </page></body></html>`);
    const [page] = measurePages(words, parseImages(IMAGES_XML, A4_PT), A4_PT);
    const overText = page.overlaps.filter((o) => o.kind === "image-over-text");
    // The first band ends at 102.65 pt, so only the lower one reaches these
    // words; the word beside the bands is not under either.
    expect(overText).toEqual([{ kind: "image-over-text", image: 2, words: 2, text: "RÉPONSE :", overlapCm: 0.45 }]);
  });

  it("does not call a pictogram flush against its neighbours an overlap", () => {
    // Half a millimetre of shared box is a touch, not a defect.
    const images = [[{ top: 100, bottom: 114, left: 60, right: 74 }]];
    const words = [[{ top: 100, bottom: 114, left: 42, right: 61, text: "Sept" }]];
    const [page] = measurePages(words, images, A4_PT);
    expect(page.overlaps).toEqual([]);
  });

  it("keeps the words-only entry point working, with the picture fields empty", () => {
    const [page] = parseBBox(TWO_BANDS, A4_PT);
    expect(page.imageBottomCm).toBeNull();
    expect(page.images).toEqual([]);
    expect(page.freeBelowCm).toBeCloseTo(29.7 - 2.99, 1);
  });
});

describe("the fonts the PDF really carries", () => {
  // Real `pdffonts` output: a subset prefix on the name, a type with a space.
  const PDFFONTS = `name                                 type              encoding         emb sub uni object ID
------------------------------------ ----------------- ---------------- --- --- --- ---------
BAAAAA+Andika-Regular                TrueType          WinAnsi          yes yes yes     21  0
CAAAAA+Andika-Bold                   CID TrueType      Identity-H       yes yes yes     25  0
Helvetica                            Type 1            WinAnsi          no  no  no      30  0`;

  it("lists each font without its subset prefix, and whether it is embedded", () => {
    expect(parsePdfFonts(PDFFONTS)).toEqual([
      { name: "Andika-Regular", embedded: true },
      { name: "Andika-Bold", embedded: true },
      { name: "Helvetica", embedded: false },
    ]);
    expect(parsePdfFonts("")).toEqual([]);
  });

  it("says whether the declared family is among them — the silent substitution that falsifies every count", () => {
    const fonts = parsePdfFonts(PDFFONTS);
    expect(fontAsDeclared(fonts, "Andika")).toBe(true);
    expect(fontAsDeclared(fonts, "Liberation Sans")).toBe(false);
    // Nothing declared, or nothing read: no verdict rather than a false one.
    expect(fontAsDeclared(fonts, undefined)).toBeNull();
    expect(fontAsDeclared([], "Andika")).toBeNull();
  });
});

describe("white between lines that nothing explains", () => {
  // Four lines at a 14 pt pitch, then a step of 44 pt: one line of white
  // (44 − 14 = 30 pt ≈ 2 lines by the pitch, 1.06 cm from the line's bottom).
  const LINES = (extra: string) => `<html><body><page width="595" height="841.89">
    <word xMin="42" yMin="42" xMax="90" yMax="55.7">un</word>
    <word xMin="42" yMin="56" xMax="90" yMax="69.7">deux</word>
    <word xMin="42" yMin="70" xMax="90" yMax="83.7">trois</word>
    <word xMin="42" yMin="84" xMax="90" yMax="97.7">quatre</word>
    <word xMin="42" yMin="128" xMax="90" yMax="141.7">cinq</word>
    ${extra}
  </page></body></html>`;

  it("reports a step between lines of more than one and a half pitches, sized in body lines", () => {
    const [page] = measurePages(parseWords(LINES("")), [[]], A4_PT);
    expect(page.gaps).toEqual([{ afterCm: 3.45, heightCm: 1.07, lines: 2.1 }]);
  });

  it("does not call the white beside a floated picture a gap", () => {
    // A band beside a short block: the next line starts below the band, and
    // that white is the band's.
    const [page] = measurePages(parseWords(LINES("")), [[{ top: 84, bottom: 125, left: 340, right: 552 }]], A4_PT);
    expect(page.gaps).toEqual([]);
  });

  it("reads the pitch off the page, so a page set at another leading measures itself", () => {
    const loose = `<html><body><page width="595" height="841.89">
      <word xMin="42" yMin="42" xMax="90" yMax="58">a</word>
      <word xMin="42" yMin="60" xMax="90" yMax="76">b</word>
      <word xMin="42" yMin="78" xMax="90" yMax="94">c</word>
      <word xMin="42" yMin="96" xMax="90" yMax="112">d</word>
    </page></body></html>`;
    const [page] = measurePages(parseWords(loose), [[]], A4_PT);
    expect(page.gaps).toEqual([]);
  });
});

/*
 * The whole chain, where this machine can run it: a page rendered by this
 * renderer, laid out by LibreOffice, read back by poppler. CI has neither and
 * skips; a developer's laptop with both proves the clear block does what its
 * comment says, which no parser test can.
 */
const hasEngine = ["soffice", "pdfinfo", "pdftotext", "pdftohtml"].every((bin) => {
  try { execFileSync("which", [bin]); return true; } catch { return false; }
});

describe.skipIf(!hasEngine)("measuring a page this renderer produced", () => {
  const spec = resolveRenderSpec([{ id: "f", properties: { raw: { render: {
    page: { size: "A4", marginsCm: { top: 1.5, right: 1.5, bottom: 1.5, left: 1.5 } },
    type: { family: "Andika", sizePt: 12, leadingPt: 14, leadingRule: "exact" },
    images: { maxHeightCm: { band: 1.63 }, placement: "float-right" },
  } } } }]);
  if (!spec.ok) throw new Error(spec.errors.join("; "));
  const band = { image: { media: "band.png", role: "band", aspectRatio: 4.6, float: true } };
  const media = [{ name: "band.png", data: rasterizeSvg(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 46 10"><rect width="46" height="10" fill="#c02828"/></svg>`)) }];
  const activity = (text: string) => ({ kind: "line" as const, runs: [band, { text }] });

  it("sees the second band drawn over the first when nothing clears the wrap", async () => {
    const bytes = renderDocx({ media, blocks: [activity("Quel signe manque ?"), activity("Combien de cailloux ?")] }, spec.spec);
    const result = await measureDocx(bytes);
    if (!result.available) throw new Error(result.reason);
    expect(result.picturesMeasured).toBe(true);
    expect(result.fonts.length).toBeGreaterThan(0);   // whatever this machine substituted, it is named
    expect(result.perPage[0].images).toHaveLength(2);
    expect(result.perPage[0].overlaps).toEqual([expect.objectContaining({ kind: "image-over-image", images: [1, 2] })]);
    expect(result.perPage[0].overlaps[0].overlapCm).toBeGreaterThan(1);
  }, 60_000);

  it("shows a clear that nothing needed as a gap of one body line, and a needed one as none", async () => {
    // Enough text to run past the band on its own: the clear then ends a wrap
    // that had already ended, and costs a line.
    const long = "Ceci est une directive assez longue pour occuper plusieurs lignes à côté de la bande, et encore une phrase pour dépasser la hauteur de l'image, puis une troisième, puis une quatrième qui continue encore.";
    const wasted = renderDocx({ media, blocks: [{ kind: "line", runs: [band, { text: long }] }, { kind: "clear" }, { kind: "line", runs: [{ text: "Ligne suivante." }] }] }, spec.spec);
    const needed = renderDocx({ media, blocks: [activity("Quel signe manque ?"), { kind: "clear" }, { kind: "line", runs: [{ text: "Ligne suivante." }] }] }, spec.spec);
    const [a, b] = await Promise.all([measureDocx(wasted), measureDocx(needed)]);
    if (!a.available || !b.available) throw new Error("no layout");
    expect(a.perPage[0].gaps).toHaveLength(1);
    expect(a.perPage[0].gaps[0].lines).toBeGreaterThanOrEqual(1);
    expect(b.perPage[0].gaps).toEqual([]);
  }, 60_000);

  it("sees no overlap once a clear block ends the wrap, and only a hair of white below the band", async () => {
    const bytes = renderDocx({ media, blocks: [activity("Quel signe manque ?"), { kind: "clear" }, activity("Combien de cailloux ?")] }, spec.spec);
    const result = await measureDocx(bytes);
    if (!result.available) throw new Error(result.reason);
    const [page] = result.perPage;
    expect(page.overlaps).toEqual([]);
    expect(page.images[1].topCm - page.images[0].bottomCm).toBeLessThan(0.2);
  }, 60_000);
});

describe("when the environment cannot lay a document out", () => {
  it("says so, and never substitutes an estimate", async () => {
    // The one behaviour that matters more than the measurement. A wrong page
    // count gets believed; a missing one gets chased.
    const result = await measureDocx(Buffer.from("not a document"), {
      soffice: "/nonexistent/soffice", timeoutMs: 5_000,
    });
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.reason).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain("pages");
  });
});
