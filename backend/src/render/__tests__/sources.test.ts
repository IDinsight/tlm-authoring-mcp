/*
 * Telling a produced document it is out of date.
 *
 * Two things are being defended, and the second is the one that would actually
 * hurt if it broke:
 *
 *   1. Staleness is PER DOCUMENT. A graph version stamped on everything would
 *      mark all eighty files on any edit, and a flag that is always on is a
 *      flag nobody reads.
 *   2. NOT KNOWING IS NOT THE SAME AS BEING CURRENT. Every document produced
 *      before sources were recorded has none, and reporting those as up to date
 *      is the most misleading thing this could do.
 */
import { describe, it, expect } from "vitest";
import { hashContent, sourcesFrom, staleness } from "../sources.js";

const GRAPH = new Map([
  ["n1", "E. pose des cailloux."],
  ["n2", "Nommez ces objets."],
  ["n3", "Pourquoi ensemble ?"],
]);

const snapshot = sourcesFrom(["n1", "n2"], GRAPH);

describe("what a document records about where it came from", () => {
  it("snapshots only the nodes it actually drew from", () => {
    // Not the whole graph: that is what makes one lesson's edit flag one
    // lesson's files.
    expect(snapshot.map((s) => s.nodeId)).toEqual(["n1", "n2"]);
  });

  it("skips an anchor the graph does not hold, rather than recording a blank", () => {
    expect(sourcesFrom(["n1", "nowhere"], GRAPH).map((s) => s.nodeId)).toEqual(["n1"]);
  });

  it("hashes the words, so reflowed whitespace is not a change", () => {
    // A re-import that rewraps a paragraph would otherwise flag every document
    // quoting it, and a flag that cries wolf gets ignored when it matters.
    expect(hashContent("Nommez   ces\nobjets.")).toBe(hashContent("Nommez ces objets."));
    expect(hashContent("Nomme ces objets.")).not.toBe(hashContent("Nommez ces objets."));
  });
});

describe("what it says later", () => {
  it("says CURRENT when nothing it quotes has moved", () => {
    expect(staleness(snapshot, GRAPH)).toEqual({ state: "current", checked: 2 });
  });

  it("names the node that changed, not just that something did", () => {
    const moved = new Map(GRAPH).set("n2", "Nommez donc ces objets.");
    expect(staleness(snapshot, moved)).toEqual({ state: "stale", changed: ["n2"], removed: [], checked: 2 });
  });

  it("keeps a REMOVED node apart from a changed one", () => {
    // They need different answers: reworded text can be regenerated, a vanished
    // node needs a person to decide what the document should say instead.
    const gone = new Map(GRAPH); gone.delete("n1");
    expect(staleness(snapshot, gone)).toEqual({ state: "stale", changed: [], removed: ["n1"], checked: 2 });
  });

  it("is NOT disturbed by an edit to a node it never quoted", () => {
    // The whole point of per-document tracking.
    const elsewhere = new Map(GRAPH).set("n3", "Tout autre chose.");
    expect(staleness(snapshot, elsewhere)).toEqual({ state: "current", checked: 2 });
  });
});

describe("the rule that matters most", () => {
  it("says UNKNOWN, never current, when a document records no sources", () => {
    for (const sources of [undefined, []]) {
      const result = staleness(sources, GRAPH);
      expect(result.state).toBe("unknown");
      if (result.state !== "unknown") return;
      expect(result.reason).toContain("cannot be established");
    }
  });

  it("explains what would make the question answerable", () => {
    const result = staleness(undefined, GRAPH);
    if (result.state !== "unknown") throw new Error("expected unknown");
    expect(result.reason).toContain("Regenerating");
  });
});
