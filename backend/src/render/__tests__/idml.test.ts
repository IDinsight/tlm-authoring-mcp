/*
 * The InDesign renderer, against an INVENTED template.
 *
 * Nothing here is any subject's vocabulary — no lesson, no domain colour, no pictogram name —
 * so the renderer stays generic: it knows named frames, style names and groups, never a page
 * of the pupil book. The template is a few hand-written XML parts, the smallest an .idml can be
 * and still carry what the renderer reads.
 */
import { describe, it, expect } from "vitest";
import { readIdmlTemplate, renderIdml, packageIdml, IdmlRefusal } from "../idml.js";
import { unzip, zip } from "../zip.js";
import { inventedTemplate, png } from "../../__tests__/index.js";
import type { DocumentTree } from "../document.js";
import type { RenderSpec } from "../../kg-recipes/index.js";

const SPEC: RenderSpec = { images: { maxHeightCm: { photo: 2 }, inlineHeightCm: { icon: 1 } } };
const tree = (blocks: DocumentTree["blocks"], media: DocumentTree["media"] = []): DocumentTree => ({ blocks, media });

function render(t: DocumentTree, options: Partial<Parameters<typeof renderIdml>[2]> = {}) {
  const output = renderIdml(t, readIdmlTemplate(inventedTemplate()), { spec: SPEC, ...options });
  const parts = unzip(output.idml);
  const part = (name: string) => parts.get(name)?.toString("utf8") ?? "";
  return { output, parts, part, label: part("Stories/Story_s-label.xml"), body: part("Stories/Story_s-body.xml") };
}

describe("readIdmlTemplate", () => {
  it("finds the model page by its `corps` frame, and each named frame's story and width", () => {
    const template = readIdmlTemplate(inventedTemplate());
    expect(template.modelSpreadPath).toBe("Spreads/Spread_model.xml");
    expect(template.pageId).toBe("p-model");
    expect(template.frames.get("corps")).toEqual({ storyId: "s-body", widthPt: 400 });
    expect(template.frames.get("label")?.storyId).toBe("s-label");
    expect(template.masterStoryIds).toEqual(new Set(["s-master"]));
  });

  it("refuses a template with no model page, saying what is missing", () => {
    const parts = unzip(inventedTemplate());
    parts.set("Spreads/Spread_model.xml", Buffer.from(`<Spread><Page Self="p-model"/></Spread>`));
    const broken = zip([...parts].map(([name, data]) => ({ name, data, store: name === "mimetype" })));
    expect(() => readIdmlTemplate(broken)).toThrow(/no frame is named « corps »/);
  });
});

describe("renderIdml — frames, styles, assembly", () => {
  it("sends a line styled like a frame's name to that frame, and everything else into corps", () => {
    const { label, body } = render(tree([
      { kind: "line", style: "label", runs: [{ text: "Unit 3" }] },
      { kind: "line", style: "body", runs: [{ text: "First line" }] },
      { kind: "line", style: "body", runs: [{ text: "Second line" }] },
    ]));
    expect(label).toContain("<Content>Unit 3</Content>");
    expect(label).not.toContain("PLACEHOLDER");
    expect(body).toContain("<Content>First line</Content>");
    expect(body).toContain("<Content>Second line</Content>");
    expect(body).not.toContain("Unit 3");
    // Two paragraphs: one break between them, none after the last.
    expect(body.match(/<Br\/>/g)).toHaveLength(1);
  });

  it("keeps only the model page, the filled stories and the masters' stories, and says so in the designmap", () => {
    const { parts, part } = render(tree([{ kind: "line", style: "body", runs: [{ text: "x" }] }]));
    expect(parts.has("Spreads/Spread_sample.xml")).toBe(false);
    expect(parts.has("Stories/Story_s-sample.xml")).toBe(false);
    expect(parts.has("Stories/Story_s-master.xml")).toBe(true);
    const designmap = part("designmap.xml");
    expect(designmap).not.toContain("Spread_sample");
    expect(designmap).not.toContain("Story_s-sample");
    expect(designmap).toMatch(/<Section [^>]*Length="1"[^>]*PageStart="p-model"[^>]*AlternateLayoutLength="1"/);
  });

  it("writes `mimetype` first and uncompressed, as InDesign requires", () => {
    const { output } = render(tree([]));
    expect(output.idml.readUInt16LE(8)).toBe(0); // method of the first entry: stored
    expect(output.idml.subarray(30, 38).toString("ascii")).toBe("mimetype");
  });

  it("looks a style up in the page's group first, then at the top level", () => {
    const grouped = render(tree([{ kind: "line", style: "heading", runs: [{ text: "x" }] }]), { styleGroup: "G1" }).body;
    expect(grouped).toContain(`AppliedParagraphStyle="ParagraphStyle/G1%3aheading"`);
    const topLevel = render(tree([{ kind: "line", style: "heading", runs: [{ text: "x" }] }]), { styleGroup: "G2" }).body;
    expect(topLevel).toContain(`AppliedParagraphStyle="ParagraphStyle/heading"`);
  });

  it("refuses a page whose styles the template does not define, naming every one", () => {
    const attempt = () => render(tree([
      { kind: "line", style: "shout", runs: [{ text: "x" }] },
      { kind: "table", style: "boxed", rows: [[{ blocks: [] }]] },
    ]));
    expect(attempt).toThrow(IdmlRefusal);
    try { attempt(); } catch (error) {
      expect((error as IdmlRefusal).problems.join(" ")).toMatch(/ParagraphStyle named « shout »/);
      expect((error as IdmlRefusal).problems.join(" ")).toMatch(/TableStyle named « boxed »/);
    }
  });

  it("starts a paragraph on the next page for a block that breaks before itself", () => {
    const { body } = render(tree([{ kind: "line", style: "body", pageBreak: "before", runs: [{ text: "x" }] }]));
    expect(body).toContain(`StartParagraph="NextPage"`);
  });

  it("gives French its no-break spaces, and leaves other languages alone", () => {
    const line = tree([{ kind: "line", style: "body", runs: [{ text: "« Quoi ? » Voilà : fini" }] }]);
    expect(render(line, { lang: "fr" }).body).toContain("« Quoi ? » Voilà : fini");
    expect(render(line, { lang: "wo" }).body).toContain("« Quoi ? » Voilà : fini");
  });
});

describe("renderIdml — pictures", () => {
  it("links a picture from Links/, relative to the file, sized by its role and capped by the room it has", () => {
    // A 10:1 band at the role's 2 cm height would be 20 cm wide; the 400 pt frame holds 14.1 cm.
    const { output, body } = render(tree(
      [{ kind: "line", runs: [{ image: { media: "band one", role: "photo", aspectRatio: 10 } }] }],
      [{ name: "band one", data: png(1000, 100) }],
    ));
    expect(body).toContain(`LinkResourceURI="file:Links/band-one.png"`);
    expect(body).toContain(`<AnchoredObjectSetting AnchoredPosition="InlinePosition"`);
    expect(body).toMatch(/<PathPointType Anchor="400 40"/); // width capped at 400 pt, shape kept
    expect(output.links).toEqual([{ fileName: "band-one.png", data: expect.any(Buffer) }]);
  });

  it("lets a picture whose style anchors it ride the next line, with no inline setting of its own", () => {
    const { body } = render(tree(
      [
        { kind: "line", runs: [{ image: { media: "mark", role: "icon", aspectRatio: 1 } }] },
        { kind: "line", style: "body", runs: [{ text: "Beside the mark" }] },
      ],
      [{ name: "mark", data: png(100, 100) }],
    ));
    // One paragraph, not two: the icon sits in the text's paragraph.
    expect(body.match(/<ParagraphStyleRange/g)).toHaveLength(1);
    expect(body.indexOf("ObjectStyle/icon")).toBeLessThan(body.indexOf("Beside the mark"));
    expect(body).not.toContain("InlinePosition");
  });

  it("refuses a picture the media list does not hold", () => {
    expect(() => render(tree([{ kind: "line", runs: [{ image: { media: "ghost", role: "photo", aspectRatio: 1 } }] }]))).toThrow(/« ghost »/);
  });
});

describe("renderIdml — tables", () => {
  it("writes column widths from the tree, and lets a cell name its own style over the table's", () => {
    const { body } = render(tree([{
      kind: "table",
      style: "grid",
      columnsCm: [5, 10],
      rows: [[
        { style: "alert", blocks: [{ kind: "line", style: "body", runs: [{ text: "Left" }] }] },
        { blocks: [{ kind: "line", style: "body", runs: [{ text: "Right" }] }] },
      ]],
    }]), { styleGroup: "G1" });
    expect(body).toContain(`AppliedTableStyle="TableStyle/grid"`);
    expect(body).toMatch(/SingleColumnWidth="141\.7/);
    expect(body).toMatch(/Name="0:0"[^>]*AppliedCellStyle="CellStyle\/G1%3aalert"/);
    expect(body).toMatch(/Name="1:0"[^>]*AppliedCellStyle="CellStyle\/grid"/);
  });
});

describe("packageIdml", () => {
  it("puts the .idml, its pictures in Links/ and the fonts in « Document fonts » side by side", () => {
    const { output } = render(tree(
      [{ kind: "line", runs: [{ image: { media: "p", role: "photo", aspectRatio: 1 } }] }],
      [{ name: "p", data: png(10, 10) }],
    ));
    const names = [...unzip(packageIdml("page.idml", output, [{ fileName: "Face.ttf", data: Buffer.from("font") }])).keys()];
    expect(names).toEqual(["page.idml", "Links/p.png", "Document fonts/Face.ttf"]);
  });
});
