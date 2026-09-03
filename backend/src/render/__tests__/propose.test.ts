/*
 * Reading a correction back into proposals.
 *
 * The care here is all about what is NOT proposed. An expert's corrected sheet
 * is a document, not a patch: it contains the changes, the untouched text, the
 * things they cut, and sometimes new material with nowhere obvious to go. Only
 * the first of those is unambiguous, and this must say so rather than treating
 * a deletion and a rewrite alike.
 */
import { describe, it, expect } from "vitest";
import { proposeEdits, editItems, documentText } from "../propose.js";
import type { ReadDocument } from "../read-docx.js";

const doc = (blocks: { anchor: string | null; text: string }[]): ReadDocument => ({
  blocks: blocks.map((b, i) => ({ ...b, position: i, kind: "line" as const })),
  anchors: [...new Set(blocks.map((b) => b.anchor).filter((a): a is string => a !== null))],
});

const GRAPH = new Map([
  ["n1", "E. pose des cailloux."],
  ["n2", "Nommez ces objets."],
  ["n3", "Pourquoi as-tu mis ces objets ensemble ?"],
]);

describe("what it proposes", () => {
  it("proposes an edit where the anchor is the same and the words differ", () => {
    const proposals = proposeEdits(
      doc([{ anchor: "n1", text: "E. pose des cailloux ET DES BÂTONNETS." },
           { anchor: "n2", text: "Nommez ces objets." },
           { anchor: "n3", text: "Pourquoi as-tu mis ces objets ensemble ?" }]),
      GRAPH,
    );
    expect(proposals).toEqual([
      { kind: "edit", nodeId: "n1", before: "E. pose des cailloux.", after: "E. pose des cailloux ET DES BÂTONNETS." },
    ]);
  });

  it("says nothing about lines nobody touched", () => {
    const unchanged = doc([...GRAPH].map(([anchor, text]) => ({ anchor, text })));
    expect(proposeEdits(unchanged, GRAPH)).toEqual([]);
  });

  it("hands back the edits in the shape edit_nodes takes", () => {
    const proposals = proposeEdits(
      doc([{ anchor: "n2", text: "Nommez ces objets, s'il vous plaît." }]),
      new Map([["n2", "Nommez ces objets."]]),
    );
    expect(editItems(proposals)).toEqual([{ nodeId: "n2", content: "Nommez ces objets, s'il vous plaît." }]);
  });
});

describe("what it refuses to decide", () => {
  it("reports a vanished line as MISSING, never as a delete", () => {
    // A cut and a slip look identical in a Word file. Proposing a delete would
    // turn a mis-click into a lost line of curriculum.
    const proposals = proposeEdits(
      doc([{ anchor: "n1", text: "E. pose des cailloux." }, { anchor: "n2", text: "Nommez ces objets." }]),
      GRAPH,
    );
    expect(proposals).toEqual([{ kind: "missing", nodeId: "n3", before: GRAPH.get("n3") }]);
    expect(editItems(proposals)).toEqual([]);
  });

  it("reports new text as UNPLACED rather than filing it by position", () => {
    // Guessing a parent from where a sentence sits is how it ends up under the
    // wrong lesson.
    const proposals = proposeEdits(
      doc([...[...GRAPH].map(([anchor, text]) => ({ anchor, text })),
           { anchor: null, text: "Une phrase toute neuve." }]),
      GRAPH,
    );
    expect(proposals).toEqual([{ kind: "unplaced", text: "Une phrase toute neuve.", position: 3 }]);
  });

  it("ignores an anchor naming something outside the scope it was given", () => {
    // The document may quote a node this caller never asked about. Editing it
    // would reach past the scope.
    const proposals = proposeEdits(
      doc([{ anchor: "n2", text: "Nommez ces objets." }, { anchor: "elsewhere", text: "Autre chose." }]),
      new Map([["n2", "Nommez ces objets."]]),
    );
    expect(proposals).toEqual([]);
  });
});

describe("what counts as a difference", () => {
  it("ignores the bullet the formatter added", () => {
    // The graph never held it; reporting it would make every line an edit.
    const proposals = proposeEdits(
      doc([{ anchor: "n2", text: "• Nommez ces objets." }]),
      new Map([["n2", "Nommez ces objets."]]),
      { markers: ["•"] },
    );
    expect(proposals).toEqual([]);
  });

  it("ignores whitespace Word normalised on save", () => {
    const proposals = proposeEdits(
      doc([{ anchor: "n2", text: "Nommez   ces objets." }]),
      new Map([["n2", "Nommez ces objets."]]),
    );
    expect(proposals).toEqual([]);
  });

  it("ignores a non-breaking space, which French typing inserts by itself", () => {
    const proposals = proposeEdits(
      doc([{ anchor: "n2", text: "Nommez ces objets ?" }]),
      new Map([["n2", "Nommez ces objets ?"]]),
    );
    expect(proposals).toEqual([]);
  });

  it("does NOT ignore a change of wording, however small", () => {
    const proposals = proposeEdits(
      doc([{ anchor: "n2", text: "Nomme ces objets." }]),
      new Map([["n2", "Nommez ces objets."]]),
    );
    expect(proposals).toHaveLength(1);
  });

  it("joins the blocks of a node that spans several", () => {
    // A table's lines all carry its anchor; the node's version is their sum.
    const proposals = proposeEdits(
      doc([{ anchor: "n1", text: "Un ensemble est un groupe." },
           { anchor: "n1", text: "On le trace par une boucle." }]),
      new Map([["n1", "Un ensemble est un groupe. On le trace par une boucle."]]),
    );
    expect(proposals).toEqual([]);
  });
});

/*
 * Which field a correction writes back to.
 *
 * The bug this covers was silent, not loud: the caller read `content` for every
 * node, and on the live graph almost nothing keeps its text there. A corrected
 * banner matched nothing and was dropped without a word.
 */
describe("writing the correction back to the right field", () => {
  const corrected = doc([{ anchor: "n1", text: "PHASE 1 — RAPPEL | 5 min" }]);
  const proposals = proposeEdits(corrected, new Map([["n1", "PHASE 1 — RÉVISION | 4 min"]]));

  it("writes `content` when that is where the node keeps its text", () => {
    expect(editItems(proposals, new Map([["n1", { field: "content" as const }]])))
      .toEqual([{ nodeId: "n1", content: "PHASE 1 — RAPPEL | 5 min" }]);
  });

  it("writes `title` for a node whose text lives in its description", () => {
    expect(editItems(proposals, new Map([["n1", { field: "title" as const }]])))
      .toEqual([{ nodeId: "n1", title: "PHASE 1 — RAPPEL | 5 min" }]);
  });

  it("writes `body` when the corrected text is the part below the name line", () => {
    // The name line is NOT resent: `body` edits only what sits under it, so a
    // correction to a routine step's script cannot rename the step.
    expect(editItems(proposals, new Map([["n1", { field: "body" as const }]])))
      .toEqual([{ nodeId: "n1", body: "PHASE 1 — RAPPEL | 5 min" }]);
  });

  it("falls back to `content` for a node it was told nothing about", () => {
    expect(editItems(proposals)).toEqual([{ nodeId: "n1", content: "PHASE 1 — RAPPEL | 5 min" }]);
  });
});

describe("documentText", () => {
  it("joins the blocks that share an anchor, in order", () => {
    const read = doc([
      { anchor: "n1", text: "Première ligne." },
      { anchor: "n1", text: "Seconde ligne." },
      { anchor: null, text: "Sans ancre." },
    ]);
    expect(documentText(read)).toEqual(new Map([["n1", "Première ligne. Seconde ligne."]]));
  });

  it("strips the marker the formatter added, like the comparison does", () => {
    expect(documentText(doc([{ anchor: "n1", text: "• Nommez ces objets." }]), ["•"]))
      .toEqual(new Map([["n1", "Nommez ces objets."]]));
  });
});
