/*
 * request_review + the grown-up unfinished-work view
 * (self-serve-authoring.md, phase 5)
 *
 * The handoff a curator makes when they finish — "this is ready, someone look
 * at it" — which until now travelled on WhatsApp, outside every trace the
 * system keeps.
 *
 * What each block pins down:
 *   • THE HANDOFF — asking is recorded, withdrawing takes it back, and both are
 *     in the audit trail with who asked and what they said.
 *   • NO STALE STAMP — the state is derived from the audit chain, so publishing
 *     or discarding clears it with nothing to remember. This is the whole reason
 *     it is not a field on the pointer, so it is tested directly.
 *   • WHOSE MOVE — start_here says the opposite thing to the curator who asked
 *     and to the approver being waited on.
 *   • THE DRAFT'S SIZE — counted from the edits' own records, so an edit and its
 *     undo cancel out instead of counting twice.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { seedStore, seededContexts, fakeStorage, CI_MATHS , withActiveContext as inContext, aContentGrouping } from "../../__tests__/index.js";
import { newSessionState, runInSession } from "../../context/index.js";
import { subjectDir, KG_FIXTURE } from "../../__tests__/index.js";
import {
  __setKgStoreForTest, kgNamespace, runGraphMutation,
  __resetMutationsForTest, __resetDraftTokensForTest,
} from "../../kg-store/index.js";
import { editNode } from "../../kg-recipes/index.js";
import { __setStorageForTest } from "../../storage/index.js";
import { __setActorForTest, type Actor } from "../../actor.js";
import { activateContext } from "../../activate.js";
import { runRequestReview } from "../review.js";
import { runUndoLast } from "../undo.js";
import { runPublishDraft, runDiscardDraft } from "../lifecycle.js";
import { startHere } from "../start-here.js";
import type { KgNodeStore, StoredMeta } from "../../kg-store/index.js";
import type { StorageAdapter, HistoryFile } from "../../types.js";


const CURATOR: Actor = { id: "curator-uid", email: "curator@test", role: "curator", unknown: false };
const APPROVER: Actor = { id: "approver-uid", email: "approver@test", role: "approver", unknown: false };
const NO_ROLE: Actor = { id: "guest-uid", email: "guest@test", unknown: false };

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

// The harness session helper, with this suite's context bound in.
const withActiveContext = <T>(actor: Actor | null, fn: () => Promise<T>): Promise<T> =>
  inContext(targetCtx, actor, fn);

// A grouping to rename. ci/maths has weeks (it retired its chapters with the
// Student's Book), so this must not name a subject's vocabulary.
const aChapter = (): Promise<{ id: string; title: string }> => aContentGrouping(store, ns);

// Stage one rename on the draft, two-phase, as `actor`.
async function stageTitleEdit(actor: Actor, nodeId: string, title: string): Promise<void> {
  await withActiveContext(actor, async () => {
    const args = { namespace: ns, nodeId, title };
    const preview = await runGraphMutation({ namespace: ns, mutation: editNode, args });
    if (preview.phase !== "preview") throw new Error(`expected preview, got ${preview.phase}`);
    const applied = await runGraphMutation({ namespace: ns, mutation: editNode, args, confirm: true, token: preview.confirmationToken });
    if (applied.phase !== "apply" || !applied.ok) throw new Error("apply failed");
  });
}

const reviewEvents = async () => (await store.listAudit({ namespace: ns })).filter((r) => r.eventType === "review");

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

describe("request_review — the handoff", () => {
  it("marks the draft ready, and says out loud that nobody is notified", async () => {
    const chapter = await aChapter();
    await stageTitleEdit(CURATOR, chapter.id, "Prêt à relire");

    const asked = await withActiveContext(CURATOR, () => runRequestReview({ note: "Chapitres 1-3 faits, le 4 reste à faire." }));
    expect(asked.ok).toBe(true);
    expect(asked.reviewRequested).toBe(true);
    expect((asked.draft as { edits: number }).edits).toBe(1);
    // The one thing a curator will otherwise assume wrongly.
    expect(String(asked.message)).toMatch(/Nobody is notified/);

    const events = await reviewEvents();
    expect(events).toHaveLength(1);
    expect(events[0].reviewState).toBe("requested");
    expect(events[0].reviewNote).toMatch(/Chapitres 1-3/);
    expect(events[0].actor.id).toBe(CURATOR.id);
  });

  it("takes the request back on withdraw, leaving the draft untouched", async () => {
    const chapter = await aChapter();
    await stageTitleEdit(CURATOR, chapter.id, "Presque prêt");
    await withActiveContext(CURATOR, () => runRequestReview({}));

    const withdrawn = await withActiveContext(CURATOR, () => runRequestReview({ withdraw: true }));
    expect(withdrawn.ok).toBe(true);
    expect(withdrawn.reviewRequested).toBe(false);

    const seen = await withActiveContext(APPROVER, startHere);
    expect(seen.waitingOn).toBeNull();

    // The draft itself never moved.
    const pointer = await store.readPointer(ns);
    const nodes = await store.listNodes(ns, pointer!.draftSlot!);
    expect(String(nodes.find((n) => n.id === chapter.id)!.properties?.title)).toBe("Presque prêt");
  });

  it("says there is nothing to take back when none was asked for", async () => {
    const chapter = await aChapter();
    await stageTitleEdit(CURATOR, chapter.id, "Un titre");
    const result = await withActiveContext(CURATOR, () => runRequestReview({ withdraw: true }));
    expect(result.alreadyClear).toBe(true);
    expect(await reviewEvents()).toHaveLength(0);
  });

  it("has nothing to put up for review with no draft open", async () => {
    const result = await withActiveContext(CURATOR, () => runRequestReview({}));
    expect(result.noDraft).toBe(true);
    expect(await reviewEvents()).toHaveLength(0);
  });

  it("is refused for an actor with no role, like any other write", async () => {
    const chapter = await aChapter();
    await stageTitleEdit(CURATOR, chapter.id, "Un titre");
    const denied = await withActiveContext(NO_ROLE, () => runRequestReview({}));
    expect(denied.phase).toBe("unauthorized");
    expect(await reviewEvents()).toHaveLength(0);
  });

  it("refuses a note long enough to be the work itself", async () => {
    const chapter = await aChapter();
    await stageTitleEdit(CURATOR, chapter.id, "Un titre");
    const result = await withActiveContext(CURATOR, () => runRequestReview({ note: "x".repeat(1001) }));
    expect(String(result.error)).toMatch(/keep it under/);
    expect(await reviewEvents()).toHaveLength(0);
  });
});

// The reason the state is derived from the audit chain rather than stamped on
// the pointer: there is no second place to clear, so it CANNOT be left standing
// on work that already went live.
describe("request_review — the stamp cannot go stale", () => {
  it("is cleared by publishing, with nothing to remember", async () => {
    const chapter = await aChapter();
    await stageTitleEdit(CURATOR, chapter.id, "À publier");
    await withActiveContext(CURATOR, () => runRequestReview({}));

    await withActiveContext(APPROVER, async () => {
      const preview = await runPublishDraft({});
      const published = await runPublishDraft({ confirm: true, confirmationToken: preview.confirmationToken as string });
      expect(published.ok, JSON.stringify(published)).toBe(true);
    });

    const after = await withActiveContext(APPROVER, startHere);
    expect(after.waitingOn).toBeNull();
    expect(after.draftActivity).toBeNull();
  });

  it("is cleared by discarding too", async () => {
    const chapter = await aChapter();
    await stageTitleEdit(CURATOR, chapter.id, "À jeter");
    await withActiveContext(CURATOR, () => runRequestReview({}));

    await withActiveContext(CURATOR, async () => {
      const preview = await runDiscardDraft({});
      await runDiscardDraft({ confirm: true, confirmationToken: preview.confirmationToken as string });
    });

    const after = await withActiveContext(CURATOR, startHere);
    expect(after.waitingOn).toBeNull();
  });

  it("a request on a NEW draft is its own — the old one does not carry over", async () => {
    const chapter = await aChapter();
    await stageTitleEdit(CURATOR, chapter.id, "Premier lot");
    await withActiveContext(CURATOR, () => runRequestReview({ note: "premier lot" }));
    await withActiveContext(APPROVER, async () => {
      const preview = await runPublishDraft({});
      await runPublishDraft({ confirm: true, confirmationToken: preview.confirmationToken as string });
    });

    await stageTitleEdit(CURATOR, chapter.id, "Deuxième lot");
    const fresh = await withActiveContext(APPROVER, startHere);
    expect(fresh.waitingOn).toBeNull();          // the new draft was never put up
    expect((fresh.draftActivity as { edits: number }).edits).toBe(1);
  });
});

describe("start_here — whose move it is", () => {
  it("tells the approver they are the one being waited on", async () => {
    const chapter = await aChapter();
    await stageTitleEdit(CURATOR, chapter.id, "Pour relecture");
    await withActiveContext(CURATOR, () => runRequestReview({}));

    const seen = await withActiveContext(APPROVER, startHere);
    expect(String(seen.waitingOn)).toMatch(/waiting for YOU/);
    expect(String(seen.waitingOn)).toContain(CURATOR.id);
  });

  it("tells the curator who asked that they are the one waiting", async () => {
    const chapter = await aChapter();
    await stageTitleEdit(CURATOR, chapter.id, "Pour relecture");
    await withActiveContext(CURATOR, () => runRequestReview({}));

    const seen = await withActiveContext(CURATOR, startHere);
    expect(String(seen.waitingOn)).toMatch(/You asked/);
    expect(String(seen.waitingOn)).toMatch(/Nobody was notified/);
  });

  it("says nothing at all when no review is pending", async () => {
    const chapter = await aChapter();
    await stageTitleEdit(CURATOR, chapter.id, "Encore en cours");
    const seen = await withActiveContext(CURATOR, startHere);
    expect(seen.waitingOn).toBeNull();
    // …and offers the handoff as the next move.
    expect((seen.suggestions as string[]).join(" ")).toMatch(/request_review/);
  });
});

describe("start_here — how much unpublished work is standing", () => {
  it("counts the edits and the elements they touched", async () => {
    const chapter = await aChapter();
    await stageTitleEdit(CURATOR, chapter.id, "Un");
    await stageTitleEdit(CURATOR, chapter.id, "Deux");

    const seen = await withActiveContext(CURATOR, startHere);
    const activity = seen.draftActivity as { edits: number; elementsTouched: number; lastEditBy: string };
    expect(activity.edits).toBe(2);
    expect(activity.elementsTouched).toBe(1);       // both edits hit the same chapter
    expect(activity.lastEditBy).toBe(CURATOR.id);
  });

  it("does not count an edit that was taken back", async () => {
    const chapter = await aChapter();
    await stageTitleEdit(CURATOR, chapter.id, "Un");
    await stageTitleEdit(CURATOR, chapter.id, "Deux");
    await withActiveContext(CURATOR, async () => {
      const preview = await runUndoLast({});
      await runUndoLast({ confirm: true, confirmationToken: preview.confirmationToken as string });
    });

    const seen = await withActiveContext(CURATOR, startHere);
    // Three apply records stand in the log (two edits + the undo), but only ONE
    // edit is still standing on the draft — which is what an expert means.
    expect((seen.draftActivity as { edits: number }).edits).toBe(1);
  });
});
