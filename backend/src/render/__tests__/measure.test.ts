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
import { parsePdfInfo, parseBBox, measureDocx } from "../measure.js";

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
