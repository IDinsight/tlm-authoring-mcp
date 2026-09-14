/*
 * The cells of a band, read off the picture — because the count was being
 * assumed, and four of fourteen assumptions were wrong.
 */
import { describe, it, expect } from "vitest";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { detectBandCells } from "../band-cells.js";

/** A band of `cells` painted vignettes, `cellPx` wide and tall, `gutterPx` of white between them. */
function bandPng(cells: number, cellPx = 60, gutterPx = 4, paint: (x: number, y: number, cell: number) => boolean = () => true): Buffer {
  const width = cells * cellPx + (cells - 1) * gutterPx, height = cellPx;
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const cell = Math.floor(x / (cellPx + gutterPx));
    const inGutter = x - cell * (cellPx + gutterPx) >= cellPx;
    const ink = !inGutter && paint(x, y, cell);
    png.data[i] = ink ? 40 : 255; png.data[i + 1] = ink ? 90 : 255; png.data[i + 2] = ink ? 200 : 255; png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

describe("reading the cells of a band", () => {
  it("counts the vignettes between the white gutters, and says where each one is", () => {
    const four = detectBandCells(bandPng(4))!;
    expect(four.count).toBe(4);
    expect(four.edges.map((e) => e.left)).toEqual([0, 64, 128, 192]);
    expect(detectBandCells(bandPng(3))!.count).toBe(3);
    expect(detectBandCells(bandPng(6))!.count).toBe(6);
  });

  it("is not fooled by white INSIDE a vignette — a drawing on a white ground", () => {
    // Each cell is a drawing that covers only its middle band of rows, with
    // white above and below: every column still carries ink, so no false gutter.
    const drawing = bandPng(4, 60, 4, (x, y) => y > 15 && y < 45);
    expect(detectBandCells(drawing)!.count).toBe(4);
  });

  it("does not call a hairline between touching shapes a gutter", () => {
    // One-pixel white lines inside a cell are anti-aliasing, not a gap.
    const hairline = bandPng(3, 60, 4, (x) => x % 20 !== 10);
    expect(detectBandCells(hairline)!.count).toBe(3);
  });

  it("refuses to name cells on a picture that is not a row of equal vignettes", () => {
    // One drawing is not a band; nor is a drawing with a white stripe near its
    // edge, which cuts it into two pieces of very different widths.
    expect(detectBandCells(bandPng(1, 200, 0))).toBeNull();
    const striped = bandPng(1, 200, 0, (x) => x < 170 || x >= 176);
    expect(detectBandCells(striped)).toBeNull();
    expect(detectBandCells(Buffer.from("not an image"))).toBeNull();
  });

  it("reads a JPEG band the same way", () => {
    const png = PNG.sync.read(bandPng(4));
    const encoded = jpeg.encode({ width: png.width, height: png.height, data: png.data }, 92);
    expect(detectBandCells(Buffer.from(encoded.data))!.count).toBe(4);
  });
});
