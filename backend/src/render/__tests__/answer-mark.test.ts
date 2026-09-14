/*
 * The teacher's copy of a band: the check on the correct cell, drawn by the
 * server from what the picture's node records — the hand operation that cost
 * six to twelve minutes a lesson (download, composite, upload seven files).
 */
import { describe, it, expect } from "vitest";
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

describe("drawing the check", () => {
  it("returns a PNG of the same size, and not the same bytes", () => {
    const marked = markAnswerCells(BAND, [2]);
    expect(isPng(marked)).toBe(true);
    expect(imageSize(marked)).toEqual(imageSize(BAND));
    expect(marked.equals(BAND)).toBe(false);
  });

  it("marks two cells when the answer line gives two, and each differently from one", () => {
    const one = markAnswerCells(BAND, [2]);
    const two = markAnswerCells(BAND, [1, 2]);
    expect(two.equals(one)).toBe(false);
    // Deterministic: the same ask draws the same bytes.
    expect(markAnswerCells(BAND, [2]).equals(one)).toBe(true);
  });

  it("honours the formatter's colour and corner", () => {
    const black = markAnswerCells(BAND, [1]);
    const red = markAnswerCells(BAND, [1], { colour: "#E24B4A" });
    const bottomRight = markAnswerCells(BAND, [1], { corner: "bottom-right" });
    expect(red.equals(black)).toBe(false);
    expect(bottomRight.equals(black)).toBe(false);
  });

  it("refuses a cell the band does not have, saying how many it has", () => {
    expect(() => markAnswerCells(BAND, [4])).toThrow(/names cell 4 .* 3 square cell/);
    expect(() => markAnswerCells(BAND, [0])).toThrow(/names cell 0/);
  });

  it("refuses bytes that are not a raster picture", () => {
    expect(() => markAnswerCells(Buffer.from("<svg/>"), [1])).toThrow(/not a PNG or JPEG/);
  });
});
