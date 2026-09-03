/*
 * Shared test harness — the store/storage/session scaffolding every suite needs.
 *
 * Before this module, ~27 suites each hand-rolled the same three things: a
 * no-op StorageAdapter, a `seedFreshStore()` that parsed every fixture graph
 * into a fresh memory store, and a `withActiveContext()` that opened a session
 * and activated a context. Eight of those seed functions were byte-identical
 * and the rest differed only in variable names, so a change to the seed shape
 * meant editing it 27 times. They all live here now.
 *
 * Two things callers should know:
 *
 *   • `seedStore()` takes an `only` filter. Seeding all three fixtures costs
 *     ~55ms and most suites assert against ci/maths alone, so a suite that
 *     names what it needs pays a fraction of that on every `beforeEach`.
 *
 *   • Suites that need bespoke data (a catalog namespace, an extra rubric
 *     subtree) seed the baseline here and layer their own writes on the
 *     returned store — the harness deliberately stays out of that business.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { listAvailableContexts, newSessionState, runInSession, type ActiveContext } from "../context/index.js";
import { resolveAdapter, getRegisteredProfile, getRegisteredGuide } from "../adapters/index.js";
import { serializeModel, __clearModelCache } from "../curriculum/index.js";
import { createMemoryKgStore, kgNamespace, parseNamespace } from "../kg-store/index.js";
import { __setStorageForTest } from "../storage/index.js";
import { __setActorForTest, type Actor } from "../actor.js";
import { activateContext } from "../activate.js";
import { subjectDir, KG_FIXTURE } from "./fixtures.js";
import type { KgNodeStore, StoredConfig, StoredMeta, Slot } from "../kg-store/index.js";
import type { StorageAdapter, HistoryFile } from "../types.js";

// ── Storage stub ─────────────────────────────────────────────────────────────

const emptyHistory: HistoryFile = { version: 4, entries: [] };

// A StorageAdapter that answers everything with an empty/no-op result. The KG
// suites never assert on the bucket; they only need document tools not to blow
// up. Suites that DO assert on storage build their own and pass it to
// `installFakeStorage`.
export const fakeStorage: StorageAdapter = {
  listDocuments: async () => [],
  getObjectMd5: async () => null,
  downloadDocx: async () => Buffer.from(""),
  createUploadUrl: async () => ({ url: "", objectKey: "", contentType: "", expiresAt: "" }),
  createDownloadUrl: async () => ({ url: "", objectKey: "", expiresAt: "", exists: false }),
  readHistory: async () => emptyHistory,
  writeHistory: async () => {},
};

// Install the stub for the current file. Call from `beforeAll`.
export function installFakeStorage(storage: StorageAdapter = fakeStorage): void {
  __setStorageForTest(storage);
}

// ── Standard actors ──────────────────────────────────────────────────────────
// The roles the authz layer distinguishes, one canonical actor each. A suite
// that asserts on a SPECIFIC actor id (audit attribution, membership routing)
// should still declare its own — these are for the common "who is calling" case.

export const CURATOR: Actor = { id: "curator-uid", email: "curator@test", role: "curator", unknown: false };
export const APPROVER: Actor = { id: "approver-uid", email: "approver@test", role: "approver", unknown: false };
export const SIGNED_IN_NO_ROLE: Actor = { id: "guest-uid", email: "guest@test", unknown: false };
export const UNKNOWN: Actor = { id: "anon", unknown: true };
export const SUPER_ADMIN: Actor = { id: "super-uid", email: "super@test", superAdmin: true, unknown: false };

// ── Seeding ──────────────────────────────────────────────────────────────────

/** Name one fixture context, e.g. `"ci/maths"`. */
export type ContextKey = string;

export const contextKey = (c: { grade: string; subject: string }): ContextKey => `${c.grade}/${c.subject}`;

export type SeedOptions = {
  // Which fixture contexts to seed. Omit to seed every one — correct but the
  // slow default; name what the suite actually asserts on where you can.
  only?: ContextKey[];
  // Also write each context's profile config cell, the way a real namespace
  // carries one. Only the profile/config suites need it.
  withProfiles?: boolean;
};

// The profile record a context would carry in its published config cell.
function profileRecordFor(workspace: string, grade: string, subject: string): StoredConfig {
  const core = getRegisteredProfile(workspace, grade, subject);
  const guide = getRegisteredGuide(workspace, grade, subject);
  return guide !== undefined ? { core, guide } : { core };
}

// The fixture contexts a suite asked for, in fixture order.
export function seededContexts(only?: ContextKey[]): ActiveContext[] {
  const all = listAvailableContexts();
  if (!only) return all;
  const wanted = new Set(only);
  return all.filter((c) => wanted.has(contextKey(c)));
}

// Build a fresh memory store holding the requested fixture contexts, each
// published on slot "a". Returns the store so a suite can layer extra
// namespaces (a catalog library, a document spine) on top before injecting it.
export async function seedStore(options: SeedOptions = {}): Promise<KgNodeStore> {
  // The hydrated-model cache is process-wide and survives a store swap, so a
  // fresh store must start from a cold cache.
  __clearModelCache();
  const store = createMemoryKgStore();
  for (const { workspace, grade, subject } of seededContexts(options.only)) {
    const adapter = resolveAdapter(workspace, grade, subject);
    if (!adapter) continue;

    const raw = JSON.parse(readFileSync(resolve(subjectDir(workspace, grade, subject), KG_FIXTURE), "utf8"));
    const namespace = kgNamespace(workspace, grade, subject);
    const { nodes, edges } = serializeModel(adapter.parse(raw), namespace);
    const meta: StoredMeta = {
      contentHash: createHash("sha256").update(JSON.stringify({ nodes, edges })).digest("hex"),
      seededAt: "1970-01-01T00:00:00Z",
      adapterId: adapter.id,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    };

    await store.writeSlot(namespace, "a", { nodes, edges, meta });
    if (options.withProfiles && getRegisteredProfile(workspace, grade, subject)) {
      await store.writeConfig(namespace, "a", profileRecordFor(workspace, grade, subject));
    }
    await store.ensurePointer(namespace, "a");
  }
  return store;
}

// ── Sessions ─────────────────────────────────────────────────────────────────

// Run `fn` in a fresh session with `actor` signed in and `context` active — the
// shape every tool call arrives in. Throws on a failed activation rather than
// letting the suite fail later on a confusing empty read.
export async function withActiveContext<T>(
  context: ActiveContext,
  actor: Actor | null,
  fn: () => Promise<T>,
): Promise<T> {
  return runInSession(newSessionState(), async () => {
    __setActorForTest(actor ?? null);
    const activation = await activateContext(context.workspace, context.grade, context.subject);
    if (!activation.ok) throw new Error(`activate ${contextKey(context)}: ${activation.error}`);
    return fn();
  });
}

// The fixture context a suite works in, by key — `ciMaths()` being the common one.
export function fixtureContext(key: ContextKey): ActiveContext {
  const found = listAvailableContexts().find((c) => contextKey(c) === key);
  if (!found) throw new Error(`no fixture context '${key}'`);
  return found;
}

export const CI_MATHS: ContextKey = "ci/maths";
export const CE1_READING: ContextKey = "ce1/reading";

// ── Picking a node out of a fixture ──────────────────────────────────────────

/** A grouping node as the suites use it: enough to edit, rename or reposition. */
export type FixtureGrouping = { id: string; title: string; order: number; kind: string };

/**
 * The first content grouping in a namespace, whatever the subject calls it.
 *
 * Five suites used to hard-code `groupName === "Chapitre"`. ci/maths retired its
 * 25 chapters when the Student's Book became a TeachingLearningMaterial, so
 * those finders all returned undefined and ~137 tests failed on the refreshed
 * fixture. Keyed on the LC label instead, this works for a week (ci/maths today)
 * or a chapter alike — a suite that only needs "a grouping to edit" should use
 * it and stay out of the subject's vocabulary. A suite that genuinely tests
 * CHAPTER semantics wants `chapterFixtureGraph()` below, not this.
 */
export async function aContentGrouping(
  store: KgNodeStore,
  namespace: string,
  slot: Slot = "a",
): Promise<FixtureGrouping> {
  const nodes = await store.listNodes(namespace, slot);
  const grouping = nodes.find((node) => (node.labels ?? []).includes("LessonGrouping"));
  if (!grouping) {
    throw new Error(`fixture '${namespace}' holds no LessonGrouping to pick`);
  }
  const properties = (grouping.properties ?? {}) as Record<string, unknown>;
  return {
    id: grouping.id,
    title: String(properties.title ?? ""),
    order: Number(properties.order ?? 0),
    kind: String(grouping.type ?? ""),
  };
}

/**
 * Replace `namespace`'s published slot with the synthetic chapter graph.
 *
 * For suites testing mechanics the live curriculum can no longer exercise (a
 * `Chapitre` grouping; an Activity contained by a Lesson while aligned to a
 * standard). The context and adapter stay the same — only the data changes — so
 * the suite still runs through the real parse and the real tools.
 */
export async function seedSyntheticChapters(store: KgNodeStore, namespace: string): Promise<void> {
  const { chapterFixtureGraph } = await import("./synthetic.js");
  const [{ workspace, grade, subject }] = [parseNamespace(namespace) ?? { workspace: "senegal", grade: "ci", subject: "maths" }];
  const adapter = resolveAdapter(workspace, grade, subject);
  if (!adapter) throw new Error(`no adapter for '${namespace}'`);

  const { nodes, edges } = serializeModel(adapter.parse(chapterFixtureGraph()), namespace);
  const meta: StoredMeta = {
    contentHash: createHash("sha256").update(JSON.stringify({ nodes, edges })).digest("hex"),
    seededAt: "1970-01-01T00:00:00Z",
    adapterId: adapter.id,
    nodeCount: nodes.length,
    edgeCount: edges.length,
  };
  __clearModelCache();
  await store.writeSlot(namespace, "a", { nodes, edges, meta });
  await store.ensurePointer(namespace, "a");
}
