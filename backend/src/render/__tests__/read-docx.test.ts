/*
 * The round trip: a node id goes into a document, and comes back out.
 *
 * This is the whole basis for reading corrections in. Sheets from the old
 * pipeline carried nothing tying a line to a node, so matching one up again
 * meant guessing from position and wording — which is why the roadmap treated
 * reading corrections back as infeasible. It WAS infeasible for documents we
 * did not produce. These we produce.
 *
 * So what is under test is not "can we parse a .docx" but: after rendering,
 * does every line still say which node it came from, and does the file still
 * look the same to a reader?
 */
import { describe, it, expect } from "vitest";
import { renderSpecSchema } from "../../kg-recipes/index.js";
import { documentSchema } from "../document.js";
import { renderDocx } from "../docx.js";
import { readDocx } from "../read-docx.js";
import { unzip } from "../zip.js";

const SPEC = renderSpecSchema.parse({
  page: { size: "A4", marginsCm: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 } },
  type: { family: "Andika", sizePt: 12, leadingPt: 15.5, leadingRule: "exact" },
  blocks: { sessionBanner: { fill: "09A9E1", textColour: "FFFFFF", bold: true }, bullet: { marker: "•" } },
  pagination: { pageBreakCarrier: "banner-property" },
});

const LESSON = "d796c4ee-a3db-493c-b6ac-ee5697ddcf95";
const STEP_A = "3abd527f-96f1-4b02-9599-c1c03940e522";
const STEP_B = "ffde43c5-fd12-436a-9f52-9cce80ef2331";

const TREE = documentSchema.parse({
  blocks: [
    // A banner announces rather than quotes: it belongs to no node.
    { kind: "table", rows: [[{ style: "sessionBanner", blocks: [
      { kind: "line", runs: [{ text: "Séance 1 | 30 min" }] },
    ] }]] },
    { kind: "line", anchor: STEP_A, style: "bullet", runs: [{ text: "E. pose des cailloux." }] },
    { kind: "line", anchor: STEP_B, style: "bullet", runs: [{ text: "Nommez ces objets." }] },
    { kind: "spacer", sizePt: 1, leadingPt: 2 },
    // A whole table can carry one, when the node IS the table.
    { kind: "table", anchor: LESSON, rows: [[{ blocks: [
      { kind: "line", runs: [{ text: "Un ensemble est un groupe." }] },
    ] }]] },
  ],
});

const render = () => renderDocx({ blocks: TREE.blocks, media: [] }, SPEC);

describe("a node id survives the trip into a document and back", () => {
  it("brings every anchored line back with its node", () => {
    const read = readDocx(render());
    const byAnchor = new Map(read.blocks.filter((b) => b.anchor).map((b) => [b.anchor, b.text]));
    expect(byAnchor.get(STEP_A)).toBe("• E. pose des cailloux.");
    expect(byAnchor.get(STEP_B)).toBe("• Nommez ces objets.");
    expect(byAnchor.get(LESSON)).toBe("Un ensemble est un groupe.");
  });

  it("leaves a block that belongs to no node unanchored, rather than guessing one", () => {
    const read = readDocx(render());
    const banner = read.blocks.find((b) => b.text.includes("Séance 1"));
    expect(banner).toBeDefined();
    expect(banner!.anchor).toBeNull();
  });

  it("carries the anchor down into a table's own lines", () => {
    // The control wraps the table; the line inside it inherits the node, so a
    // correction made in a cell is still traceable.
    const read = readDocx(render());
    const inside = read.blocks.find((b) => b.text.startsWith("Un ensemble"));
    expect(inside!.anchor).toBe(LESSON);
  });

  it("lists the anchors it saw, which is what makes a DELETION visible", () => {
    const read = readDocx(render());
    expect(read.anchors.sort()).toEqual([STEP_A, STEP_B, LESSON].sort());
  });

  it("keeps the document readable — the anchor renders nothing", () => {
    const doc = unzip(render()).get("word/document.xml")!.toString("utf8");
    // Present as markup...
    expect(doc).toContain(`<w:tag w:val="${STEP_A}"/>`);
    // ...and absent from the words on the page.
    const words = [...doc.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(" ");
    expect(words).not.toContain(STEP_A);
    expect(words).toContain("Nommez ces objets.");
  });

  it("does not disturb what the page looks like", () => {
    // Wrapping a block in a content control must not change its geometry, or
    // the anchor would be paid for in layout.
    const bare = documentSchema.parse({
      blocks: TREE.blocks.map((b) => (b.kind === "spacer" ? b : { ...b, anchor: undefined })),
    });
    const withAnchors = unzip(render()).get("word/document.xml")!.toString("utf8");
    const without = unzip(renderDocx({ blocks: bare.blocks, media: [] }, SPEC))
      .get("word/document.xml")!.toString("utf8");
    const strip = (xml: string) => xml.replace(/<w:sdt>.*?<w:sdtContent>/g, "").replace(/<\/w:sdtContent><\/w:sdt>/g, "");
    expect(strip(withAnchors)).toBe(without);
  });
});

describe("reading a document that carries no anchors at all", () => {
  it("still returns the text, with every block unanchored", () => {
    // An old sheet, or one an expert built from scratch. It reads — you just
    // cannot say which node a line belongs to, which is the honest answer.
    const bare = documentSchema.parse({
      blocks: [{ kind: "line", runs: [{ text: "Une ligne sans ancre." }] }],
    });
    const read = readDocx(renderDocx({ blocks: bare.blocks, media: [] }, SPEC));
    expect(read.blocks).toHaveLength(1);
    expect(read.blocks[0].anchor).toBeNull();
    expect(read.anchors).toEqual([]);
  });
});
