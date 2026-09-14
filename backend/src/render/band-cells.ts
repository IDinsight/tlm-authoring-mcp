/*
 * Reading a band's cells off the picture itself.
 *
 * A band is vignettes side by side with white gutters between them. The
 * answer a picture records names a cell by its position, out of a count —
 * and the count was ASSUMED: the fourteen bands of Leçons 24 and 25 were all
 * recorded as four cells (a reference and three signed), and four of them had
 * no reference cell. The check landed one cell to the right on each, and
 * nothing could say so, because nothing read the band.
 *
 * So this reads it. The gutters are the columns of the picture that are white
 * from top to bottom; between them are the cells. Two things are asked of the
 * result before it is believed: that there be gutters at all, and that the
 * cells they cut be of one width — a band is a row of equal vignettes, and a
 * picture that is not one (a scene, a notion image) has no cells to name.
 *
 * Decoding is pure JavaScript (pngjs, jpeg-js): the server rasterizes with
 * resvg but resvg reads nothing back, and a native decoder would be the
 * heavier dependency for a job that runs once per attach.
 */
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { isPng } from "./raster.js";

export type BandCells = {
  /** How many cells the picture shows. */
  count: number;
  /** Each cell's left and right edge, in pixels — where a mark belongs. */
  edges: { left: number; right: number }[];
  width: number;
  height: number;
};

/** A pixel is background when it is nearly white; a gutter is a column of nothing else. */
const WHITE = 235;
/** A column counts as a gutter only if this share of it is white — a hairline of drawing in it is still a gutter. */
const GUTTER_WHITE_SHARE = 0.985;
/** Gutters narrower than this are anti-aliasing between two touching shapes, not a gap between cells. */
const MIN_GUTTER_PX = 3;
/** Cells must agree in width to this share of the widest, or the picture is not a row of vignettes. */
const CELL_WIDTH_TOLERANCE = 0.25;

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

function decode(bytes: Buffer): { width: number; height: number; rgba: Uint8Array } | null {
  try {
    if (isPng(bytes)) {
      const png = PNG.sync.read(bytes);
      return { width: png.width, height: png.height, rgba: png.data };
    }
    if (bytes.subarray(0, 3).equals(JPEG_SIGNATURE)) {
      const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
      return { width: img.width, height: img.height, rgba: img.data };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * The cells a band shows, or null when the picture is not a row of equal
 * vignettes with white between them — which is the honest answer for a
 * scene or a notion image, and for a band this cannot read.
 */
export function detectBandCells(bytes: Buffer): BandCells | null {
  const image = decode(bytes);
  if (!image || image.width < 8 || image.height < 8) return null;
  const { width, height, rgba } = image;

  // Per column: the share of pixels that are white (or transparent).
  const whiteShare = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    let white = 0;
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;
      const alpha = rgba[i + 3];
      if (alpha < 16 || (rgba[i] >= WHITE && rgba[i + 1] >= WHITE && rgba[i + 2] >= WHITE)) white++;
    }
    whiteShare[x] = white / height;
  }

  // Runs of gutter columns; the content between two runs is a cell.
  const cells: { left: number; right: number }[] = [];
  let x = 0;
  while (x < width) {
    while (x < width && whiteShare[x] >= GUTTER_WHITE_SHARE) x++;
    if (x >= width) break;
    const left = x;
    while (x < width && whiteShare[x] < GUTTER_WHITE_SHARE) x++;
    cells.push({ left, right: x });
  }

  // Merge content runs split by a gap too narrow to be a gutter.
  const merged: { left: number; right: number }[] = [];
  for (const cell of cells) {
    const last = merged[merged.length - 1];
    if (last && cell.left - last.right < MIN_GUTTER_PX) last.right = cell.right;
    else merged.push({ ...cell });
  }
  // One run of content is one drawing — a scene, a notion image — not a band.
  if (merged.length < 2) return null;

  // A row of vignettes: the cells agree in width. One wide cell is a scene,
  // not a band; wildly unequal ones are a drawing with white in it.
  const widths = merged.map((c) => c.right - c.left);
  const widest = Math.max(...widths);
  if (widths.some((w) => w < widest * (1 - CELL_WIDTH_TOLERANCE))) return null;

  return { count: merged.length, edges: merged, width, height };
}
