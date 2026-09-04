/*
 * Profile tools — get_profile / get_graph_guide / edit_profile (cores).
 *
 * Exercises the exported tool cores against a seeded memory store. Focus: the
 * { core, guide } record surfaces correctly, the LLM-facing guide read, the
 * draft role gate, and the edit.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { seedStore, seededContexts, fakeStorage, CI_MATHS, CE1_READING } from "../../__tests__/index.js";
import { newSessionState, runInSession } from "../../context/index.js";
import { subjectDir, KG_FIXTURE } from "../../__tests__/index.js";
import { getRegisteredProfile } from "../../adapters/index.js";
import { __setKgStoreForTest, kgNamespace } from "../../kg-store/index.js";
import { __setStorageForTest } from "../../storage/index.js";
import { activateContext } from "../../activate.js";
import { runAsActor, __setActorForTest, type Actor } from "../../actor.js";
import { readProfile, readGraphGuide, runEditProfile, reviewDraft } from "../profile.js";
import type { KgNodeStore, StoredConfig, StoredMeta } from "../../kg-store/index.js";
import type { StorageAdapter, HistoryFile } from "../../types.js";


const CURATOR: Actor = { id: "curator-uid", email: "curator@test", role: "curator", unknown: false };
const UNKNOWN: Actor = { id: "anon", unknown: true };

let store: KgNodeStore;
// The fixture contexts this suite asserts against — seeding only these
// keeps each beforeEach off the graphs it never reads.
const SEED_CONTEXTS = [CI_MATHS, CE1_READING];
const contexts = seededContexts(SEED_CONTEXTS);
const maths = contexts.find((c) => c.grade === "ci" && c.subject === "maths")!;
const reading = contexts.find((c) => c.grade === "ce1" && c.subject === "reading")!;


async function seedFreshStore(): Promise<KgNodeStore> {
  return seedStore({ only: SEED_CONTEXTS, withProfiles: true });
}

beforeAll(() => { __setStorageForTest(fakeStorage); });
beforeEach(async () => {
  store = await seedFreshStore();
  __setKgStoreForTest(store);
  __setActorForTest(null);
});
afterAll(() => {
  __setKgStoreForTest(null);
});

// Activate a context inside a fresh session and run `fn` as the given actor.
async function inContext(ctx: { workspace: string; grade: string; subject: string }, actor: Actor, fn: () => Promise<void>) {
  await runInSession(newSessionState(), async () => {
    const res = await activateContext(ctx.workspace, ctx.grade, ctx.subject);
    expect(res.ok).toBe(true);
    await runAsActor(actor, fn);
  });
}

describe("firestore mode", () => {
  it("get_graph_guide returns the seeded guide for ci/maths", async () => {
    await inContext(maths, CURATOR, async () => {
      const res = await readGraphGuide();
      expect(res.hasGuide).toBe(true);
      expect(String(res.guide)).toContain("CI Maths — graph guide");
    });
  });

  it("get_graph_guide returns the seeded guide for ce1/reading", async () => {
    await inContext(reading, CURATOR, async () => {
      const res = await readGraphGuide();
      expect(res.hasGuide).toBe(true);
      expect(String(res.guide)).toContain("CE1 Reading — graph guide");
    });
  });

  it("get_profile returns the { core, guide } record", async () => {
    await inContext(maths, CURATOR, async () => {
      const res = await readProfile();
      const profile = res.profile as { core: { id: string }; guide?: string };
      expect(profile.core.id).toBe("ci-maths/nodes-relationships-v1");
      expect(typeof profile.guide).toBe("string");
    });
  });

  it("get_graph_guide slot:'draft' is gated for a non-curator", async () => {
    await inContext(maths, UNKNOWN, async () => {
      const res = await readGraphGuide("draft");
      expect(String(res.error)).toMatch(/restricted/i);
    });
  });

  it("edit_profile dry-run previews a change (curator)", async () => {
    await inContext(maths, CURATOR, async () => {
      const rec = { core: getRegisteredProfile("senegal", "ci", "maths"), guide: "# edited" };
      const res = await runEditProfile(rec as Record<string, unknown>) as { phase: string };
      expect(res.phase).toBe("preview");
    });
  });

  it("review_draft bundles the guide and structural facts (published)", async () => {
    await inContext(maths, CURATOR, async () => {
      const res = await reviewDraft();
      expect(res.reviewing).toBe("published");
      expect(String(res.guide)).toContain("Coverage expectations");
      const facts = res.structuralFacts as { nodesByType: Record<string, number>; containers: unknown[]; contentMultiParent: unknown[] };
      // The census is keyed by the graph's OWN kinds, so assert that it reports
      // some of them rather than naming one: maths' grouping kind is a curriculum
      // decision (weeks in 2026-08, units in 2026-09) and this test is about
      // review_draft bundling facts at all.
      expect(Object.keys(facts.nodesByType).length).toBeGreaterThan(0);
      expect(facts.nodesByType.Lesson).toBeGreaterThan(0);
      expect(facts.containers.length).toBeGreaterThan(0);
      expect(Array.isArray(facts.contentMultiParent)).toBe(true);
      expect(typeof res.instruction).toBe("string");
    });
  });

  it("review_draft omits the guide when includeGuide is false", async () => {
    await inContext(maths, CURATOR, async () => {
      const withGuide = await reviewDraft(true);
      const without = await reviewDraft(false);

      expect(String(withGuide.guide)).toContain("Coverage expectations");
      expect(without.guide).toBeUndefined();
      // hasGuide still reports the truth — only the payload is skipped.
      expect(without.hasGuide).toBe(true);
      expect(String(without.guideOmitted)).toMatch(/get_graph_guide/);

      // The expensive half is the guide; the facts must still be there.
      expect(without.structuralFacts).toBeDefined();
      // The guide is roughly half of this response (measured ~20KB of ~42KB).
      const size = (v: unknown) => JSON.stringify(v).length;
      expect(size(without)).toBeLessThan(size(withGuide) * 0.6);
    });
  });

  it("review_draft omits empty child histograms and zero assessment counts", async () => {
    await inContext(maths, CURATOR, async () => {
      const facts = (await reviewDraft()).structuralFacts as {
        containers: Array<Record<string, unknown>>;
      };
      // "absent" means "empty" — a container never carries an empty axis object
      // or an assessmentChildren:0, which was a third of this payload.
      for (const container of facts.containers) {
        expect(container.hasPartChildrenByType).not.toEqual({});
        expect(container.hasChildChildrenByType).not.toEqual({});
        expect(container.assessmentChildren).not.toBe(0);
      }
      // ...but the ones that DO have children still report them.
      const populated = facts.containers.filter((c) => c.hasPartChildrenByType || c.hasChildChildrenByType);
      expect(populated.length).toBe(facts.containers.length);
    });
  });

  it("review_draft reviews an open draft, and gates it for a non-curator", async () => {
    await store.createDraft(kgNamespace(maths.workspace, maths.grade, maths.subject));
    await inContext(maths, CURATOR, async () => {
      expect((await reviewDraft()).reviewing).toBe("draft");
    });
    await inContext(maths, UNKNOWN, async () => {
      expect(String((await reviewDraft()).error)).toMatch(/restricted/i);
    });
  });
});
