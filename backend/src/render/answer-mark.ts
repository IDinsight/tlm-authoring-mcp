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
 * WHERE A CELL IS. A band is square vignettes side by side, so the number of
 * cells is the band's width over its height, rounded — 4.6:1 is four cells,
 * 6.15:1 six — and cell k spans the k-th share of the width. The gutters
 * between vignettes shift a cell's edge by a few pixels at most, and the mark
 * sits a margin inside its corner, so nothing here needs to know them.
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

/** How many square cells a band of this shape holds, and where cell `k` (1-based) starts. */
export function bandCells(width: number, height: number): number {
  return Math.max(1, Math.round(width / height));
}

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const isJpeg = (bytes: Buffer): boolean => bytes.subarray(0, 3).equals(JPEG_SIGNATURE);

/**
 * Draw a check on each named cell. Throws with a caller-facing reason when it
 * cannot: the reason names what to fix, and the render refuses with it rather
 * than embedding the plain band where the teacher expects the key.
 */
export function markAnswerCells(bytes: Buffer, cells: number[], style: AnswerMarkStyle = {}): Buffer {
  const mime = isPng(bytes) ? "image/png" : isJpeg(bytes) ? "image/jpeg" : null;
  if (!mime) throw new Error("is not a PNG or JPEG — the mark is drawn on a raster picture (an SVG is rasterized first)");
  const size = imageSize(bytes);
  if (!size) throw new Error("has no readable size");

  const cellCount = bandCells(size.width, size.height);
  const bad = cells.filter((cell) => !Number.isInteger(cell) || cell < 1 || cell > cellCount);
  if (bad.length > 0) {
    throw new Error(`names cell ${bad.join(", ")} but the band is ${size.width}×${size.height}, ${cellCount} square cell(s) wide`);
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
