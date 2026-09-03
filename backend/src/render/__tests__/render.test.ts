/*
 * The whole path, with no corpus: a block tree an authoring model could have
 * composed, a spec resolved from two formatters, and a .docx out.
 *
 * It exists because the two golden suites SKIP wherever the produced sheets are
 * absent, which is everywhere except one laptop — so without this, CI never
 * renders anything. Everything asserted here is checked against the real sheets
 * elsewhere; this is the version that runs in the places the sheets do not.
 */
import { describe, it, expect } from "vitest";
import { renderDocx } from "../docx.js";
import { resolveRenderSpec, type SpecCarrier } from "../resolve-spec.js";
import { documentSchema } from "../document.js";
import { unzip } from "../zip.js";

const formatter = (id: string, render: unknown): SpecCarrier =>
  ({ id, properties: { raw: { render } as Record<string, unknown> } });

const DOC_WIDE = formatter("doc", {
  page: { size: "A4", orientation: "portrait", marginsCm: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 } },
  type: { family: "Andika", sizePt: 12, leadingPt: 15.5, leadingRule: "exact" },
  blocks: {
    sessionBanner: { fill: "09A9E1", textColour: "FFFFFF", bold: true },
    bullet: { marker: "•" },
    title: { sizePt: 16, bold: true },
  },
  images: { maxHeightCm: { band: 2, sign: 0.5 }, placement: "float-right", paragraphLeadingRule: "auto" },
  pagination: { pageBreakCarrier: "banner-property" },
  language: { strategy: "per-file", variants: [
    { id: "commun", lang: "fr", colour: "000000", inAllFiles: true },
    { id: "fr", lang: "fr", colour: "C0504D", fileSuffix: "-FR" },
  ] },
});

const TREE = documentSchema.parse({
  blocks: [
    { kind: "line", style: "title", runs: [{ text: "Leçon 1" }] },
    { kind: "table", rows: [[{ style: "sessionBanner", blocks: [
      { kind: "line", runs: [{ text: "Séance 1 | 30 min" }] },
    ] }]] },
    { kind: "line", style: "bullet", variant: "fr", runs: [{ text: "Nommez ces objets." }] },
    { kind: "line", style: "bullet", runs: [
      { image: { media: "band.png", role: "band", aspectRatio: 6, float: true } },
      { text: "E. montre la bande." },
    ] },
    { kind: "spacer", sizePt: 1, leadingPt: 2 },
    { kind: "table", pageBreak: "before", rows: [[{ style: "sessionBanner", blocks: [
      { kind: "line", runs: [{ text: "Séance 2 | 30 min" }] },
    ] }]] },
  ],
});

const MEDIA = [{ name: "band.png", data: Buffer.from("not a real png, but a real zip entry") }];

function render() {
  const resolved = resolveRenderSpec([DOC_WIDE]);
  if (!resolved.ok) throw new Error(resolved.errors.join("; "));
  return renderDocx({ blocks: TREE.blocks, media: MEDIA }, resolved.spec);
}

describe("a block tree and a formatter make a .docx", () => {
  const parts = unzip(render());
  const doc = parts.get("word/document.xml")!.toString("utf8");

  it("writes a package with every part Word requires", () => {
    for (const required of ["[Content_Types].xml", "_rels/.rels", "word/document.xml",
                            "word/_rels/document.xml.rels", "word/styles.xml", "word/media/band.png"]) {
      expect(parts.has(required)).toBe(true);
    }
  });

  it("takes the page from the formatter, never from a library default", () => {
    // Not setting a page size is how a full production run came out Letter —
    // 1.8 cm short per page — so the size is written explicitly, always.
    expect(doc).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(doc).toContain('w:top="1417"');
  });

  it("sets the leading AND its rule", () => {
    expect(doc).toContain('<w:spacing w:line="310" w:lineRule="exact"/>');
  });

  it("leaves the leading alone for a FLOATED picture, which has no line to crop", () => {
    // The crop only threatens an inline picture taller than the line box. This
    // band is 2 cm against a 0.55 cm line and floats, so its paragraph keeps
    // the body rule — relaxing it here would grow the line for nothing.
    const withBand = [...doc.matchAll(/<w:p>[\s\S]*?<\/w:p>/g)]
      .map((m) => m[0]).filter((p) => p.includes("<wp:"));
    expect(withBand).toHaveLength(1);
    expect(withBand[0]).toContain('w:lineRule="exact"');
  });

  it("relaxes it for an INLINE picture that would be cropped", () => {
    const inline = structuredClone(TREE.blocks);
    const line = inline[3];
    if (line.kind === "line" && "image" in line.runs[0]) line.runs[0].image.float = false;
    const resolved = resolveRenderSpec([DOC_WIDE]);
    if (!resolved.ok) throw new Error(resolved.errors.join("; "));
    const other = unzip(renderDocx({ blocks: inline, media: MEDIA }, resolved.spec))
      .get("word/document.xml")!.toString("utf8");
    const withBand = [...other.matchAll(/<w:p>[\s\S]*?<\/w:p>/g)]
      .map((m) => m[0]).filter((p) => p.includes("<wp:"));
    expect(withBand).toHaveLength(1);
    expect(withBand[0]).not.toContain('w:lineRule="exact"');
  });

  it("colours a line by the variant the formatter declares", () => {
    expect(doc).toContain('<w:color w:val="C0504D"/>');   // the French line
    expect(doc).toContain('<w:color w:val="FFFFFF"/>');   // banner text
  });

  it("gives a cell its style's fill, and the line inside it that style's text", () => {
    expect(doc).toContain('w:fill="09A9E1"');
    // The banner's own line declares no style; it inherits the cell's.
    expect(doc).toMatch(/w:fill="09A9E1"[\s\S]{0,400}<w:b\/><w:color w:val="FFFFFF"\/>/);
  });

  it("applies a block's declared type size", () => {
    expect(doc).toContain('<w:sz w:val="32"/>');   // title, 16 pt
  });

  it("adds the bullet marker the formatter names, and only to bulleted lines", () => {
    expect((doc.match(/<w:t xml:space="preserve">• <\/w:t>/g) ?? [])).toHaveLength(2);
  });

  it("carries the page break the way the formatter says", () => {
    expect(doc).toContain("<w:pageBreakBefore/>");
    expect(doc).not.toContain('w:type="page"');
  });

  it("writes the same break as a paragraph when the formatter says so", () => {
    // Same tree, one changed value: the model still only says WHERE.
    const resolved = resolveRenderSpec([DOC_WIDE, formatter("s", { pagination: { pageBreakCarrier: "paragraph" } })]);
    if (!resolved.ok) throw new Error(resolved.errors.join("; "));
    const other = unzip(renderDocx({ blocks: TREE.blocks, media: MEDIA }, resolved.spec))
      .get("word/document.xml")!.toString("utf8");
    expect(other).toContain('<w:br w:type="page"/>');
    expect(other).not.toContain("<w:pageBreakBefore/>");
  });

  it("sizes a picture from its ROLE, and floats it where the formatter says", () => {
    // 2 cm tall by its role, 12 cm wide from its 6:1 shape, and pushed against
    // the right margin by a computed offset — 16 cm usable less 12 cm wide.
    expect(doc).toContain('<wp:extent cx="4320000" cy="720000"/>');
    expect(doc).toContain("<wp:posOffset>1440000</wp:posOffset>");
    expect(doc).toContain('<wp:wrapSquare wrapText="left"/>');
  });
});
