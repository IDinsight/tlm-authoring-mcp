/*
 * A composed page kept between calls, and corrected by patch.
 *
 * The cost this exists to remove was measured: a 20–26 KB tree retyped four
 * or five times a sheet. What is under test is that a ref means the SAME tree
 * back, in its own namespace and nowhere else; that a patch lands where its
 * path says, in order; and that a patch producing an invalid page is refused
 * whole rather than half-applied.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryKgStore, __setKgStoreForTest } from "../../kg-store/index.js";
import { parkTree, readParkedTree, applyTreePatch, resolveTreeInput, MAX_PARKED_BYTES } from "../tree-park.js";

const NS = "senegal/ci/maths";
const line = (text: string) => ({ kind: "line", runs: [{ text }] });
const TREE = {
  blocks: [
    line("Titre"),
    { kind: "table", rows: [[{ blocks: [line("Dans la cellule")] }]] },
    line("Dernière"),
  ],
  media: [{ name: "a.png", nodeId: "n1" }],
};

beforeEach(() => { __setKgStoreForTest(createMemoryKgStore()); });

describe("keeping a tree", () => {
  it("hands back a ref that returns the same tree, in the namespace it was parked in", async () => {
    const parked = (await parkTree(NS, TREE))!;
    expect(parked.treeRef).toMatch(/^tree_[0-9a-f]{24}$/);
    expect(await readParkedTree(NS, parked.treeRef)).toEqual(TREE);
    // A ref is scoped: the same ref in another namespace is nothing. A tree
    // rendered into the wrong subject's formatter stack is the failure this
    // prevents, and the ref carries no namespace of its own to be fooled by.
    expect(await readParkedTree("senegal/ce1/reading", parked.treeRef)).toBeNull();
  });

  it("returns nothing for a ref it never issued", async () => {
    expect(await readParkedTree(NS, "tree_000000000000000000000000")).toBeNull();
    expect(await readParkedTree(NS, "not-a-ref")).toBeNull();
  });

  it("declines to keep a tree too large for the store, without failing", async () => {
    const huge = { blocks: [line("x".repeat(MAX_PARKED_BYTES + 1))] };
    expect(await parkTree(NS, huge)).toBeNull();
  });
});

describe("patching a tree", () => {
  const ok = (result: ReturnType<typeof applyTreePatch>) => {
    if ("error" in result) throw new Error(result.error);
    return result.tree as typeof TREE;
  };

  it("replaces, inserts and removes at a block path, in order", () => {
    const out = ok(applyTreePatch(TREE, [
      { op: "replace", path: "blocks[0]", block: line("Nouveau titre") },
      { op: "insert-after", path: "blocks[0]", block: { kind: "clear" } },
      // Indices see the tree as the previous ops left it: the last line is now blocks[3].
      { op: "remove", path: "blocks[3]" },
      { op: "insert-before", path: "blocks[3]", block: line("Ajoutée à la fin") },
    ]));
    expect(out.blocks.map((b: any) => b.kind === "line" ? b.runs[0].text : b.kind)).toEqual(["Nouveau titre", "clear", "table", "Ajoutée à la fin"]);
  });

  it("reaches a block inside a table cell", () => {
    const out = ok(applyTreePatch(TREE, [{ op: "replace", path: "blocks[1].rows[0][0].blocks[0]", block: line("Corrigée") }]));
    expect((out.blocks[1] as any).rows[0][0].blocks[0].runs[0].text).toBe("Corrigée");
  });

  it("adds, replaces and removes a media entry by name", () => {
    const out = ok(applyTreePatch(TREE, [
      { op: "media", entry: { name: "a.png", relPath: "media/a.png" } },
      { op: "media", entry: { name: "b.png", nodeId: "n2" } },
      { op: "remove-media", name: "b.png" },
    ]));
    expect(out.media).toEqual([{ name: "a.png", relPath: "media/a.png" }]);
  });

  it("refuses a path that names nothing, saying which op", () => {
    expect(applyTreePatch(TREE, [{ op: "remove", path: "blocks[9]" }])).toMatchObject({ error: expect.stringMatching(/patch\[0\].*past the end/) });
    expect(applyTreePatch(TREE, [{ op: "replace", path: "blocks[0].rows[0][0].blocks[0]", block: line("x") }])).toMatchObject({ error: expect.stringMatching(/not a table/) });
    expect(applyTreePatch(TREE, [{ op: "replace", path: "bloc 3", block: line("x") }])).toMatchObject({ error: expect.stringMatching(/not a block path/) });
  });

  it("refuses a patch whose result is not a valid page, and leaves the original alone", () => {
    const result = applyTreePatch(TREE, [{ op: "replace", path: "blocks[0]", block: { kind: "line", bold: true, runs: [] } }]);
    expect(result).toMatchObject({ error: expect.stringMatching(/not valid.*bold/) });
    expect(TREE.blocks[0]).toEqual(line("Titre"));
  });
});

describe("what a call means by its page", () => {
  it("takes the tree inline, or by ref, never both", async () => {
    const parked = (await parkTree(NS, TREE))!;
    expect(await resolveTreeInput(NS, { document: TREE })).toMatchObject({ from: "document" });
    expect(await resolveTreeInput(NS, { treeRef: parked.treeRef })).toMatchObject({ from: "treeRef", tree: TREE });
    expect(await resolveTreeInput(NS, { document: TREE, treeRef: parked.treeRef })).toMatchObject({ error: expect.stringMatching(/not both/) });
    expect(await resolveTreeInput(NS, {})).toMatchObject({ error: expect.stringMatching(/Pass the page/) });
  });

  it("explains a ref that resolves to nothing, with the only two causes it can have", async () => {
    const result = await resolveTreeInput(NS, { treeRef: "tree_ffffffffffffffffffffffff" });
    expect(result).toMatchObject({ error: expect.stringMatching(/expired.*24 h.*another namespace/) });
  });

  it("applies a patch on top of a ref", async () => {
    const parked = (await parkTree(NS, TREE))!;
    const result = await resolveTreeInput(NS, { treeRef: parked.treeRef, patch: [{ op: "remove", path: "blocks[2]" }] });
    if ("error" in result) throw new Error(result.error);
    expect((result.tree as typeof TREE).blocks).toHaveLength(2);
    // The parked tree is untouched: a patch is applied to a copy.
    expect(await readParkedTree(NS, parked.treeRef)).toEqual(TREE);
  });
});
