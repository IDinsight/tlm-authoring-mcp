/*
 * What changed, between a corrected document and the graph it came from.
 *
 * An expert opens a sheet, fixes a sentence, sends it back. This works out what
 * that means for the graph — and stops there. It PROPOSES; it never writes.
 * Every proposal goes through the same two-phase edit any other change does, so
 * a person sees the diff and confirms it. A tool that read a Word file and
 * silently rewrote the curriculum would be the most dangerous thing here.
 *
 * Three outcomes, and the difference between them is the point:
 *
 *   • EDIT — the anchor is there and the words differ. Unambiguous: apply it.
 *   • MISSING — the graph has the node, the document no longer has it. Might be
 *     a deliberate cut, might be a slip while editing. NOT proposed as a delete;
 *     reported, for a person to read.
 *   • UNPLACED — text in the document belonging to no node. New material, and
 *     nothing here can say where it goes; guessing a parent from position is
 *     how you file a sentence under the wrong lesson.
 *
 * Comparison is on the WORDS. A rendered line carries furniture the graph never
 * held — the bullet the formatter adds, the whitespace Word normalises — and
 * reporting those as edits would bury the real ones in noise.
 */
import type { ReadDocument } from "./read-docx.js";

export type Proposal =
  | { kind: "edit"; nodeId: string; before: string; after: string }
  | { kind: "missing"; nodeId: string; before: string }
  | { kind: "unplaced"; text: string; position: number };

/** Strip the furniture a renderer added, so a comparison is about the words. */
function words(text: string, markers: readonly string[]): string {
  let out = text.trim();
  for (const marker of markers) {
    if (marker && out.startsWith(marker)) {
      out = out.slice(marker.length).trimStart();
      break;
    }
  }
  // Word normalises spacing on save, and the difference is not an edit.
  return out.replace(/\s+/g, " ").replace(/ /g, " ").trim();
}

export type ProposeOptions = {
  /** Line markers the formatter adds — "•", "-". Stripped before comparing. */
  markers?: readonly string[];
};

/**
 * Compare a read-back document against what the graph currently says.
 *
 * `current` maps node id to the text the graph holds. A node in the document
 * but not in `current` is skipped rather than proposed: the anchor names
 * something this caller did not ask about, and inventing an edit for it would
 * reach outside the scope it was given.
 */
export function proposeEdits(
  read: ReadDocument, current: Map<string, string>, options: ProposeOptions = {},
): Proposal[] {
  const markers = options.markers ?? [];
  const proposals: Proposal[] = [];

  // A node can span several blocks — a table's lines all carry its anchor — so
  // the document's version of a node is its blocks joined, in order.
  const inDocument = new Map<string, string[]>();
  for (const block of read.blocks) {
    if (!block.anchor) continue;
    (inDocument.get(block.anchor) ?? inDocument.set(block.anchor, []).get(block.anchor)!)
      .push(words(block.text, markers));
  }

  for (const [nodeId, parts] of inDocument) {
    const before = current.get(nodeId);
    if (before === undefined) continue;   // not in the scope this caller asked about
    const after = parts.join(" ").trim();
    if (words(before, markers) !== after) {
      proposals.push({ kind: "edit", nodeId, before, after });
    }
  }

  for (const [nodeId, before] of current) {
    if (!inDocument.has(nodeId)) {
      proposals.push({ kind: "missing", nodeId, before });
    }
  }

  for (const block of read.blocks) {
    if (block.anchor) continue;
    proposals.push({ kind: "unplaced", text: block.text, position: block.position });
  }

  return proposals;
}

/** The proposals that can be applied directly, as `edit_nodes` items. */
export function editItems(proposals: Proposal[]): { nodeId: string; content: string }[] {
  return proposals
    .filter((p): p is Extract<Proposal, { kind: "edit" }> => p.kind === "edit")
    .map((p) => ({ nodeId: p.nodeId, content: p.after }));
}
