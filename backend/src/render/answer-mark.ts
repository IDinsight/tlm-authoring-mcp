/*
 * The teacher's copy of a band: the pupil's picture with a check on the
 * correct cell.
 *
 * The formatter's rule, verbatim: « la vignette de la bonne réponse reçoit un
 * crochet ✓ — noir, épais, environ le quart de la hauteur de la vignette, posé
 * en haut à gauche, sans recouvrir ni le dessin utile ni le signe ». Every
 * lesson used to do this by hand: download the bands, composite, upload seven
 * new files under new names, and place those — six to twelve minutes of a
 * model's time per lesson, for an operation that is the same on every band
 * seen so far. So the graph records WHICH cell is right (the picture's
 * `metadata.answerMark`), and this draws it at layout time.
 *
 * WHERE A CELL IS. The band is `of` cells side by side, each the same width,
 * and cell k spans the k-th share. `of` is RECORDED with the answer, never
 * derived: the first assumption here was square vignettes (width over height,
 * rounded), and the delivered bands refuted it on the first real lesson —
 * 4.6:1 with a reference cell and three signed ones is FOUR cells, which
 * rounding calls five. The gutters between vignettes shift an edge by a few
 * pixels at most, and the mark sits a margin inside its corner, so nothing
 * here needs to know them. Without `of` the square guess still stands, and
 * says so.
 *
 * Drawn by writing an SVG over the picture and rasterizing it at the picture's
 * own size — the one raster tool the server has. The output is PNG whatever
 * came in, and the same size, so the page lays it out exactly as it lays out
 * the plain band.
 */
import { Resvg } from "@resvg/resvg-js";
import { imageSize } from "./image-size.js";
import { isPng } from "./raster.js";

/** How the mark looks; every field has the formatter's stated default. */
export type AnswerMarkStyle = {
  colour?: string;                       // hex, with or without '#'
  sizeFraction?: number;                 // of the cell's height
  corner?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
};

const DEFAULTS: Required<AnswerMarkStyle> = { colour: "000000", sizeFraction: 0.25, corner: "top-left" };

/** The square-vignette guess at a band's cell count: its width over its height, rounded. A fallback, never the record. */
export function bandCells(width: number, height: number): number {
  return Math.max(1, Math.round(width / height));
}

/** What a picture records about its answer: which cells, out of how many. */
export type AnswerMark = { cells: number[]; of?: number };

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const isJpeg = (bytes: Buffer): boolean => bytes.subarray(0, 3).equals(JPEG_SIGNATURE);

/**
 * Draw a check on each named cell. Throws with a caller-facing reason when it
 * cannot: the reason names what to fix, and the render refuses with it rather
 * than embedding the plain band where the teacher expects the key.
 */
export function markAnswerCells(bytes: Buffer, mark: AnswerMark, style: AnswerMarkStyle = {}): Buffer {
  const mime = isPng(bytes) ? "image/png" : isJpeg(bytes) ? "image/jpeg" : null;
  if (!mime) throw new Error("is not a PNG or JPEG — the mark is drawn on a raster picture (an SVG is rasterized first)");
  const size = imageSize(bytes);
  if (!size) throw new Error("has no readable size");

  const cells = mark.cells;
  const cellCount = mark.of ?? bandCells(size.width, size.height);
  const bad = cells.filter((cell) => !Number.isInteger(cell) || cell < 1 || cell > cellCount);
  if (bad.length > 0) {
    throw new Error(
      `names cell ${bad.join(", ")} but the band has ${cellCount} cell(s)` +
      (mark.of === undefined ? ` (guessed from its ${size.width}×${size.height} shape as square vignettes — record \`of\`, the real count, with the answer)` : ""),
    );
  }

  const { colour, sizeFraction, corner } = { ...DEFAULTS, ...style };
  const cellWidth = size.width / cellCount;
  const markSize = size.height * sizeFraction;
  const margin = size.height * 0.05;
  const strokeWidth = markSize * 0.22;

  const checks = cells.map((cell) => {
    const left = (cell - 1) * cellWidth;
    const x = corner.endsWith("right") ? left + cellWidth - margin - markSize : left + margin;
    const y = corner.startsWith("bottom") ? size.height - margin - markSize : margin;
    // A tick: down-right to the short arm's foot, then up-right to the long arm's tip.
    const path = `M ${x} ${y + markSize * 0.55} L ${x + markSize * 0.38} ${y + markSize * 0.92} L ${x + markSize} ${y + markSize * 0.12}`;
    return `<path d="${path}" fill="none" stroke="#${colour.replace("#", "")}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join("");

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}">` +
    `<image width="${size.width}" height="${size.height}" xlink:href="data:${mime};base64,${bytes.toString("base64")}"/>` +
    checks +
    `</svg>`;
  const renderer = new Resvg(svg, { fitTo: { mode: "width", value: size.width }, font: { loadSystemFonts: false } });
  return Buffer.from(renderer.render().asPng());
}
