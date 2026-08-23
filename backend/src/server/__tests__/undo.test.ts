/*
 * undo_last — take back ONE staged edit (self-serve-authoring.md, phase 4)
 *
 * The promise under test is narrow and load-bearing: an expert who makes six
 * edits and regrets the last one should lose the last one, not all six. Until
 * this tool, discard_draft was the only way back.
 *
 * What each block pins down:
 *   • REVERSAL — the draft goes back byte-for-byte to what it was before the
 *     edit, while an earlier edit on the same draft survives untouched.
 *   • PEELING — repeated calls walk backwards through the draft rather than
 *     toggling the last edit on and off, and then say plainly there is no more.
 *   • CONFLICT — when a later edit touched the same node, the answer is a
 *     refusal that NAMES the node, never a merge (risk 4).
 *   • SCOPE — published work is out of reach; undo only ever edits the draft.
 *   • GATES — the same two-phase confirm and the same role gate as any write.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  seedStore, withActiveContext as inContext, fixtureContext, installFakeStorage,
  CI_MATHS, CURATOR, APPROVER, SIGNED_IN_NO_ROLE as NO_ROLE,
} from "../../__tests__/harness.js";
import {
  __setKgStoreForTest, kgNamespace, runGraphMutation,
  __resetMutationsForTest, __resetDraftTokensForTest,
} from "../../kg-store/index.js";
import { editNode } from "../../kg-recipes/index.js";
import { type Actor } from "../../actor.js";
import { runUndoLast } from "../undo.js";
import { undoConflicts } from "../../kg-store/index.js";
import { runCreateDocument } from "../document-authoring.js";
import { runPublishDraft } from "../lifecycle.js";
import type { KgNodeStore, MutationEdge, MutationNode, Slot } from "../../kg-store/index.js";

let store: KgNodeStore;
const targetCtx = fixtureContext(CI_MATHS);
const ns = kgNamespace(targetCtx.workspace, targetCtx.grade, targetCtx.subject);

const withActiveContext = <T>(actor: Actor | null, fn: () => Promise<T>): Promise<T> =>
  inContext(targetCtx, actor, fn);

// Order-agnostic dump of a slot, minus the storage tag — the reversal oracle.
async function snapshot(slot: Slot) {
  const [nodes, edges] = await Promise.all([store.listNodes(ns, slot), store.listEdges(ns, slot)]);
  const strip = <T extends { slot?: string }>(x: T) => { const { slot: _s, ...rest } = x; return rest; };
  return {
    nodes: [...nodes].sort((a, b) => a.id.localeCompare(b.id)).map(strip),
    edges: [...edges].sort((a, b) => a.id.localeCompare(b.id)).map(strip),
  };
}

const draftSlot = async (): Promise<Slot> => (await store.readPointer(ns))!.draftSlot!;

// Rename a node on the draft, two-phase, the way a caller does.
async function stageTitleEdit(nodeId: string, title: string): Promise<void> {
  await withActiveContext(CURATOR, async () => {
    const args = { namespace: ns, nodeId, title };
    const preview = await runGraphMutation({ namespace: ns, mutation: editNode, args });
    if (preview.phase !== "preview") throw new Error(`expected preview, got ${preview.phase}`);
    const applied = await runGraphMutation({ namespace: ns, mutation: editNode, args, confirm: true, token: preview.confirmationToken });
    if (applied.phase !== "apply" || !applied.ok) throw new Error(`apply failed: ${JSON.stringify(applied)}`);
  });
}

// Dry-run then confirm any write tool, re-sending what the confirm needs — the
// same shape a caller uses (see self-serve.test.ts).
async function confirmed(
  run: (args: Record<string, unknown>) => Promise<Record<string, unknown>>,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const preview = await run(args);
  expect(preview.phase, JSON.stringify(preview)).toBe("preview");
  const mintedNodeIds = preview.mintedNodeIds as string[] | undefined;
  return run({ ...args, confirm: true, confirmationToken: preview.confirmationToken, mintedNodeId: mintedNodeIds?.[0] });
}

// Dry-run then confirm an undo, as one call.
async function undoConfirmed(actor: Actor = CURATOR): Promise<Record<string, unknown>> {
  return withActiveContext(actor, async () => {
    const preview = await runUndoLast({});
    expect(preview.phase, JSON.stringify(preview)).toBe("preview");
    return runUndoLast({ confirm: true, confirmationToken: preview.confirmationToken as string });
  });
}

async function aChapter(): Promise<{ id: string; title: string }> {
  const nodes = await store.listNodes(ns, "a");
  const chapter = nodes.find((node) =>
    (node.labels ?? []).includes("LessonGrouping") &&
    (node.properties?.raw as Record<string, unknown> | undefined)?.groupName === "Chapitre")!;
  expect(chapter, "the CI-maths fixture should hold at least one chapter").toBeTruthy();
  return { id: chapter.id, title: String(chapter.properties?.title ?? "") };
}

const titleOnDraft = async (nodeId: string): Promise<string> => {
  const nodes = await store.listNodes(ns, await draftSlot());
  return String(nodes.find((n) => n.id === nodeId)!.properties?.title ?? "");
};

beforeAll(() => { installFakeStorage(); });
beforeEach(async () => {
  store = await seedStore({ only: [CI_MATHS] });
  __setKgStoreForTest(store);
  __resetMutationsForTest();
  __resetDraftTokensForTest();
});
afterAll(() => { __setKgStoreForTest(null); });

describe("undo_last — the last edit goes back, the rest stay", () => {
  it("restores the draft to exactly what it was before the last edit", async () => {
    const chapter = await aChapter();
    await stageTitleEdit(chapter.id, "Premier changement");
    const afterFirstEdit = await snapshot(await draftSlot());

    await stageTitleEdit(chapter.id, "Second changement");
    expect(await titleOnDraft(chapter.id)).toBe("Second changement");

    const undone = await undoConfirmed();
    expect(undone.phase).toBe("apply");
    expect(undone.ok).toBe(true);

    // Byte-for-byte back to the state the FIRST edit left — so the first edit
    // survived, and the second left nothing behind.
    expect(await snapshot(await draftSlot())).toEqual(afterFirstEdit);
    expect(await titleOnDraft(chapter.id)).toBe("Premier changement");
  });

  it("takes back a creation together with the edges that came with it", async () => {
    const chapter = await aChapter();
    const beforeDocument = await withActiveContext(CURATOR, async () => {
      await stageTitleEdit(chapter.id, "Une retouche");
      return snapshot(await draftSlot());
    });

    const created = await withActiveContext(CURATOR, () =>
      confirmed(runCreateDocument as never, { name: "Fiche de révision", covers: chapter.id }));
    expect(created.ok, JSON.stringify(created)).toBe(true);

    await undoConfirmed();

    // The TLM and its `covers` edge both went — the two halves of one atomic
    // verb are one edit to undo, not two.
    expect(await snapshot(await draftSlot())).toEqual(beforeDocument);
  });

  it("names the edit it is about to take back, before anything is applied", async () => {
    const chapter = await aChapter();
    await stageTitleEdit(chapter.id, "Un titre");

    const preview = await withActiveContext(CURATOR, () => runUndoLast({}));
    expect(preview.phase).toBe("preview");
    const undoing = preview.undoing as { mutation: string; by: string; auditId: string };
    expect(undoing.mutation).toBe("editNode");
    expect(undoing.by).toBe(CURATOR.id);

    // A dry-run changes nothing.
    expect(await titleOnDraft(chapter.id)).toBe("Un titre");
  });

  it("tells the caller the rest of the draft is still there", async () => {
    const chapter = await aChapter();
    await stageTitleEdit(chapter.id, "Un titre");
    const undone = await undoConfirmed();
    expect((undone.nextSteps as string[]).join(" ")).toMatch(/diff_draft/);
  });
});

describe("undo_last — repeated calls peel back", () => {
  it("walks backwards through the draft instead of toggling the last edit", async () => {
    const chapter = await aChapter();
    const beforeAnything = await withActiveContext(CURATOR, async () => {
      await stageTitleEdit(chapter.id, "Un");            // opens the draft
      return null;
    });
    expect(beforeAnything).toBeNull();
    await stageTitleEdit(chapter.id, "Deux");

    await undoConfirmed();
    expect(await titleOnDraft(chapter.id)).toBe("Un");

    // A second undo takes back the edit BEFORE it — it does not redo "Deux".
    await undoConfirmed();
    expect(await titleOnDraft(chapter.id)).toBe(chapter.title);
  });

  it("says plainly when there is nothing left to take back", async () => {
    const chapter = await aChapter();
    await stageTitleEdit(chapter.id, "Un");
    await undoConfirmed();

    const nothing = await withActiveContext(CURATOR, () => runUndoLast({}));
    expect(nothing.nothingToUndo).toBe(true);
    expect(nothing.confirmationToken).toBeUndefined();
    expect(String(nothing.message)).toMatch(/no staged edit to take back/);
  });

  it("has nothing to take back on a namespace with no draft at all", async () => {
    const nothing = await withActiveContext(CURATOR, () => runUndoLast({}));
    expect(nothing.nothingToUndo).toBe(true);
  });
});

// The conflict rule (self-serve-authoring.md, risk 4). Through the tool it is
// hard to reach on purpose: undo_last always targets the NEWEST edit not yet
// undone, so undos peel strictly in reverse order and each one lands on a draft
// that still looks exactly the way its edit left it. The checker is what makes
// that property CHECKED rather than assumed — so it is tested where it lives,
// as a pure function, plus one integration test that the peel really is clean.
const node = (id: string, title: string): MutationNode => ({ id, namespace: ns, type: "Lesson", properties: { title } });
const edge = (from: string, to: string): MutationEdge => ({ id: `hasPart:${from}->${to}`, namespace: ns, type: "hasPart", from, to, properties: {} });

describe("undoConflicts — when an edit can no longer be taken back on its own", () => {
  it("passes when the draft still looks the way the edit left it", () => {
    const base = { nodes: [node("x", "after")], edges: [] };
    const diff = { nodes: { added: [], removed: [], changed: [{ id: "x", before: node("x", "before"), after: node("x", "after") }] }, edges: { added: [], removed: [], changed: [] } };
    expect(undoConflicts(base, diff)).toEqual([]);
  });

  it("refuses when the node it modified was modified again since", () => {
    const base = { nodes: [node("x", "someone else's wording")], edges: [] };
    const diff = { nodes: { added: [], removed: [], changed: [{ id: "x", before: node("x", "before"), after: node("x", "after") }] }, edges: { added: [], removed: [], changed: [] } };
    expect(undoConflicts(base, diff).join(" ")).toMatch(/'x'.*modified again/);
  });

  it("refuses when the node it created has already been deleted", () => {
    const base = { nodes: [], edges: [] };
    const diff = { nodes: { added: [{ id: "x", after: node("x", "new") }], removed: [], changed: [] }, edges: { added: [], removed: [], changed: [] } };
    expect(undoConflicts(base, diff).join(" ")).toMatch(/'x'.*already been removed/);
  });

  it("refuses when the node it deleted has been re-created since", () => {
    const base = { nodes: [node("x", "back again")], edges: [] };
    const diff = { nodes: { added: [], removed: [{ id: "x", before: node("x", "gone") }], changed: [] }, edges: { added: [], removed: [], changed: [] } };
    expect(undoConflicts(base, diff).join(" ")).toMatch(/'x'.*re-created/);
  });

  it("refuses — naming the connection — when its new node was wired up by a later edit", () => {
    // Taking the creation back would remove 'x', which a later edit hung 'y' off.
    // Named here so the refusal reads as a sentence, not as Rule 2's dangling-edge error.
    const base = { nodes: [node("x", "new"), node("y", "later")], edges: [edge("x", "y")] };
    const diff = { nodes: { added: [{ id: "x", after: node("x", "new") }], removed: [], changed: [] }, edges: { added: [], removed: [], changed: [] } };
    expect(undoConflicts(base, diff).join(" ")).toMatch(/'x'.*connected to something else.*hasPart:x->y/);
  });
});

describe("undo_last — the peel really is clean", () => {
  it("undoes a chain of edits on the SAME node without ever hitting a conflict", async () => {
    const chapter = await aChapter();
    await stageTitleEdit(chapter.id, "Un");
    await stageTitleEdit(chapter.id, "Deux");
    await stageTitleEdit(chapter.id, "Trois");

    for (const expected of ["Deux", "Un", chapter.title]) {
      const applied = await undoConfirmed();
      expect(applied.ok, JSON.stringify(applied)).toBe(true);
      expect(await titleOnDraft(chapter.id)).toBe(expected);
    }
  });
});

describe("undo_last — scope and gates", () => {
  it("cannot reach published work: after a publish there is nothing to undo", async () => {
    const chapter = await aChapter();
    await stageTitleEdit(chapter.id, "Publié");
    await withActiveContext(APPROVER, async () => {
      const preview = await runPublishDraft({});
      const published = await runPublishDraft({ confirm: true, confirmationToken: preview.confirmationToken as string });
      expect(published.ok, JSON.stringify(published)).toBe(true);
    });

    const nothing = await withActiveContext(CURATOR, () => runUndoLast({}));
    expect(nothing.nothingToUndo).toBe(true);
  });

  it("is refused for an actor with no role, like any other write", async () => {
    const chapter = await aChapter();
    await stageTitleEdit(chapter.id, "Un titre");
    const denied = await withActiveContext(NO_ROLE, () => runUndoLast({}));
    expect(denied.phase).toBe("unauthorized");
  });

  it("cannot be replayed from one token", async () => {
    const chapter = await aChapter();
    await stageTitleEdit(chapter.id, "Un");
    await stageTitleEdit(chapter.id, "Deux");

    const replayed = await withActiveContext(CURATOR, async () => {
      const preview = await runUndoLast({});
      const first = await runUndoLast({ confirm: true, confirmationToken: preview.confirmationToken as string });
      expect(first.ok).toBe(true);
      return runUndoLast({ confirm: true, confirmationToken: preview.confirmationToken as string });
    });
    expect(replayed.ok).toBe(false);
  });
});
