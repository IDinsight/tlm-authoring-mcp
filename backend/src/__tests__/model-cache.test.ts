/*
 * The hydrated-model cache, driven through activateContext.
 *
 * Two halves of one contract, and the second is the one that matters: a cache
 * that never invalidates would silently serve a curator the graph they just
 * published over. So the invalidation case goes through the REAL edit → publish
 * path rather than hand-writing a new meta stamp.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  seedStore, installFakeStorage, fixtureContext,
  CURATOR, APPROVER, CI_MATHS, CE1_READING,
} from "./index.js";
import { newSessionState, runInSession } from "../context/index.js";
import {
  __setKgStoreForTest, kgNamespace, runGraphMutation,
  __resetMutationsForTest, __resetDraftTokensForTest, publishDraft,
  type KgNodeStore,
} from "../kg-store/index.js";
import { reposition } from "../kg-recipes/index.js";
import { __setActorForTest, type Actor } from "../actor.js";
import { activateContext } from "../activate.js";
import { PRELOADED_MODEL_KEY } from "../curriculum/index.js";
import type { CurriculumModel } from "../types.js";
import { sessionState } from "../context/index.js";

const ctx = () => fixtureContext(CI_MATHS);
const namespace = () => {
  const c = ctx();
  return kgNamespace(c.workspace, c.grade, c.subject);
};

// Wrap a store so the test can count the EXPENSIVE reads — the two collection
// scans the cache exists to avoid. Everything else passes straight through.
function countingStore(inner: KgNodeStore) {
  const counts = { listNodes: 0, listEdges: 0 };
  const wrapper = Object.create(inner) as KgNodeStore & { counts: typeof counts };
  wrapper.listNodes = (ns, slot) => { counts.listNodes++; return inner.listNodes(ns, slot); };
  wrapper.listEdges = (ns, slot) => { counts.listEdges++; return inner.listEdges(ns, slot); };
  wrapper.counts = counts;
  return wrapper;
}

const inSession = async <T>(actor: Actor, fn: () => Promise<T>): Promise<T> =>
  runInSession(newSessionState(), async () => {
    __setActorForTest(actor);
    return fn();
  });

describe("hydrated-model cache", () => {
  let store: ReturnType<typeof countingStore>;

  beforeAll(() => {
    installFakeStorage();
  });

  beforeEach(async () => {
    __resetMutationsForTest();
    __resetDraftTokensForTest();
    // seedStore() clears the process-wide cache, so each test starts cold.
    store = countingStore(await seedStore({ only: [CI_MATHS], withProfiles: true }));
    __setKgStoreForTest(store);
  });

  it("reads the graph once across repeated activations", async () => {
    const context = ctx();

    await inSession(CURATOR, async () => {
      const first = await activateContext(context.workspace, context.grade, context.subject);
      expect(first.ok).toBe(true);
    });
    expect(store.counts.listNodes).toBe(1);

    // A fresh session — what the claude.ai client opens on every tool call.
    for (let call = 0; call < 4; call++) {
      await inSession(CURATOR, async () => {
        const again = await activateContext(context.workspace, context.grade, context.subject);
        expect(again.ok).toBe(true);
      });
    }

    expect(store.counts.listNodes).toBe(1);
    expect(store.counts.listEdges).toBe(1);
  });

  it("still pins a usable model in the session bag on a cache hit", async () => {
    const context = ctx();
    let firstUnitCount = 0;

    await inSession(CURATOR, async () => {
      await activateContext(context.workspace, context.grade, context.subject);
      const model = sessionState().bag.get(PRELOADED_MODEL_KEY) as CurriculumModel;
      firstUnitCount = model.byId.size;
      expect(firstUnitCount).toBeGreaterThan(0);
    });

    await inSession(CURATOR, async () => {
      await activateContext(context.workspace, context.grade, context.subject);
      const model = sessionState().bag.get(PRELOADED_MODEL_KEY) as CurriculumModel;
      expect(model.byId.size).toBe(firstUnitCount);
    });
  });

  it("serves the PUBLISHED edit, not the pre-publish snapshot", async () => {
    const context = ctx();
    const ns = namespace();
    let targetId = "";
    let newPosition = 0;

    // Stage one real edit and publish it, the way a curator and approver would.
    await inSession(CURATOR, async () => {
      await activateContext(context.workspace, context.grade, context.subject);
      const model = sessionState().bag.get(PRELOADED_MODEL_KEY) as CurriculumModel;
      const target = [...model.byId.values()].find((unit) => typeof unit.order === "number" && unit.order > 0);
      expect(target).toBeDefined();

      targetId = target!.id;
      newPosition = (target!.order ?? 0) + 7;
      const args = { nodeId: targetId, position: newPosition };
      const dryRun = await runGraphMutation({ namespace: ns, mutation: reposition, args });
      // A blocked/unauthorized dry-run carries no token — fail loudly rather than
      // confirming with undefined and asserting against a no-op.
      if (!("confirmationToken" in dryRun)) {
        throw new Error(`dry-run did not return a token: ${JSON.stringify(dryRun)}`);
      }
      await runGraphMutation({ namespace: ns, mutation: reposition, args, confirm: true, token: dryRun.confirmationToken });
    });

    await inSession(APPROVER, async () => {
      await activateContext(context.workspace, context.grade, context.subject);
      const published = await publishDraft(ns);
      expect(published.ok).toBe(true);
    });

    // Count only the FINAL activation: the publish flow itself reads nodes, so a
    // baseline taken before it would make this assertion pass no matter what.
    const readsAfterPublish = store.counts.listNodes;

    await inSession(CURATOR, async () => {
      await activateContext(context.workspace, context.grade, context.subject);
      const model = sessionState().bag.get(PRELOADED_MODEL_KEY) as CurriculumModel;
      // The content itself must be post-publish — this is what a stale cache
      // would get wrong, independent of any read counting.
      expect(model.byId.get(targetId)?.order).toBe(newPosition);
    });

    // Exactly one extra read: the publish moved the content hash, so the next
    // activation misses and re-hydrates. (Through the publish_draft TOOL the
    // count would be unchanged instead — that path ends in refreshActiveContext,
    // which re-warms the cache itself.)
    expect(store.counts.listNodes).toBe(readsAfterPublish + 1);
  });

  it("re-hydrates when only the subject profile changed", async () => {
    const context = ctx();
    const ns = namespace();

    await inSession(CURATOR, async () => {
      await activateContext(context.workspace, context.grade, context.subject);
    });
    const readsAfterFirst = store.counts.listNodes;

    // A profile-only publish leaves the GRAPH hash untouched, so the profile is
    // the only thing that can tell the cache the hydration is out of date — and
    // the profile is what drives adapter.parse.
    const pointer = await store.readPointer(ns);
    const config = await store.readConfig(ns, pointer!.publishedSlot);
    await store.writeConfig(ns, pointer!.publishedSlot, { ...config, guide: "# A revised guide" });

    await inSession(CURATOR, async () => {
      await activateContext(context.workspace, context.grade, context.subject);
    });

    expect(store.counts.listNodes).toBe(readsAfterFirst + 1);
  });

  it("keeps a separate entry per namespace", async () => {
    store = countingStore(await seedStore({ only: [CI_MATHS, CE1_READING], withProfiles: true }));
    __setKgStoreForTest(store);

    const maths = fixtureContext(CI_MATHS);
    const reading = fixtureContext(CE1_READING);

    await inSession(CURATOR, async () => {
      await activateContext(maths.workspace, maths.grade, maths.subject);
      await activateContext(reading.workspace, reading.grade, reading.subject);
      // Switching back must NOT evict the first — one entry per namespace.
      await activateContext(maths.workspace, maths.grade, maths.subject);
      await activateContext(reading.workspace, reading.grade, reading.subject);
    });

    // Two namespaces, one graph read each.
    expect(store.counts.listNodes).toBe(2);
    expect(store.counts.listEdges).toBe(2);
  });
});
