/*
 * The self-serve authoring surface (docs/design-notes/self-serve-authoring.md),
 * end to end against the seeded CI-maths store:
 *
 *   • find_node        — a NAME becomes ids, and an ambiguous one becomes a question.
 *   • check_draft      — the wiring lint, role-gated on an open draft.
 *   • start_here       — orientation with and without an active context.
 *   • create_document  — the TLM and its `covers` edge, atomically.
 *   • add_section      — both of a section's axes, atomically.
 *
 * The thread running through all of it is the one thing the design note insists
 * on: the expert never supplies an id, and the server never guesses which node
 * they meant.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { listAvailableContexts, newSessionState, runInSession } from "../../context/index.js";
import { subjectDir, KG_FIXTURE } from "../../__tests__/index.js";
import { resolveAdapter } from "../../adapters/index.js";
import { serializeModel } from "../../curriculum/index.js";
import {
  __setKgStoreForTest, createMemoryKgStore, kgNamespace, runGraphMutation, deleteEdges,
  __resetMutationsForTest, __resetDraftTokensForTest,
} from "../../kg-store/index.js";
import { __setStorageForTest } from "../../storage/index.js";
import { __setActorForTest, type Actor } from "../../actor.js";
import { activateContext } from "../../activate.js";
import { findActiveNodes } from "../graph.js";
import { checkDraft } from "../check.js";
import { startHere } from "../start-here.js";
import { runCreateDocument, runAddSection } from "../document-authoring.js";
import { runPublishDraft } from "../lifecycle.js";
import type { KgNodeStore, StoredMeta } from "../../kg-store/index.js";
import type { StorageAdapter, HistoryFile } from "../../types.js";

const emptyHistory: HistoryFile = { version: 3, entries: [] };
const fakeStorage: StorageAdapter = {
  listDocuments: async () => [], getObjectMd5: async () => null, downloadDocx: async () => Buffer.from(""),
  createUploadUrl: async () => ({ url: "", objectKey: "", contentType: "", expiresAt: "" }),
  createDownloadUrl: async () => ({ url: "", objectKey: "", expiresAt: "", exists: false }),
  readHistory: async () => emptyHistory, writeHistory: async () => {},
};

const CURATOR: Actor = { id: "curator-uid", email: "curator@test", role: "curator", unknown: false };
const APPROVER: Actor = { id: "approver-uid", email: "approver@test", role: "approver", unknown: false };
const NO_ROLE: Actor = { id: "guest-uid", email: "guest@test", unknown: false };

let store: KgNodeStore;
const contexts = listAvailableContexts();
const targetCtx = contexts.find((c) => c.grade === "ci" && c.subject === "maths")!;
const ns = kgNamespace(targetCtx.grade, targetCtx.subject);

async function seedFreshStore(): Promise<KgNodeStore> {
  const freshStore = createMemoryKgStore();
  for (const { workspace, grade, subject } of contexts) {
    const raw = JSON.parse(readFileSync(resolve(subjectDir(workspace, grade, subject), KG_FIXTURE), "utf8"));
    const adapter = resolveAdapter(workspace, grade, subject);
    if (!adapter) continue;
    const { nodes, edges } = serializeModel(adapter.parse(raw), kgNamespace(grade, subject));
    const meta: StoredMeta = { contentHash: "test", seededAt: "1970-01-01T00:00:00Z", adapterId: adapter.id, nodeCount: nodes.length, edgeCount: edges.length };
    await freshStore.writeSlot(kgNamespace(grade, subject), "a", { nodes, edges, meta });
    await freshStore.ensurePointer(kgNamespace(grade, subject), "a");
  }
  return freshStore;
}

async function withActiveContext<T>(actor: Actor | null, fn: () => Promise<T>): Promise<T> {
  const state = newSessionState();
  return runInSession(state, async () => {
    __setActorForTest(actor ?? null);
    const activation = await activateContext(targetCtx.workspace, targetCtx.grade, targetCtx.subject);
    if (!activation.ok) throw new Error(`activate: ${activation.error}`);
    return fn();
  });
}

// A session with an actor but NO active context — what a first call looks like.
async function withoutContext<T>(actor: Actor, fn: () => Promise<T>): Promise<T> {
  return runInSession(newSessionState(), async () => {
    __setActorForTest(actor);
    return fn();
  });
}

// Dry-run then confirm, the way a caller does. Returns the applied result.
async function confirmed(
  run: (args: Record<string, unknown>) => Promise<Record<string, unknown>>,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const preview = await run(args);
  expect(preview.phase, JSON.stringify(preview)).toBe("preview");
  const mintedNodeIds = preview.mintedNodeIds as string[] | undefined;
  return run({
    ...args,
    confirm: true,
    confirmationToken: preview.confirmationToken,
    mintedNodeId: mintedNodeIds?.[0],
  });
}

// Titles are read off the seeded store rather than hard-coded, so a re-seed
// cannot silently invalidate these tests.
const titleOf = (node: { properties?: Record<string, unknown> }): string => {
  const raw = (node.properties?.raw ?? {}) as Record<string, unknown>;
  return String(node.properties?.title ?? node.properties?.text ?? raw.description ?? "");
};

// A chapter from the fixture. Its title is deliberately NOT assumed unique: in
// CI maths every chapter shares its name with the lesson inside it, so the write
// tests below pass the `id` — which is exactly how a caller answers a
// `needsChoice`, and proves an id still resolves to itself.
async function aChapter(): Promise<{ id: string; title: string }> {
  const nodes = await store.listNodes(ns, "a");
  const chapter = nodes.find((node) =>
    (node.labels ?? []).includes("LessonGrouping") &&
    (node.properties?.raw as Record<string, unknown> | undefined)?.groupName === "Chapitre")!;
  expect(chapter, "the CI-maths fixture should hold at least one chapter").toBeTruthy();
  return { id: chapter.id, title: titleOf(chapter) };
}

// A title TWO nodes share. CI maths has these naturally — a chapter and the
// lesson inside it are often named the same — which is exactly the ambiguity the
// design note predicted an expert would hit.
async function sharedTitle(): Promise<string> {
  const nodes = await store.listNodes(ns, "a");
  const uses = new Map<string, number>();
  for (const node of nodes) {
    const title = titleOf(node);
    if (title) uses.set(title, (uses.get(title) ?? 0) + 1);
  }
  const shared = [...uses.entries()].find(([, count]) => count > 1)?.[0];
  expect(shared, "the CI-maths fixture should hold at least one duplicated title").toBeTruthy();
  return shared!;
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

describe("find_node — the expert types a name, never an id", () => {
  it("finds a chapter by its exact title, and reports where it sits", async () => {
    const chapter = await aChapter();
    const result = await withActiveContext(CURATOR, () => findActiveNodes({ query: chapter.title }));
    const matches = result.matches as Array<{ id: string; match: string; path: string[] }>;

    expect(matches.some((m) => m.id === chapter.id)).toBe(true);
    expect(matches[0].match).toBe("exact");
    // The path is what tells two identically-named chapters apart.
    expect(Array.isArray(matches[0].path)).toBe(true);
  });

  it("ignores case and accents, because the graph is French", async () => {
    const chapter = await aChapter();
    const shouted = chapter.title.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const result = await withActiveContext(CURATOR, () => findActiveNodes({ query: shouted }));
    expect((result.matches as Array<{ id: string }>).some((m) => m.id === chapter.id)).toBe(true);
  });

  it("narrows by label, so one name shared by two kinds of node resolves cleanly", async () => {
    // In CI maths a chapter and the lesson inside it carry the same title — the
    // ambiguity an expert meets on their first "le chapitre 5".
    const chapter = await aChapter();
    const all = await withActiveContext(CURATOR, () => findActiveNodes({ query: chapter.title }));
    expect((all.matches as unknown[]).length).toBeGreaterThan(1);

    const narrowed = await withActiveContext(CURATOR, () =>
      findActiveNodes({ query: chapter.title, labels: ["LessonGrouping"] }));
    const matches = narrowed.matches as Array<{ id: string; labels: string[] }>;
    expect(matches.map((m) => m.id)).toContain(chapter.id);
    expect(matches.every((m) => m.labels.includes("LessonGrouping"))).toBe(true);
  });

  it("says `ambiguous` instead of picking, when several match", async () => {
    const shared = await sharedTitle();   // "Activité 1" and friends — 100+ of them
    const result = await withActiveContext(CURATOR, () => findActiveNodes({ query: shared }));
    expect((result.matches as unknown[]).length).toBeGreaterThan(1);
    expect(result.ambiguous).toBe(true);
    expect(String(result.note)).toMatch(/Ask the user which one/);
  });

  it("explains an empty result rather than returning a bare []", async () => {
    const result = await withActiveContext(CURATOR, () => findActiveNodes({ query: "zzz-nothing-like-this" }));
    expect(result.matches).toEqual([]);
    expect(String(result.note)).toMatch(/Nothing carries this name/);
  });
});

describe("create_document — the TLM and its `covers` edge are one step", () => {
  it("creates the document AND binds it to the chosen chapter", async () => {
    const chapter = await aChapter();
    const applied = await withActiveContext(CURATOR, () =>
      confirmed(runCreateDocument as never, { name: "Fiche de révision", covers: chapter.id }));

    expect(applied.phase).toBe("apply");
    expect(applied.ok).toBe(true);

    const draftPointer = await store.readPointer(ns);
    const edges = await store.listEdges(ns, draftPointer!.draftSlot!);
    const nodes = await store.listNodes(ns, draftPointer!.draftSlot!);

    const document = nodes.find((node) => (node.labels ?? []).includes("TeachingLearningMaterial"))!;
    expect(document).toBeTruthy();
    // The whole point of the verb: the edge cannot have been forgotten.
    expect(edges.some((edge) => edge.type === "covers" && edge.from === document.id && edge.to === chapter.id)).toBe(true);
  });

  it("refuses to guess when the covered content is ambiguous — and stages nothing", async () => {
    const chapter = await aChapter();
    const result = await withActiveContext(CURATOR, () =>
      runCreateDocument({ name: "Fiche", covers: chapter.title }));

    expect(result.needsChoice).toBe(true);
    expect((result.candidates as unknown[]).length).toBeGreaterThan(1);
    expect(result.confirmationToken).toBeUndefined();
    expect((await store.readPointer(ns))!.draftSlot).toBeNull();

    // The message is one language throughout. It once mixed English prose with a
    // French label ("… (le contenu à couvrir)") because the label was a leftover
    // literal; the payload is English and the model translates, so a stray French
    // word here is a bug, not a feature.
    expect(String(result.message)).toContain("the content to cover");
    expect(String(result.message)).not.toMatch(/\b(le|la|les|des|une)\b/);
  });

  it("refuses to cover another document: only curriculum labels are searched", async () => {
    const chapter = await aChapter();
    const created = await withActiveContext(CURATOR, () =>
      confirmed(runCreateDocument as never, { name: "Manuel unique", covers: chapter.id }));
    const documentId = (created.mintedNodeIds as string[])[0];

    // By name, a document is not even a candidate (the search is narrowed to
    // curriculum labels); by id, the recipe itself blocks it.
    const byName = await withActiveContext(CURATOR, () =>
      runCreateDocument({ name: "Autre", covers: "Manuel unique" }));
    expect(String(byName.error)).toMatch(/Nothing matches/);

    const byId = await withActiveContext(CURATOR, () =>
      runCreateDocument({ name: "Autre", covers: documentId }));
    expect(byId.phase).toBe("blocked");
    expect(JSON.stringify(byId)).toMatch(/document layer/);
  });

  it("tells the caller what usually comes next", async () => {
    const chapter = await aChapter();
    const applied = await withActiveContext(CURATOR, () =>
      confirmed(runCreateDocument as never, { name: "Fiche", covers: chapter.id }));
    expect((applied.nextSteps as string[]).join(" ")).toMatch(/add_section/);
  });
});

describe("add_section — both axes, or the section is broken", () => {
  it("wires the section under its document AND onto the curriculum", async () => {
    const chapter = await aChapter();
    await withActiveContext(CURATOR, () =>
      confirmed(runCreateDocument as never, { name: "Manuel de l'élève", covers: chapter.id }));

    const applied = await withActiveContext(CURATOR, () =>
      confirmed(runAddSection as never, { document: "Manuel de l'élève", name: "Partie 1", covers: chapter.id }));
    expect(applied.ok).toBe(true);

    const pointer = await store.readPointer(ns);
    const nodes = await store.listNodes(ns, pointer!.draftSlot!);
    const edges = await store.listEdges(ns, pointer!.draftSlot!);
    const section = nodes.find((node) => (node.labels ?? []).includes("DocumentSection"))!;
    const document = nodes.find((node) => (node.labels ?? []).includes("TeachingLearningMaterial"))!;

    expect(edges.some((e) => e.type === "hasPart" && e.from === document.id && e.to === section.id)).toBe(true);
    expect(edges.some((e) => e.type === "covers" && e.from === section.id && e.to === chapter.id)).toBe(true);
  });

  it("allows a front-matter section that covers nothing", async () => {
    const chapter = await aChapter();
    await withActiveContext(CURATOR, () =>
      confirmed(runCreateDocument as never, { name: "Manuel", covers: chapter.id }));

    const applied = await withActiveContext(CURATOR, () =>
      confirmed(runAddSection as never, { document: "Manuel", name: "Page de garde" }));
    expect(applied.ok).toBe(true);
  });

  it("refuses a section under something that is not a document", async () => {
    const chapter = await aChapter();
    const blocked = await withActiveContext(CURATOR, () =>
      runAddSection({ document: chapter.id, name: "Partie 1" }));
    expect(blocked.phase).toBe("blocked");
    expect(JSON.stringify(blocked)).toMatch(/not a document/);
  });
});

describe("check_draft — mechanical wiring, in French", () => {
  it("reports a document left covering nothing, with a fix", async () => {
    // add_nodes without the covers edge is exactly the silent failure; here we
    // reproduce it by writing the TLM straight into the draft slot.
    const chapter = await aChapter();
    await withActiveContext(CURATOR, () =>
      confirmed(runCreateDocument as never, { name: "Manuel", covers: chapter.id }));

    // Unwire it the way a curator would — the very slip the rule exists to catch.
    const pointer = await store.readPointer(ns);
    const edges = await store.listEdges(ns, pointer!.draftSlot!);
    const covers = edges.find((edge) => edge.type === "covers")!;
    await withActiveContext(CURATOR, async () => {
      const args = { edgeIds: [covers.id] };
      const preview = await runGraphMutation({ namespace: ns, mutation: deleteEdges, args });
      if (preview.phase !== "preview") throw new Error(`expected preview, got ${preview.phase}`);
      await runGraphMutation({ namespace: ns, mutation: deleteEdges, args, confirm: true, token: preview.confirmationToken });
    });

    const report = await withActiveContext(CURATOR, checkDraft);
    expect(report.checking).toBe("draft");
    const findings = report.findings as Array<{ rule: string; fix: string; inThisDraft: boolean }>;
    const finding = findings.find((f) => f.rule === "document-covers-nothing")!;
    expect(finding.fix).toBeTruthy();
    expect(finding.inThisDraft).toBe(true);
    expect(String(report.summary)).toMatch(/point\(s\) to fix/);
  });

  it("reads published, and says so, when no draft is open", async () => {
    const report = await withActiveContext(CURATOR, checkDraft);
    expect(report.checking).toBe("published");
    expect(String(report.summary)).toMatch(/The published version/);
  });

  it("refuses to show an open draft to a caller with no role", async () => {
    const chapter = await aChapter();
    await withActiveContext(CURATOR, () =>
      confirmed(runCreateDocument as never, { name: "Manuel", covers: chapter.id }));

    const report = await withActiveContext(NO_ROLE, checkDraft);
    expect(report.phase).toBe("unauthorized");
  });
});

describe("publish_draft — the wiring warnings ride the dry-run", () => {
  it("shows the approver what this draft left unwired, without blocking", async () => {
    const chapter = await aChapter();
    await withActiveContext(CURATOR, () =>
      confirmed(runCreateDocument as never, { name: "Manuel", covers: chapter.id }));

    const preview = await withActiveContext(APPROVER, () => runPublishDraft({}));
    const checks = preview.checks as Array<{ rule: string }>;
    // The new document has no formatter yet — mechanical, and worth saying.
    expect(checks.some((check) => check.rule === "document-has-no-formatter")).toBe(true);
    // A warning is not a block: the token is still issued.
    expect(preview.confirmationToken).toBeTruthy();
    expect(String(preview.message)).toMatch(/structural warning/);
  });
});

describe("start_here — orientation for a person", () => {
  it("answers with the choices when no subject is selected yet", async () => {
    const result = await withoutContext(CURATOR, startHere);
    expect(result.step).toBe("choose-a-subject");
    expect((result.available as unknown[]).length).toBeGreaterThan(0);
  });

  it("reports the context, the role's powers, and the draft state", async () => {
    const result = await withActiveContext(CURATOR, startHere);
    expect(result.step).toBe("ready");
    expect(result.role).toBe("curator");
    expect((result.allowedTo as string[]).join(" ")).toMatch(/draft/);
    expect(String(result.draft)).toMatch(/no draft in progress/);
    expect((result.suggestions as string[]).join(" ")).toMatch(/find_node/);
  });

  it("notices an open draft and the unfinished work in it", async () => {
    const chapter = await aChapter();
    await withActiveContext(CURATOR, () =>
      confirmed(runCreateDocument as never, { name: "Manuel", covers: chapter.id }));

    const result = await withActiveContext(CURATOR, startHere);
    expect(String(result.draft)).toMatch(/a draft is open/);
    const unfinished = result.unfinished as Array<{ issue: string; count: number; examples: string[]; fix: string }>;
    const formatterGroup = unfinished.find((group) => /no layout rules/.test(group.issue))!;
    expect(formatterGroup).toBeTruthy();
    // The group NAMES what it is talking about — a bare count would send the
    // expert back for a second call to find out which document.
    expect(formatterGroup.count).toBeGreaterThan(0);
    expect(formatterGroup.examples.length).toBeGreaterThan(0);
    expect(formatterGroup.fix).toBeTruthy();
  });
});
