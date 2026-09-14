/*
 * A picture's width and height, read off its first bytes.
 *
 * The composer (curriculum/compose.ts) has to give the renderer each picture's
 * aspect ratio, and the only true source is the file. PNG and JPEG keep their
 * size in a header, so nothing decodes; an SVG declares it in its root
 * element, read by the same probe that rasterizes it.
 */

import { Resvg } from "@resvg/resvg-js";
import { isPng, isSvg } from "./raster.js";

export type ImageSize = { width: number; height: number };

function pngSize(bytes: Buffer): ImageSize | null {
  // IHDR is always the first chunk: width and height at bytes 16 and 20.
  if (bytes.length < 24) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegSize(bytes: Buffer): ImageSize | null {
  // Walk the marker segments to the first start-of-frame, which carries the size.
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const length = bytes.readUInt16BE(offset + 2);
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    offset += 2 + length;
  }
  return null;
}

function svgSize(bytes: Buffer): ImageSize | null {
  try {
    const probe = new Resvg(bytes.toString("utf8"), { font: { loadSystemFonts: false } });
    return probe.width > 0 && probe.height > 0 ? { width: probe.width, height: probe.height } : null;
  } catch {
    return null;
  }
}

/** The size of a PNG, JPEG or SVG, or null when the bytes are none of those or malformed. */
export function imageSize(bytes: Buffer): ImageSize | null {
  if (isPng(bytes)) return pngSize(bytes);
  if (isSvg(bytes)) return svgSize(bytes);
  return jpegSize(bytes);
}

/** Width over height, or null when the size cannot be read. */
export function imageAspectRatio(bytes: Buffer): number | null {
  const size = imageSize(bytes);
  return size && size.height > 0 ? size.width / size.height : null;
}
