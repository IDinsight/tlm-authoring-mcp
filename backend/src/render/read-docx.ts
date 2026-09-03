/*
 * Reading a produced document back — the other direction.
 *
 * An expert opens a sheet in Word, fixes a sentence, and sends it back. That
 * correction has to reach the graph, and the hard part was never the .docx: it
 * was knowing WHICH node a given line belongs to. Sheets from the old pipeline
 * carried nothing to say, so matching meant guessing from position and wording,
 * and reading corrections in was written off.
 *
 * It is not a guess any more. The renderer writes each block's node id into the
 * file as a Word content control, so this reader recovers the pairing exactly.
 * What it CANNOT recover it leaves out rather than inventing:
 *
 *   • a block with no anchor was invented for layout, or was added by hand;
 *   • an anchor with no block means the expert deleted it, and that is a
 *     finding, not an absence.
 *
 * This reads OUR OWN output. Reverse-engineering a foreign document is a
 * different job with different assumptions (see __golden__/golden.ts).
 */
import { unzip } from "./zip.js";

/** One anchored piece of a document, as it now reads on the page. */
export type ReadBlock = {
  anchor: string | null;
  /** The text as it stands, runs joined, whitespace normalised. */
  text: string;
  /** Where it sits in the document, so an unanchored block can still be placed. */
  position: number;
  kind: "line" | "table";
};

export type ReadDocument = {
  blocks: ReadBlock[];
  /** Anchors seen, in document order — the basis for spotting a deletion. */
  anchors: string[];
};

const textOf = (xml: string) =>
  [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");

const normalise = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Immediate children of a container carrying one of the given tags.
 *
 * Depth-matched, because these nest: a content control wraps a table, a table
 * holds paragraphs, a cell can hold another table.
 */
function children(xml: string, tags: readonly string[]): { tag: string; xml: string }[] {
  const out: { tag: string; xml: string }[] = [];
  const opener = new RegExp(`<w:(${tags.join("|")})[ >]`, "g");
  let i = 0;
  for (;;) {
    opener.lastIndex = i;
    const open = opener.exec(xml);
    if (!open) break;
    const tag = open[1];
    const marker = new RegExp(`</?w:${tag}[ >]`, "g");
    marker.lastIndex = open.index;
    let depth = 0, end = -1;
    for (;;) {
      const next = marker.exec(xml);
      if (!next) break;
      depth += xml.startsWith("</", next.index) ? -1 : 1;
      if (depth === 0) { end = xml.indexOf(">", next.index) + 1; break; }
    }
    if (end < 0) break;
    out.push({ tag, xml: xml.slice(open.index, end) });
    i = end;
  }
  return out;
}

/** The node id a content control carries, if it carries one. */
function tagOf(sdt: string): string | null {
  return /<w:tag w:val="([^"]*)"/.exec(sdt)?.[1] ?? null;
}

/** Everything inside a content control, unwrapped. */
function contentOf(sdt: string): string {
  const open = sdt.indexOf("<w:sdtContent>");
  const close = sdt.lastIndexOf("</w:sdtContent>");
  return open < 0 || close < 0 ? sdt : sdt.slice(open + "<w:sdtContent>".length, close);
}

export function readDocx(bytes: Buffer): ReadDocument {
  const doc = unzip(bytes).get("word/document.xml")?.toString("utf8") ?? "";
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(doc)?.[1] ?? "";

  const blocks: ReadBlock[] = [];
  const walk = (xml: string, inherited: string | null): void => {
    for (const child of children(xml, ["sdt", "tbl", "p"])) {
      if (child.tag === "sdt") {
        // The anchor applies to whatever the control wraps, however deep.
        walk(contentOf(child.xml), tagOf(child.xml) ?? inherited);
        continue;
      }
      const text = normalise(textOf(child.xml));
      if (!text) continue;   // furniture: a spacer, an empty cell, a page break
      blocks.push({
        anchor: inherited,
        text,
        position: blocks.length,
        kind: child.tag === "tbl" ? "table" : "line",
      });
    }
  };
  walk(body, null);

  return {
    blocks,
    anchors: [...new Set(blocks.map((b) => b.anchor).filter((a): a is string => a !== null))],
  };
}
