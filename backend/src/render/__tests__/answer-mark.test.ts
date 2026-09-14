/*
 * The teacher's copy of a band: the check on the correct cell, drawn by the
 * server from what the picture's node records — the hand operation that cost
 * six to twelve minutes a lesson (download, composite, upload seven files).
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { markAnswerCells, bandCells } from "../answer-mark.js";
import { rasterizeSvg, isPng } from "../raster.js";
import { imageSize } from "../image-size.js";

// Three white square cells side by side, as a raster band.
const BAND = rasterizeSvg(Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 930 300"><rect width="930" height="300" fill="#fff"/></svg>`,
));

describe("how many cells a band has", () => {
  it("is its width over its height, rounded — the vignettes are square", () => {
    expect(bandCells(930, 300)).toBe(3);      // three cells and two gutters
    expect(bandCells(1230, 300)).toBe(4);     // 4.1:1 — the delivered bands
    expect(bandCells(1830, 300)).toBe(6);     // 6.15:1
    expect(bandCells(300, 300)).toBe(1);
  });
});

describe("the cells the picture shows win over the record", () => {
  const { PNG } = require("pngjs") as typeof import("pngjs");
  const gutterBand = (cells: number) => {
    const width = cells * 60 + (cells - 1) * 4, height = 60;
    const png = new PNG({ width, height });
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, inGutter = x % 64 >= 60;
      png.data[i] = inGutter ? 255 : 40; png.data[i + 1] = inGutter ? 255 : 90; png.data[i + 2] = inGutter ? 255 : 200; png.data[i + 3] = 255;
    }
    return PNG.sync.write(png);
  };

  it("refuses a record that contradicts the picture, naming both counts", () => {
    expect(() => markAnswerCells(gutterBand(3), { cells: [1], of: 4 })).toThrow(/records 4 cell.*picture shows 3/);
  });

  it("places the check in the cell the gutters delimit, not in an equal share", () => {
    // Four cells of 60 px with 4 px gutters: cell 4 starts at 192, where an
    // equal share of the 252 px width would start it at 189.
    const band = gutterBand(4);
    const byPicture = markAnswerCells(band, { cells: [4], of: 4 });
    expect(isPng(byPicture)).toBe(true);
    expect(byPicture.equals(band)).toBe(false);
    // And the read count fills in for a record with none.
    expect(() => markAnswerCells(band, { cells: [4] })).not.toThrow();
    expect(() => markAnswerCells(band, { cells: [5] })).toThrow(/band has 4 cell\(s\) \(read off the picture\)/);
  });
});

describe("drawing the check", () => {
  it("returns a PNG of the same size, and not the same bytes", () => {
    const marked = markAnswerCells(BAND, { cells: [2] });
    expect(isPng(marked)).toBe(true);
    expect(imageSize(marked)).toEqual(imageSize(BAND));
    expect(marked.equals(BAND)).toBe(false);
  });

  it("marks two cells when the answer line gives two, and each differently from one", () => {
    const one = markAnswerCells(BAND, { cells: [2] });
    const two = markAnswerCells(BAND, { cells: [1, 2] });
    expect(two.equals(one)).toBe(false);
    // Deterministic: the same ask draws the same bytes.
    expect(markAnswerCells(BAND, { cells: [2] }).equals(one)).toBe(true);
  });

  it("honours the formatter's colour and corner", () => {
    const black = markAnswerCells(BAND, { cells: [1] });
    const red = markAnswerCells(BAND, { cells: [1] }, { colour: "#E24B4A" });
    const bottomRight = markAnswerCells(BAND, { cells: [1] }, { corner: "bottom-right" });
    expect(red.equals(black)).toBe(false);
    expect(bottomRight.equals(black)).toBe(false);
  });

  it("refuses a cell the band does not have, saying how many it has and that the count was a guess", () => {
    expect(() => markAnswerCells(BAND, { cells: [4] })).toThrow(/names cell 4 but the band has 3 cell.*guessed.*record `of`/);
    expect(() => markAnswerCells(BAND, { cells: [0] })).toThrow(/names cell 0/);
  });

  it("takes the recorded cell count over the square-vignette guess", () => {
    // The delivered bands: 4.6:1, a reference cell and three signed ones — four
    // cells, where width over height rounds to five. Recorded, cell 4 is real
    // and lands in the last quarter; guessed, it would land in the fourth fifth.
    const wide = rasterizeSvg(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1380 300"><rect width="1380" height="300" fill="#fff"/></svg>`));
    expect(bandCells(1380, 300)).toBe(5);
    const recorded = markAnswerCells(wide, { cells: [4], of: 4 });
    const guessed = markAnswerCells(wide, { cells: [4] });
    expect(recorded.equals(guessed)).toBe(false);
    expect(() => markAnswerCells(wide, { cells: [5], of: 4 })).toThrow(/band has 4 cell/);
  });

  it("refuses bytes that are not a raster picture", () => {
    expect(() => markAnswerCells(Buffer.from("<svg/>"), { cells: [1] })).toThrow(/not a PNG or JPEG/);
  });
});
