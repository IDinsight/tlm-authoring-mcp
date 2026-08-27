/*
 * CE1 reading — content layer via the GENERIC verbs, end to end
 *
 * Drives add_node / set_content through the two-phase framework on the REAL
 * reading seed, then proves the read projection (buildSlice, via
 * buildGenerationContext) surfaces the authored content. The verbs carry no
 * subject vocabulary: `add_node` with an LC `label` derives the node's identity
 * from the graph (or canonical LC defaults for reading's first Activity).
 *
 * The invariant under test: what a curator stages is what a draft read shows —
 * an Activity under a session Lesson (hasPart), its Material carrying the
 * scripted content (raw.content), and both reachable from the week's slice.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { seedStore, fakeStorage, CE1_READING } from "../../__tests__/index.js";
import { subjectDir, KG_FIXTURE } from "../../__tests__/index.js";
import { resolveAdapter } from "../index.js";
import { toRawEnvelope } from "../../curriculum/index.js";
import {
  __setKgStoreForTest, kgNamespace,
  runGraphMutation, mintNodeId, edgeId as makeEdgeId,
  __resetMutationsForTest, __resetDraftTokensForTest,
} from "../../kg-store/index.js";
import { addNode, setContent } from "../../kg-recipes/index.js";
import { __setStorageForTest } from "../../storage/index.js";
import { __setActorForTest, type Actor } from "../../actor.js";
import type { MutationGraph, GraphMutation, StoredMeta, KgNodeStore } from "../../kg-store/index.js";
import type { StorageAdapter, HistoryFile, CurriculumModel } from "../../types.js";

const HAS_PART = "hasPart"; // canonical LC content containment


const CURATOR: Actor = { id: "curator-uid", email: "curator@test", role: "curator", unknown: false };

let store: KgNodeStore;
// The fixture contexts this suite asserts against — seeding only these
// keeps each beforeEach off the graphs it never reads.
const SEED_CONTEXTS = [CE1_READING];
const ns = kgNamespace("ce1", "reading");
const adapter = () => resolveAdapter("senegal", "ce1", "reading")!;

async function seedFreshStore(): Promise<KgNodeStore> {
  return seedStore({ only: SEED_CONTEXTS });
}

const strip = <T extends { slot?: unknown }>(record: T) => { const { slot: _s, ...rest } = record; return rest; };
async function readSlot(slot: "a" | "b"): Promise<MutationGraph> {
  const [nodes, edges] = await Promise.all([store.listNodes(ns, slot), store.listEdges(ns, slot)]);
  return { nodes: nodes.map(strip) as MutationGraph["nodes"], edges: edges.map(strip) as MutationGraph["edges"] };
}
async function readDraft(): Promise<MutationGraph> {
  const pointer = await store.readPointer(ns);
  return readSlot(pointer!.draftSlot!);
}
async function readPublished(): Promise<MutationGraph> {
  const pointer = await store.readPointer(ns);
  return readSlot(pointer!.publishedSlot);
}
const modelOf = (graph: MutationGraph): CurriculumModel => adapter().parse(toRawEnvelope({ nodes: graph.nodes, edges: graph.edges }));

async function runRecipe<A>(mutation: GraphMutation<A>, args: A) {
  const preview = await runGraphMutation({ namespace: ns, mutation, args });
  if (preview.phase !== "preview") return { preview, confirm: null };
  const confirm = await runGraphMutation({ namespace: ns, mutation, args, confirm: true, token: preview.confirmationToken });
  return { preview, confirm };
}

// Week 1's first DAY — a `Lesson` titled "Jour 1", holding that day's session
// Activities. It is the container these tests hang new content under.
function week1DayLesson(graph: MutationGraph): string {
  const model = modelOf(graph);
  const week = model.unitsOfKind("Semaine").find((w) => w.order === 1)!;
  return model.childrenOf(week.id).find((c) => c.kind === "Lesson")!.id;
}

beforeAll(() => { __setStorageForTest(fakeStorage); });
beforeEach(async () => {
  store = await seedFreshStore();
  __setKgStoreForTest(store);
  __resetMutationsForTest();
  __resetDraftTokensForTest();
  __setActorForTest(CURATOR);
});
afterAll(() => {
  __setKgStoreForTest(null);
});

describe("add_node — Activity under a day lesson", () => {
  it("adds one Activity node + a hasPart edge; identity is copied from the graph's own Activities", async () => {
    const published = await readPublished();
    const lessonId = week1DayLesson(published);
    // The day already holds its seeded sessions, so a new Activity appends after
    // them rather than landing at 1.
    const sessionsBefore = modelOf(published).childrenOf(lessonId).length;
    const activityId = mintNodeId();
    const args = { namespace: ns, parentId: lessonId, label: "Activity", newNodeId: activityId, title: "Étape 1 : Découvrir le vocabulaire", properties: { studentGroupingType: "group", timeRequired: "10 mn", educationalUse: "Instruction" } };

    const preview = await runGraphMutation({ namespace: ns, mutation: addNode, args });
    if (preview.phase !== "preview") {
      throw new Error("expected preview");
    }
    expect(preview.diff.nodes.added.map((n) => n.id)).toEqual([activityId]);
    expect(preview.diff.edges.added.map((e) => e.id)).toContain(makeEdgeId(HAS_PART, lessonId, activityId));

    const confirm = await runGraphMutation({ namespace: ns, mutation: addNode, args, confirm: true, token: preview.confirmationToken });
    expect(confirm.phase).toBe("apply");

    const node = (await readDraft()).nodes.find((n) => n.id === activityId)!;
    expect(node.type).toBe("Activity");             // kind copied from reading's seeded session Activities
    expect(node.labels).toContain("Activity");
    const raw = node.properties.raw as Record<string, unknown>;
    expect(raw.description).toBe("Étape 1 : Découvrir le vocabulaire");
    expect(raw.normalizedType).toBe("Activity");
    expect(raw.position).toBe(sessionsBefore + 1);   // reading's ordinal path — appended after the day's sessions
    expect(raw.studentGroupingType).toBe("group");
  });

  // The canonical-defaults path (no node of that label to copy) needs a label the
  // graph genuinely lacks. Reading has no Assessment — maths' bilans are the only
  // ones anywhere — so this is the live example of "first of its kind".
  it("falls back to canonical LC defaults for the first node of a label", async () => {
    const published = await readPublished();
    expect(published.nodes.some((n) => (n.labels ?? []).includes("Assessment"))).toBe(false);

    const weekId = modelOf(published).unitsOfKind("Semaine").find((w) => w.order === 1)!.id;
    const assessmentId = mintNodeId();
    const { confirm } = await runRecipe(addNode, {
      namespace: ns,
      parentId: weekId,
      label: "Assessment",
      newNodeId: assessmentId,
      title: "Évaluation de fin de semaine",
      properties: { educationalUse: "Assessment" },
    });
    expect(confirm?.phase).toBe("apply");

    const node = (await readDraft()).nodes.find((n) => n.id === assessmentId)!;
    expect(node.labels).toContain("Assessment");
    expect(node.type).toBe("Assessment");  // FALLBACK_KIND, not a lowercased label
    const raw = node.properties.raw as Record<string, unknown>;
    expect(raw.normalizedType).toBe("Assessment");
    expect(raw.educationalUse).toBe("Assessment");
    // hasPart, because an Assessment is a content label — LessonGrouping may hold one.
    expect((await readDraft()).edges.map((e) => e.id)).toContain(makeEdgeId(HAS_PART, weekId, assessmentId));
  });

  it("blocks when the parent does not exist", async () => {
    const args = { namespace: ns, parentId: "does-not-exist", label: "Activity", newNodeId: mintNodeId(), title: "x" };
    const preview = await runGraphMutation({ namespace: ns, mutation: addNode, args });
    expect(preview.phase).toBe("blocked");
    if (preview.phase === "blocked") {
      expect(preview.errors.join()).toMatch(/parent .* does not exist/i);
    }
  });
});

describe("add_node — Material + set_content; the slice surfaces them", () => {
  it("hangs a Material off an Activity with content in raw.content; buildSlice shows it", async () => {
    const lessonId = week1DayLesson(await readPublished());
    const activityId = mintNodeId();
    await runRecipe(addNode, { namespace: ns, parentId: lessonId, label: "Activity", newNodeId: activityId, title: "Étape 3 : Écouter le texte" });
    const materialId = mintNodeId();
    const content = "<p>M lit le texte 2 fois, dramatisé.</p>";
    const { confirm } = await runRecipe(addNode, { namespace: ns, parentId: activityId, label: "Material", newNodeId: materialId, properties: { content, materialType: "Core" } });
    expect(confirm?.phase).toBe("apply");

    const draft = await readDraft();
    const material = draft.nodes.find((n) => n.id === materialId)!;
    expect(material.type).toBe("Material");
    expect((material.properties.raw as Record<string, unknown>).content).toBe(content);
    expect(draft.edges.map((e) => e.id)).toContain(makeEdgeId(HAS_PART, activityId, materialId));
    // The Activity that Material hangs under is itself under the session Lesson —
    // the authored content is reachable in the draft content tree (the read is now
    // the generic course subtree via walk_graph / courseSubgraph, not a cooked slice).
    // Resolve the lesson ONCE: week1SessionLesson re-parses the whole ~2000-node
    // graph, so calling it inside the predicate below made this O(edges x parse).
    const draftDayId = week1DayLesson(draft);
    expect(draft.edges.some((e) => e.id === makeEdgeId(HAS_PART, draftDayId, activityId))).toBe(true);
  });

  it("allows a Material directly on a week grouping and on a lesson (any container)", async () => {
    const published = await readPublished();
    const weekId = modelOf(published).unitsOfKind("Semaine").find((w) => w.order === 1)!.id;
    const lessonId = week1DayLesson(published);

    expect((await runRecipe(addNode, { namespace: ns, parentId: weekId, label: "Material", newNodeId: mintNodeId(), properties: { content: "[week opening scene]", materialType: "Reference" } })).confirm?.phase).toBe("apply");
    expect((await runRecipe(addNode, { namespace: ns, parentId: lessonId, label: "Material", newNodeId: mintNodeId(), properties: { content: "[shared reading text]" } })).confirm?.phase).toBe("apply");

    const draft = await readDraft();
    const materialContents = draft.nodes.filter((n) => n.type === "Material").map((n) => (n.properties.raw as Record<string, unknown>).content);
    expect(materialContents).toContain("[week opening scene]");
    expect(materialContents).toContain("[shared reading text]");
  });

  it("set_content replaces an existing node's content, preserving everything else", async () => {
    const lessonId = week1DayLesson(await readPublished());
    const materialId = mintNodeId();
    await runRecipe(addNode, { namespace: ns, parentId: lessonId, label: "Material", newNodeId: materialId, title: "Jukki", properties: { content: "old" } });

    const { confirm } = await runRecipe(setContent, { namespace: ns, nodeId: materialId, content: "new & improved" });
    expect(confirm?.phase).toBe("apply");

    const raw = (await readDraft()).nodes.find((n) => n.id === materialId)!.properties.raw as Record<string, unknown>;
    expect(raw.content).toBe("new & improved");
    expect(raw.description).toBe("Jukki"); // title untouched
  });
});
