/*
 * A vector picture becomes a raster one at layout, or the render refuses.
 *
 * The pupil book's pictograms are SVG masters; Word embeds raster only. What is
 * pinned here: the conversion happens on the bytes (not the name), the raster
 * is sized for print, and the one case that would render silently wrong — text
 * with no font to set it — is a refusal that names the fix.
 */
import { describe, it, expect } from "vitest";
import { isSvg, isPng, rasterizeSvg, rasterizeSvgMedia, mediaPartName, RASTER_LONG_SIDE_PX } from "../raster.js";

const SQUARE_SVG = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">` +
  `<rect x="0" y="0" width="100" height="100" rx="18" fill="#F6872C"/></svg>`,
);
const TALL_SVG = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 40"><rect width="10" height="40"/></svg>`);
const TEXT_SVG = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
  `<text x="50" y="52" font-family="Arial" font-size="60">X</text></svg>`,
);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

// PNG keeps its size in the IHDR chunk, big-endian, right after the signature.
const pngSize = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

describe("isSvg — by bytes, never by name", () => {
  it("recognises a bare <svg>, one behind an XML prolog, and one behind a comment", () => {
    expect(isSvg(SQUARE_SVG)).toBe(true);
    expect(isSvg(Buffer.from(`<?xml version="1.0"?>\n${SQUARE_SVG.toString()}`))).toBe(true);
    expect(isSvg(Buffer.from(`﻿<!-- Ministry artwork -->\n${SQUARE_SVG.toString()}`))).toBe(true);
  });

  it("is not fooled by other XML, PNG bytes, or prose", () => {
    expect(isSvg(Buffer.from(`<?xml version="1.0"?><doc><svg/></doc>`))).toBe(false);
    expect(isSvg(PNG_BYTES)).toBe(false);
    expect(isSvg(Buffer.from("insérer telle quelle <svg"))).toBe(false);
  });
});

describe("rasterizeSvg", () => {
  it("produces a PNG with the longer side at the print size", () => {
    const png = rasterizeSvg(SQUARE_SVG);
    expect(isPng(png)).toBe(true);
    expect(pngSize(png)).toEqual({ width: RASTER_LONG_SIDE_PX, height: RASTER_LONG_SIDE_PX });
  });

  it("scales by the LONGER side, so a tall picture is not blown up by its width", () => {
    const png = rasterizeSvg(TALL_SVG);
    expect(pngSize(png)).toEqual({ width: RASTER_LONG_SIDE_PX / 4, height: RASTER_LONG_SIDE_PX });
  });

  it("refuses an SVG that sets text with a font, naming the fix", () => {
    expect(() => rasterizeSvg(TEXT_SVG)).toThrow(/no fonts.*outlines/);
  });

  it("refuses an SVG it cannot parse rather than emitting a blank picture", () => {
    expect(() => rasterizeSvg(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><rect"))).toThrow();
  });
});

describe("rasterizeSvgMedia — a document's media, converted where needed", () => {
  it("converts the SVG entries, passes raster entries through, and lists what it did", () => {
    const out = rasterizeSvgMedia([
      { name: "picto-je-fais.svg", data: SQUARE_SVG },
      { name: "band.png", data: PNG_BYTES },
    ]);
    expect(out.refused).toEqual([]);
    expect(out.rasterized).toEqual(["picto-je-fais.svg"]);
    expect(out.media.map((m) => m.name)).toEqual(["picto-je-fais.svg", "band.png"]);
    expect(isPng(out.media[0].data)).toBe(true);
    expect(out.media[1].data).toBe(PNG_BYTES);
  });

  it("names the entry it could not convert instead of dropping it", () => {
    const out = rasterizeSvgMedia([{ name: "signe-x.svg", data: TEXT_SVG }]);
    expect(out.media).toEqual([]);
    expect(out.refused).toEqual([{ name: "signe-x.svg", reason: expect.stringContaining("no fonts") }]);
  });
});

describe("mediaPartName — the part follows the bytes", () => {
  it("stores a rasterized .svg under a .png part, and leaves everything else alone", () => {
    expect(mediaPartName("picto.svg", rasterizeSvg(SQUARE_SVG))).toBe("picto.png");
    expect(mediaPartName("picto.SVG", PNG_BYTES)).toBe("picto.png");
    expect(mediaPartName("picto.svg", SQUARE_SVG)).toBe("picto.svg");
    expect(mediaPartName("band.png", PNG_BYTES)).toBe("band.png");
  });
});
