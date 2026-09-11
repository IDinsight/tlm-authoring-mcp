/*
 * Word embeds raster pictures only. This is where a vector one becomes one.
 *
 * The pictograms and answer marks of the pupil book are SVG masters — Ministry
 * artwork, vectorised so it prints crisp at any size. Until now they lived as
 * SVG source inside the formatter prose, and whoever composed a page had to
 * rasterize them by hand. Converting here, at layout time, lets the masters
 * live in the media store as plain files and lets a page name them like any
 * other picture.
 *
 * Detection is by BYTES, never by file name: a `.png` that holds SVG text is
 * still converted, and a `.svg` name on real PNG bytes passes through.
 */
import { Resvg } from "@resvg/resvg-js";

export type MediaBytes = { name: string; data: Buffer };

/*
 * Pixels on the raster's longer side.
 *
 * The .docx scales a picture to the centimetres the formatter declares, so the
 * only thing this number decides is how sharp it can get. 1024 px is 300 dpi at
 * 8.7 cm — wider than any picture ceiling a formatter declares today — and a
 * flat pictogram at that size is a few tens of kilobytes.
 */
export const RASTER_LONG_SIDE_PX = 1024;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const isPng = (bytes: Buffer): boolean =>
  bytes.length >= PNG_SIGNATURE.length && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);

/** An SVG is an XML document whose root element is <svg>, allowing a prolog, comments and a doctype before it. */
export function isSvg(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 1024).toString("utf8").replace(/^﻿/, "").trimStart();
  if (!head.startsWith("<")) return false;
  return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head);
}

/*
 * Text in an SVG needs a font to be set with, and the server has none: the
 * glyphs would render as NOTHING, and an answer mark with no letter on it is a
 * page that renders successfully and wrongly. Refused instead, with the fix.
 */
const setsText = (svg: string): boolean => /<text[\s>]/i.test(svg);

/** Rasterize one SVG to PNG bytes. Throws with a caller-facing reason when it cannot. */
export function rasterizeSvg(svg: Buffer, longSidePx = RASTER_LONG_SIDE_PX): Buffer {
  const source = svg.toString("utf8");
  if (setsText(source)) {
    throw new Error(
      "sets text with a font, and the server has no fonts — the letters would silently render as nothing. " +
      "Convert the text to outlines in a vector editor, or upload a PNG of it.",
    );
  }
  const noFonts = { loadSystemFonts: false };
  const probe = new Resvg(source, { font: noFonts });
  const longestSide = Math.max(probe.width, probe.height);
  if (!(longestSide > 0)) {
    throw new Error("declares no usable size (no viewBox, width or height)");
  }
  const zoom = longSidePx / longestSide;
  const renderer = new Resvg(source, { fitTo: { mode: "zoom", value: zoom }, font: noFonts });
  return Buffer.from(renderer.render().asPng());
}

export type RasterRefusal = { name: string; reason: string };

/**
 * Convert every SVG entry of a document's media to PNG; raster entries pass
 * through untouched. Nothing is dropped silently: an SVG that cannot be
 * converted comes back in `refused`, naming the entry, for the caller to
 * refuse the whole render with.
 */
export function rasterizeSvgMedia(media: MediaBytes[]): { media: MediaBytes[]; rasterized: string[]; refused: RasterRefusal[] } {
  const out: MediaBytes[] = [];
  const rasterized: string[] = [];
  const refused: RasterRefusal[] = [];
  for (const entry of media) {
    if (!isSvg(entry.data)) {
      out.push(entry);
      continue;
    }
    try {
      out.push({ name: entry.name, data: rasterizeSvg(entry.data) });
      rasterized.push(entry.name);
    } catch (error) {
      refused.push({ name: entry.name, reason: (error as Error).message });
    }
  }
  return { media: out, rasterized, refused };
}

/**
 * The file name a picture is stored under inside the .docx.
 *
 * A page keeps naming its picture `picto.svg` — that name is the key every
 * image run uses — but the part holds PNG bytes once rasterized, and Word reads
 * the part's type off its extension. So the PART is `.png`; the name is not.
 */
export function mediaPartName(name: string, data: Buffer): string {
  return /\.svg$/i.test(name) && isPng(data) ? name.replace(/\.svg$/i, ".png") : name;
}
