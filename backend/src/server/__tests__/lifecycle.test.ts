/*
 * publish_draft / discard_draft tool cores — returnMode shaping
 *
 * Drives the exported cores (runPublishDraft / runDiscardDraft) against the
 * seeded CI-maths store, asserting the tool-layer response shape the kg-store
 * tests (curator-loop) don't cover:
 *   • summary (the default) drops the whole-draft diff for a compact `counts`
 *     object; "full" keeps the diff (and the staged profileDiff).
 *   • the staged profileDiff is dropped in summary, kept in full.
 *   • the commit results (already diff-free) keep their audit fields.
 *   • an empty draft still returns the "nothing to do" notice.
 *
 * A curator stages one edit; an approver publishes — matching the real roles.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { seedStore, seededContexts, fakeStorage, CI_MATHS , withActiveContext as inContext } from "../../__tests__/index.js";
import { newSessionState, runInSession } from "../../context/index.js";
import { subjectDir, KG_FIXTURE } from "../../__tests__/index.js";
import {
  __setKgStoreForTest, kgNamespace,
  runGraphMutation, __resetMutationsForTest, __resetDraftTokensForTest, deleteNodes,
} from "../../kg-store/index.js";
import { reposition } from "../../kg-recipes/index.js";
import { __setStorageForTest } from "../../storage/index.js";
import { __setActorForTest, type Actor } from "../../actor.js";
import { activateContext } from "../../activate.js";
import { runPublishDraft, runDiscardDraft } from "../lifecycle.js";
import { walkActiveGraph, namespaceStats } from "../graph.js";
import type { KgNodeStore, StoredMeta } from "../../kg-store/index.js";
import type { StorageAdapter, HistoryFile } from "../../types.js";

const CURATOR: Actor = { id: "curator-uid", email: "curator@test", role: "curator", unknown: false };
const APPROVER: Actor = { id: "approver-uid", email: "approver@test", role: "approver", unknown: false };

let store: KgNodeStore;
// The fixture contexts this suite asserts against — seeding only these
// keeps each beforeEach off the graphs it never reads.
const SEED_CONTEXTS = [CI_MATHS];
const contexts = seededContexts(SEED_CONTEXTS);
const targetCtx = contexts.find((c) => c.grade === "ci" && c.subject === "maths")!;
const ns = kgNamespace(targetCtx.grade, targetCtx.subject);

async function seedFreshStore(): Promise<KgNodeStore> {
  return seedStore({ only: SEED_CONTEXTS });
}

// Run `fn` inside an active ci/maths session as `actor` — the cores read the
// active namespace from the session bag, so every core call needs one.
// The harness session helper, with this suite's context bound in.
const withActiveContextAs = <T>(actor: Actor, fn: () => Promise<T>): Promise<T> =>
  inContext(targetCtx, actor, fn);

// Stage exactly one edit (reposition the first chapter) onto the draft as the
// curator — the minimal draft the publish/discard cores act on.
async function stageOneEditAsCurator(): Promise<void> {
  await withActiveContextAs(CURATOR, async () => {
    const nodes = await store.listNodes(ns, "a");
    const chapterId = nodes.find((n) => (n.labels ?? []).includes("LessonGrouping"))!.id;
    const args = { namespace: ns, nodeId: chapterId, position: 9 };
    const preview = await runGraphMutation({ namespace: ns, mutation: reposition, args });
    if (preview.phase !== "preview") throw new Error("expected a preview");
    await runGraphMutation({ namespace: ns, mutation: reposition, args, confirm: true, token: preview.confirmationToken });
  });
}

beforeAll(() => { __setStorageForTest(fakeStorage); });
beforeEach(async () => {
  store = await seedFreshStore();
  __setKgStoreForTest(store);
  __resetMutationsForTest();
  __resetDraftTokensForTest();
});
afterAll(() => {
  __setKgStoreForTest(null);
});

describe("publish_draft returnMode", () => {
  it("summary (default) dry-run: confirmationToken + counts, no diff", async () => {
    await stageOneEditAsCurator();
    const dryRun = await withActiveContextAs(APPROVER, () => runPublishDraft({}));
    expect(dryRun.phase).toBe("preview");
    expect(typeof dryRun.confirmationToken).toBe("string");
    // One node repositioned → exactly one nodesChanged, nothing else.
    expect(dryRun.counts).toEqual({ nodesAdded: 0, edgesAdded: 0, nodesChanged: 1, nodesRemoved: 0, edgesRemoved: 0 });
    // The big payloads are dropped in summary.
    expect(dryRun.diff).toBeUndefined();
    expect(dryRun.profileDiff).toBeUndefined();
  });

  it("full dry-run: the whole-draft diff (and profileDiff) alongside the same counts", async () => {
    await stageOneEditAsCurator();
    const dryRun = await withActiveContextAs(APPROVER, () => runPublishDraft({ returnMode: "full" }));
    expect(dryRun.diff).toBeDefined();
    const diff = dryRun.diff as { nodes: { changed: unknown[] } };
    expect(diff.nodes.changed.length).toBe(1);
    // A draft always carries a profileDiff (changed:false when unedited) — full mode keeps it.
    expect(dryRun.profileDiff).toBeDefined();
    expect(dryRun.counts).toEqual({ nodesAdded: 0, edgesAdded: 0, nodesChanged: 1, nodesRemoved: 0, edgesRemoved: 0 });
  });

  it("commit (summary): auditId + publishedSlot, no diff", async () => {
    await stageOneEditAsCurator();
    const commit = await withActiveContextAs(APPROVER, async () => {
      const dryRun = await runPublishDraft({});
      return runPublishDraft({ confirm: true, confirmationToken: dryRun.confirmationToken as string });
    });
    expect(commit.phase).toBe("commit");
    expect(commit.ok).toBe(true);
    expect(typeof commit.auditId).toBe("string");
    expect(commit.publishedSlot).toBe("a");           // small publish applies in place
    expect(commit.diff).toBeUndefined();
  });
});

describe("discard_draft returnMode", () => {
  it("summary dry-run: confirmationToken + counts, no diff; commit: auditId + discardedApplyIds, no diff", async () => {
    await stageOneEditAsCurator();
    const { dryRun, commit } = await withActiveContextAs(CURATOR, async () => {
      const dryRun = await runDiscardDraft({});
      const commit = await runDiscardDraft({ confirm: true, confirmationToken: dryRun.confirmationToken as string });
      return { dryRun, commit };
    });
    // Dry-run summary.
    expect(dryRun.phase).toBe("preview");
    expect(typeof dryRun.confirmationToken).toBe("string");
    expect(dryRun.counts).toEqual({ nodesAdded: 0, edgesAdded: 0, nodesChanged: 1, nodesRemoved: 0, edgesRemoved: 0 });
    expect(dryRun.diff).toBeUndefined();
    // Commit summary.
    expect(commit.phase).toBe("commit");
    expect(commit.ok).toBe(true);
    expect(typeof commit.auditId).toBe("string");
    expect((commit.discardedApplyIds as string[]).length).toBe(1);
    expect(commit.diff).toBeUndefined();
    // The draft is gone.
    expect((await store.readPointer(ns))?.draftSlot).toBe(null);
  });

  it("full dry-run keeps the diff", async () => {
    await stageOneEditAsCurator();
    const dryRun = await withActiveContextAs(CURATOR, () => runDiscardDraft({ returnMode: "full" }));
    expect(dryRun.diff).toBeDefined();
    expect(dryRun.counts).toBeDefined();
  });
});

// Regression for the stale-read bug: after publish_draft flips the pointer, the
// SAME session's published reads (walk_graph / namespace_stats) must reflect the
// promoted draft — not the snapshot pinned at set_context. Before the fix the
// read model was hydrated once at activate and never refreshed, so a delete could
// be `applied` + `published` in the audit while reads still returned the node.
describe("publish refreshes this session's published reads (no stale snapshot)", () => {
  const totalNodes = (stats: Record<string, unknown>): number =>
    Object.values(stats.nodeCounts as Record<string, number>).reduce((sum, n) => sum + n, 0);

  it("a delete published in-session is reflected by namespace_stats and walk_graph", async () => {
    // A curator stages a delete of one content leaf onto the draft.
    //
    // A TRUE leaf, found by having no outgoing containment edge — deleting
    // cascades the whole subtree, and this test asserts that exactly one node
    // vanishes. Naming a label instead ("a Material — no dependents") stopped
    // working when maths dropped its Materials: the fallback picked a Lesson and
    // took nine descendants with it.
    const deletedId = await withActiveContextAs(CURATOR, async () => {
      const nodes = await store.listNodes(ns, "a");
      const edges = await store.listEdges(ns, "a");
      const hasChildren = new Set(edges.filter((e) => e.type === "hasPart" || e.type === "hasChild").map((e) => e.from));
      const leaf = nodes.find((n) => !hasChildren.has(n.id) && (n.labels ?? []).some((l) => ["Material", "Activity", "LearningComponent"].includes(l)))!;
      const args = { namespace: ns, nodeIds: [leaf.id] };
      const preview = await runGraphMutation({ namespace: ns, mutation: deleteNodes, args });
      if (preview.phase !== "preview") throw new Error("expected a preview");
      await runGraphMutation({ namespace: ns, mutation: deleteNodes, args, confirm: true, token: preview.confirmationToken });
      return leaf.id;
    });

    // The approver reads, publishes, and re-reads — all in ONE session, the loop
    // the bug broke.
    await withActiveContextAs(APPROVER, async () => {
      const before = await namespaceStats();
      expect(before.physicalSlot).toBe("a");             // reads on the seed slot
      const totalBefore = totalNodes(before);
      const walkBefore = await walkActiveGraph({ fromId: deletedId, direction: "out" });
      expect("error" in walkBefore).toBe(false);          // node still on published

      const dryRun = await runPublishDraft({});
      const commit = await runPublishDraft({ confirm: true, confirmationToken: dryRun.confirmationToken as string });
      expect(commit.ok).toBe(true);
      expect(commit.publishedSlot).toBe("a");             // small publish applies in place
      expect(commit.readModelRefreshed).toBe(true);       // read cache re-hydrated

      const after = await namespaceStats();
      expect(after.physicalSlot).toBe("a");               // published stayed on slot a
      expect(totalNodes(after)).toBe(totalBefore - 1);    // the delete is visible
      const walkAfter = await walkActiveGraph({ fromId: deletedId, direction: "out" });
      expect("error" in walkAfter).toBe(true);            // the node is gone
    });
  });
});

describe("empty draft: nothing-to-do in summary mode", () => {
  it("publish_draft with no draft returns hasDraft:false, no token, no counts", async () => {
    const result = await withActiveContextAs(APPROVER, () => runPublishDraft({}));
    expect(result.phase).toBe("preview");
    expect(result.hasDraft).toBe(false);
    expect(result.confirmationToken).toBeUndefined();
    expect(result.counts).toBeUndefined();
    expect(result.diff).toBeUndefined();
  });

  it("discard_draft with no draft returns hasDraft:false, no token, no counts", async () => {
    const result = await withActiveContextAs(CURATOR, () => runDiscardDraft({}));
    expect(result.phase).toBe("preview");
    expect(result.hasDraft).toBe(false);
    expect(result.confirmationToken).toBeUndefined();
    expect(result.counts).toBeUndefined();
    expect(result.diff).toBeUndefined();
  });
});
