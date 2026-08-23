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
      expect(facts.nodesByType.Chapitre).toBeGreaterThan(0);
      expect(facts.nodesByType.Lesson).toBeGreaterThan(0);
      expect(facts.containers.length).toBeGreaterThan(0);
      expect(Array.isArray(facts.contentMultiParent)).toBe(true);
      expect(typeof res.instruction).toBe("string");
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
