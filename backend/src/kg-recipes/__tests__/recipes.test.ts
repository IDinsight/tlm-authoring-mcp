// ── kg-recipes — the generic verbs, end to end on the CI-maths seed ──────────
// Replaces the old per-recipe (add_lesson/…/renumber) + lc-fidelity suites. The
// verbs carry NO subject vocabulary: add_node takes an LC label and DERIVES the
// created node's identity skeleton from the graph (an existing Lesson/chapter),
// so a created node round-trips through the parser exactly like a seeded one.
//
// Covered: add_node (create a Lesson under a chapter, aligned to an expectation;
// create a LessonGrouping), move_node (rehome along the hasPart axis, week axis
// untouched), reposition (single-node ordinal edit), set_content — each two-phase
// (dry-run = diff + token, no state change; confirm = atomic draft apply), and a
// faithful re-parse of the draft.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { seedStore, fakeStorage, CI_MATHS, seedSyntheticChapters, SYNTHETIC_IDS } from "../../__tests__/index.js";
import { subjectDir, KG_FIXTURE } from "../../__tests__/index.js";
import { resolveAdapter } from "../../adapters/index.js";
import { toRawEnvelope } from "../../curriculum/index.js";
import {
  __setKgStoreForTest, kgNamespace,
  runGraphMutation, mintNodeId, edgeId as makeEdgeId,
  __resetMutationsForTest, __resetDraftTokensForTest,
} from "../../kg-store/index.js";
import { addNode, moveNode, reposition, setContent, editNode, editNodes } from "../index.js";
import { __setStorageForTest } from "../../storage/index.js";
import { __setActorForTest, type Actor } from "../../actor.js";
import type { MutationGraph, GraphMutation, StoredMeta, KgNodeStore } from "../../kg-store/index.js";
import type { StorageAdapter, HistoryFile, CurriculumModel } from "../../types.js";

const HAS_PART = "hasPart";
const ALIGN = "hasEducationalAlignment";

const CURATOR: Actor = { id: "curator-uid", email: "curator@test", role: "curator", unknown: false };

let store: KgNodeStore;
// The fixture contexts this suite asserts against — seeding only these
// keeps each beforeEach off the graphs it never reads.
const SEED_CONTEXTS = [CI_MATHS];
const ns = kgNamespace("ci", "maths");
const adapter = () => resolveAdapter("senegal", "ci", "maths")!;

async function seedFreshStore(): Promise<KgNodeStore> {
  return seedStore({ only: SEED_CONTEXTS });
}

const strip = <T extends { slot?: unknown }>(record: T) => {
  const { slot: _slot, ...rest } = record;
  return rest;
};
async function readSlot(slot: "a" | "b"): Promise<MutationGraph> {
  const [nodes, edges] = await Promise.all([store.listNodes(ns, slot), store.listEdges(ns, slot)]);
  return { nodes: nodes.map(strip) as MutationGraph["nodes"], edges: edges.map(strip) as MutationGraph["edges"] };
}
async function readPublished(): Promise<MutationGraph> {
  const pointer = await store.readPointer(ns);
  return readSlot(pointer!.publishedSlot);
}
async function readDraft(): Promise<MutationGraph | null> {
  const pointer = await store.readPointer(ns);
  return pointer?.draftSlot ? readSlot(pointer.draftSlot) : null;
}
const modelOf = (graph: MutationGraph): CurriculumModel => adapter().parse(toRawEnvelope({ nodes: graph.nodes, edges: graph.edges }));

async function runRecipe<A>(mutation: GraphMutation<A>, args: A) {
  const preview = await runGraphMutation({ namespace: ns, mutation, args });
  if (preview.phase !== "preview") return { preview, confirm: null };
  const confirm = await runGraphMutation({ namespace: ns, mutation, args, confirm: true, token: preview.confirmationToken });
  return { preview, confirm };
}

// A chapter + some lesson + some expectation, from the published seed. Post
// two-Course split, lessons live under weeks (schedule axis), not chapters, so
// take the lesson from a week rather than the chapter.
function pick(graph: MutationGraph) {
  const model = modelOf(graph);
  // ci/maths retired its chapters with the Student's Book, so the "chapter" here
  // is just a second grouping to move things between — take the first week.
  const week = model.unitsOfKind("Semaine").find((candidate) => model.childrenOf(candidate.id).some((child) => child.kind === "Lesson"))!;
  const chapter = model.unitsOfKind("Semaine").sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
  const lesson = model.childrenOf(week.id).find((child) => child.kind === "Lesson")!;
  // A standard's kind is its statementType (many values); find one by its
  // structural class instead (a leaf SFI is normalizedStatementType "Standard").
  const expectation = [...model.byId.values()].find((u) => u.properties.normalizedStatementType === "Standard")!;
  return { chapterId: chapter.id, lessonId: lesson.id, expectationId: expectation.id };
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

describe("add_node", () => {
  it("creates a Lesson under a chapter, aligned to an expectation; identity copied from an existing lesson", async () => {
    const published = await readPublished();
    const { chapterId, expectationId } = pick(published);
    const lessonId = mintNodeId();
    const args = { namespace: ns, parentId: chapterId, label: "Lesson", newNodeId: lessonId, title: "Nouvelle leçon", alignTo: expectationId };

    const preview = await runGraphMutation({ namespace: ns, mutation: addNode, args });
    if (preview.phase !== "preview") throw new Error("expected preview");
    expect(preview.diff.nodes.added.map((node) => node.id)).toEqual([lessonId]);
    const added = preview.diff.edges.added.map((edge) => edge.id);
    expect(added).toContain(makeEdgeId(HAS_PART, chapterId, lessonId));   // containment
    expect(added).toContain(makeEdgeId(ALIGN, lessonId, expectationId));  // alignment
    expect(await readDraft()).toBeNull(); // dry-run stages nothing

    const confirm = await runGraphMutation({ namespace: ns, mutation: addNode, args, confirm: true, token: preview.confirmationToken });
    expect(confirm.phase).toBe("apply");

    const draft = (await readDraft())!;
    const node = draft.nodes.find((candidate) => candidate.id === lessonId)!;
    expect(node.type).toBe("Lesson");
    expect(node.labels).toContain("Lesson");
    const raw = node.properties.raw as Record<string, any>;
    expect(raw.normalizedType).toBe("Lesson");
    expect(raw.metadata.order).toBe(node.properties.order); // maths' ordinal path, mirrored to normalized order
    // Faithful re-parse: the new lesson shows up under its chapter, aligned.
    const model = modelOf(draft);
    expect(model.childrenOf(chapterId).some((child) => child.id === lessonId && child.kind === "Lesson")).toBe(true);
  });

  it("creates a LessonGrouping (chapter) that re-parses as a chapter", async () => {
    const published = await readPublished();
    // Attach under the Course content root — the canonical parent the chapters
    // now hang under (Course --hasPart--> LessonGrouping). The Course is a
    // non-spine node, so it isn't in the parsed model; find it by LC label.
    const root = published.nodes.find((node) => (node.labels ?? []).includes("Course"))!.id;
    const groupingId = mintNodeId();
    const { confirm } = await runRecipe(addNode, { namespace: ns, parentId: root, label: "LessonGrouping", newNodeId: groupingId, title: "Chapitre neuf", properties: { groupName: "Chapitre" } });
    expect(confirm?.phase).toBe("apply");

    const node = (await readDraft())!.nodes.find((candidate) => candidate.id === groupingId)!;
    expect(node.labels).toContain("LessonGrouping");
    // Grouping-ness is label-driven now — no borrowed SFI `normalizedStatementType`.
    expect((node.properties.raw as any).normalizedStatementType).toBeUndefined();
    expect((node.properties.raw as any).groupName).toBe("Chapitre");
    expect(node.properties.title).toBe("Chapitre neuf"); // parsed as a grouping ⇒ name in `title`
  });

  it("blocks a nonexistent parent and a non-SFI alignTo", async () => {
    const { chapterId } = pick(await readPublished());
    const bad = await runGraphMutation({ namespace: ns, mutation: addNode, args: { namespace: ns, parentId: "nope", label: "Lesson", newNodeId: mintNodeId() } });
    expect(bad.phase).toBe("blocked");
    const badAlign = await runGraphMutation({ namespace: ns, mutation: addNode, args: { namespace: ns, parentId: chapterId, label: "Lesson", newNodeId: mintNodeId(), alignTo: chapterId } });
    expect(badAlign.phase).toBe("blocked");
    if (badAlign.phase === "blocked") expect(badAlign.errors.join()).toMatch(/StandardsFrameworkItem|standard/i);
  });
});

describe("typed-add core behaviors (boilerplate, supports direction, root node)", () => {
  it("copies LC boilerplate from a sibling and stamps raw.identifier", async () => {
    const published = await readPublished();
    const { chapterId } = pick(published);
    const lessonId = mintNodeId();
    const { confirm } = await runRecipe(addNode, { namespace: ns, parentId: chapterId, label: "Lesson", newNodeId: lessonId, title: "Leçon" });
    expect(confirm?.phase).toBe("apply");
    const raw = (await readDraft())!.nodes.find((node) => node.id === lessonId)!.properties.raw as Record<string, any>;
    // Boilerplate a seeded maths Lesson carries, copied onto the created one.
    expect(raw.license).toBe("https://creativecommons.org/licenses/by/4.0/");
    expect(raw.provider).toBe("Learning Commons ontology (generated)");
    expect(raw.academicSubject).toBe("Mathematics");
    expect(raw.attributionStatement).toBeTruthy();
    expect(raw.identifier).toBe(lessonId);
  });

  it("attaches a LearningComponent to its SFI via `supports` (child→parent direction)", async () => {
    const published = await readPublished();
    const sfi = published.nodes.find((node) => (node.labels ?? []).includes("StandardsFrameworkItem"))!.id;
    const compId = mintNodeId();
    const { confirm } = await runRecipe(addNode, { namespace: ns, parentId: sfi, label: "LearningComponent", newNodeId: compId, title: "Sait compter" });
    expect(confirm?.phase).toBe("apply");
    const draft = (await readDraft())!;
    // supports points component → SFI (new node is the source), not parent → child.
    expect(draft.edges.some((edge) => edge.id === makeEdgeId("supports", compId, sfi))).toBe(true);
    expect(draft.edges.some((edge) => edge.id === makeEdgeId("supports", sfi, compId))).toBe(false);
  });

  it("authors an InstructionalRoutine onto a Lesson via `usesRoutine`", async () => {
    const { lessonId } = pick(await readPublished());
    const routineId = mintNodeId();
    // A routine ROOT attaches to its lesson by the reference edge, not hasPart.
    const { confirm } = await runRecipe(addNode, { namespace: ns, parentId: lessonId, label: "InstructionalRoutine", newNodeId: routineId, title: "Fiche de leçon", via: "usesRoutine" });
    expect(confirm?.phase).toBe("apply");

    const draft = (await readDraft())!;
    const node = draft.nodes.find((candidate) => candidate.id === routineId)!;
    expect(node.type).toBe("InstructionalRoutine");
    expect(node.labels).toContain("InstructionalRoutine");
    // Linked by usesRoutine (lesson → routine), and NOT folded into containment.
    expect(draft.edges.some((edge) => edge.id === makeEdgeId("usesRoutine", lessonId, routineId))).toBe(true);
    expect(draft.edges.some((edge) => edge.id === makeEdgeId(HAS_PART, lessonId, routineId))).toBe(false);
  });

  it("creates a root Course with NO parentId and NO containment edge", async () => {
    const courseId = mintNodeId();
    const { confirm } = await runRecipe(addNode, { namespace: ns, label: "Course", newNodeId: courseId, title: "Cahier d'activités" });
    expect(confirm?.phase).toBe("apply");
    const draft = (await readDraft())!;
    expect(draft.nodes.some((node) => node.id === courseId && (node.labels ?? []).includes("Course"))).toBe(true);
    // No incoming containment edge — it is a root.
    expect(draft.edges.some((edge) => edge.to === courseId && (edge.type === "hasPart" || edge.type === "hasChild"))).toBe(false);
  });
});

describe("move_node + reposition + set_content", () => {
  it("move_node rehomes an activity along hasPart, leaving its alignment (hasEducationalAlignment) axis intact", async () => {
    // Canonical nesting: chapter ▸ Lesson ▸ Activity. From the SYNTHETIC graph:
    // ci/maths has no Activity under a Lesson any more (its illustrative tasks
    // align outward and are contained by nothing), so the shape this mechanic
    // needs has to be built.
    await seedSyntheticChapters(store, ns);
    const published = await readPublished();
    const model = modelOf(published);
    const fromLesson = model.byId.get(SYNTHETIC_IDS.lessonA)!;
    const toLesson = model.byId.get(SYNTHETIC_IDS.lessonB)!;
    const activity = model.childrenOf(fromLesson.id).find((child) => child.kind === "Activity")!;
    const alignEdges = published.edges.filter((edge) => edge.type === "hasEducationalAlignment" && edge.from === activity.id).map((edge) => edge.id);
    expect(alignEdges.length).toBeGreaterThan(0);

    const { confirm } = await runRecipe(moveNode, { namespace: ns, nodeId: activity.id, toParentId: toLesson.id });
    expect(confirm?.phase).toBe("apply");
    const draft = (await readDraft())!;
    expect(draft.edges.some((edge) => edge.id === makeEdgeId(HAS_PART, toLesson.id, activity.id))).toBe(true);
    expect(draft.edges.some((edge) => edge.id === makeEdgeId(HAS_PART, fromLesson.id, activity.id))).toBe(false);
    for (const id of alignEdges) expect(draft.edges.some((edge) => edge.id === id)).toBe(true); // alignment axis untouched
  });

  it("reposition sets one node's ordinal without touching anything else", async () => {
    const { chapterId } = pick(await readPublished());
    const { confirm } = await runRecipe(reposition, { namespace: ns, nodeId: chapterId, position: 99 });
    expect(confirm?.phase).toBe("apply");
    const node = (await readDraft())!.nodes.find((candidate) => candidate.id === chapterId)!;
    expect(node.properties.order).toBe(99);
    expect((node.properties.raw as any).metadata.order).toBe(99); // maths mirror path
  });

  it("set_content writes raw.content on any node", async () => {
    const { lessonId } = pick(await readPublished());
    const { confirm } = await runRecipe(setContent, { namespace: ns, nodeId: lessonId, content: "scripted body" });
    expect(confirm?.phase).toBe("apply");
    const node = (await readDraft())!.nodes.find((candidate) => candidate.id === lessonId)!;
    expect((node.properties.raw as any).content).toBe("scripted body");
  });
});

describe("edit-node (the per-node engine behind edit_nodes — replaced reposition + set_content, adds title)", () => {
  it("edits content + position + title in ONE apply / one audit record", async () => {
    const { lessonId } = pick(await readPublished());
    const { confirm } = await runRecipe(editNode, { namespace: ns, nodeId: lessonId, content: "new body", position: 42, title: "Nouveau titre" });
    expect(confirm?.phase).toBe("apply");

    const node = (await readDraft())!.nodes.find((candidate) => candidate.id === lessonId)!;
    expect((node.properties.raw as any).content).toBe("new body");
    expect(node.properties.order).toBe(42);
    expect((node.properties.raw as any).metadata.order).toBe(42);   // maths ordinal mirror
    // A Lesson is a content leaf, so its display name lives in `text` (+ raw.description).
    expect(node.properties.text).toBe("Nouveau titre");
    expect((node.properties.raw as any).description).toBe("Nouveau titre");

    // One combined mutation → exactly one apply record.
    const applyRecords = await store.listAudit({ namespace: ns, eventType: "apply" });
    expect(applyRecords.length).toBe(1);
  });

  it("writes a grouping's title into the `title` field (not `text`)", async () => {
    const { chapterId } = pick(await readPublished());
    const { confirm } = await runRecipe(editNode, { namespace: ns, nodeId: chapterId, title: "Chapitre renommé" });
    expect(confirm?.phase).toBe("apply");
    const node = (await readDraft())!.nodes.find((candidate) => candidate.id === chapterId)!;
    expect(node.properties.title).toBe("Chapitre renommé");
  });

  /*
   * A `description` is two fields in one string: a name line, and — on a routine
   * step or a catalog entry — a body below it. `title` used to write the whole
   * thing, so an author fixing a name silently wiped the body, and prose ended
   * up duplicated into `metadata.summary` because that was the only field that
   * could be edited safely. Each half now has its own argument.
   */
  describe("editing a description that has a body under its name line", () => {
    const NAME = "Étape 2 — Écrire la lettre";
    const BODY = "**Je fais** : E écrit la lettre au tableau.\n\n**Tu fais** : les LVs reprennent.";

    /** A node whose raw.description carries a name line AND a body. */
    async function withBody(): Promise<string> {
      const { lessonId } = pick(await readPublished());
      const { confirm } = await runRecipe(editNode, {
        namespace: ns, nodeId: lessonId, title: NAME, body: BODY,
      });
      expect(confirm?.phase).toBe("apply");
      return lessonId;
    }

    const descriptionOf = async (id: string) =>
      ((await readDraft())!.nodes.find((n) => n.id === id)!.properties.raw as any).description as string;

    it("keeps the body when only the name is edited", async () => {
      const id = await withBody();
      await runRecipe(editNode, { namespace: ns, nodeId: id, title: "Étape 2 — CORRIGÉE" });
      expect(await descriptionOf(id)).toBe(`Étape 2 — CORRIGÉE\n\n${BODY}`);
    });

    it("keeps the name line when only the body is edited", async () => {
      const id = await withBody();
      await runRecipe(editNode, { namespace: ns, nodeId: id, body: "Un script entièrement réécrit." });
      expect(await descriptionOf(id)).toBe(`${NAME}\n\nUn script entièrement réécrit.`);
    });

    it("removes the body on an empty string, keeping the name line", async () => {
      const id = await withBody();
      await runRecipe(editNode, { namespace: ns, nodeId: id, body: "" });
      expect(await descriptionOf(id)).toBe(NAME);
    });

    it("puts only the NAME in the normalized display field, never the body", async () => {
      const id = await withBody();
      const node = (await readDraft())!.nodes.find((n) => n.id === id)!;
      expect(node.properties.text).toBe(NAME);
    });

    it("refuses a multi-line title and points at `body`", async () => {
      const { lessonId } = pick(await readPublished());
      const { preview } = await runRecipe(editNode, {
        namespace: ns, nodeId: lessonId, title: "Un nom\n\net un corps",
      });
      expect(JSON.stringify(preview)).toMatch(/single line.*'body'/);
    });
  });

  it("writes a summary into raw.metadata.summary (a routine/formatter's blurb)", async () => {
    const { lessonId } = pick(await readPublished());
    const { confirm } = await runRecipe(editNode, { namespace: ns, nodeId: lessonId, summary: "Résumé transversal en **markdown**." });
    expect(confirm?.phase).toBe("apply");
    const node = (await readDraft())!.nodes.find((candidate) => candidate.id === lessonId)!;
    expect((node.properties.raw as any).metadata.summary).toBe("Résumé transversal en **markdown**.");
  });

  it("amends an arbitrary raw prop via the properties bag, nested-merging beside siblings", async () => {
    const { lessonId } = pick(await readPublished());
    const { confirm } = await runRecipe(editNode, {
      namespace: ns,
      nodeId: lessonId,
      properties: { "metadata.assemblyGuide": "Assemble ordre A→B." },
    });
    expect(confirm?.phase).toBe("apply");
    const node = (await readDraft())!.nodes.find((candidate) => candidate.id === lessonId)!;
    const raw = node.properties.raw as Record<string, any>;
    expect(raw.metadata.assemblyGuide).toBe("Assemble ordre A→B.");
    // Nested-merge: writing metadata.assemblyGuide leaves metadata.order intact.
    expect(raw.metadata.order).toBeDefined();
  });

  it("blocks a properties bag that targets a protected identity or mirrored path", async () => {
    const { lessonId } = pick(await readPublished());
    const identity = await runRecipe(editNode, { namespace: ns, nodeId: lessonId, properties: { normalizedType: "Lesson" } });
    expect(identity.preview.phase).toBe("blocked");
    // An ancestor object that would clobber a protected leaf is refused too.
    const clobber = await runRecipe(editNode, { namespace: ns, nodeId: lessonId, properties: { metadata: { role: "x" } } });
    expect(clobber.preview.phase).toBe("blocked");
    // A mirrored field must go through its dedicated argument, not the bag.
    const mirrored = await runRecipe(editNode, { namespace: ns, nodeId: lessonId, properties: { position: 5 } });
    expect(mirrored.preview.phase).toBe("blocked");
  });

  it("blocks when no field is provided", async () => {
    const { lessonId } = pick(await readPublished());
    const { preview } = await runRecipe(editNode, { namespace: ns, nodeId: lessonId });
    expect(preview.phase).toBe("blocked");
  });

  it("blocks empty content and a nonexistent node", async () => {
    const { lessonId } = pick(await readPublished());
    const emptyContent = await runRecipe(editNode, { namespace: ns, nodeId: lessonId, content: "" });
    expect(emptyContent.preview.phase).toBe("blocked");
    const missing = await runRecipe(editNode, { namespace: ns, nodeId: "does-not-exist", title: "x" });
    expect(missing.preview.phase).toBe("blocked");
  });
});

describe("edit_nodes (the batch tool — one dry-run, one confirm, one audit record)", () => {
  it("applies a DIFFERENT edit to each node in one apply / one audit record", async () => {
    const { lessonId, chapterId } = pick(await readPublished());
    const { confirm } = await runRecipe(editNodes, {
      namespace: ns,
      items: [
        { nodeId: lessonId, content: "corps réécrit", position: 7 },
        { nodeId: chapterId, title: "Semaine renommée" },
      ],
    });
    expect(confirm?.phase).toBe("apply");

    const draft = (await readDraft())!;
    const lesson = draft.nodes.find((candidate) => candidate.id === lessonId)!;
    expect((lesson.properties.raw as any).content).toBe("corps réécrit");
    expect(lesson.properties.order).toBe(7);
    // A grouping's display name lives in `title`, a leaf's in `text` — each item
    // is routed by its OWN node's label, not by the batch.
    expect(draft.nodes.find((candidate) => candidate.id === chapterId)!.properties.title).toBe("Semaine renommée");

    // The whole batch is ONE mutation, so it leaves exactly one apply record.
    expect((await store.listAudit({ namespace: ns, eventType: "apply" })).length).toBe(1);
  });

  it("applies the SAME edit across several nodes (the bulk pass)", async () => {
    const published = await readPublished();
    const model = modelOf(published);
    const lessonIds = model.unitsOfKind("Lesson").slice(0, 3).map((lesson) => lesson.id);
    expect(lessonIds.length).toBe(3);

    const { confirm } = await runRecipe(editNodes, {
      namespace: ns,
      items: lessonIds.map((nodeId) => ({ nodeId, properties: { "metadata.assemblyGuide": "Même consigne partout." } })),
    });
    expect(confirm?.phase).toBe("apply");

    const draft = (await readDraft())!;
    for (const id of lessonIds) {
      const raw = draft.nodes.find((candidate) => candidate.id === id)!.properties.raw as Record<string, any>;
      expect(raw.metadata.assemblyGuide).toBe("Même consigne partout.");
      expect(raw.metadata.order).toBeDefined();   // nested-merge, per node
    }
  });

  it("blocks the WHOLE batch when any one item is invalid — no partial apply", async () => {
    const { lessonId } = pick(await readPublished());
    const { preview } = await runRecipe(editNodes, {
      namespace: ns,
      items: [
        { nodeId: lessonId, title: "Titre valide" },
        { nodeId: "does-not-exist", title: "x" },
      ],
    });
    expect(preview.phase).toBe("blocked");
    // The item index says which one failed, without the single-node tool prefix.
    expect((preview as any).errors.join(" ")).toContain("edit_nodes[1]:");
    expect(await readDraft()).toBeNull();
  });

  it("blocks an empty batch and a node named twice", async () => {
    const { lessonId } = pick(await readPublished());
    const empty = await runRecipe(editNodes, { namespace: ns, items: [] });
    expect(empty.preview.phase).toBe("blocked");

    const twice = await runRecipe(editNodes, {
      namespace: ns,
      items: [{ nodeId: lessonId, title: "Un" }, { nodeId: lessonId, content: "Deux" }],
    });
    expect(twice.preview.phase).toBe("blocked");
    expect((twice.preview as any).errors.join(" ")).toContain("edited twice");
  });
});
