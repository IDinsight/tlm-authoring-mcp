/*
 * The generic node verbs as MCP TOOLS (server/recipes.ts), on the seeded CI-maths store.
 *
 * The suite exists because of a specific failure: `move_node` was implemented,
 * exported, documented in CLAUDE.md and advertised by get_capabilities — and
 * never registered, so every caller who followed the advertisement got "unknown
 * tool". The first case below pins the mirror to the server's REAL tool list, so
 * that drift cannot come back; the rest cover the tool's own envelope (two-phase
 * confirm, the axis it moves, the axis it leaves alone, and the refusals).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { seedStore, seededContexts, fakeStorage, CI_MATHS, withActiveContext as inContext, seedSyntheticChapters, SYNTHETIC_IDS } from "../../__tests__/index.js";
import {
  __setKgStoreForTest, kgNamespace, edgeId as makeEdgeId,
  __resetMutationsForTest, __resetDraftTokensForTest,
} from "../../kg-store/index.js";
import { RECIPES } from "../../kg-recipes/index.js";
import { __setStorageForTest } from "../../storage/index.js";
import { __setActorForTest, type Actor } from "../../actor.js";
import { buildServer } from "../index.js";
import { runMoveNode, runEditNodes } from "../recipes.js";
import { runCreateEdges } from "../structural.js";
import type { KgNodeStore, StoredNode, StoredEdge } from "../../kg-store/index.js";

const HAS_PART = "hasPart";
const ALIGN = "hasEducationalAlignment";

const CURATOR: Actor = { id: "curator-uid", email: "curator@test", role: "curator", unknown: false };
const NO_ROLE: Actor = { id: "guest-uid", email: "guest@test", unknown: false };

let store: KgNodeStore;
// The fixture contexts this suite asserts against — seeding only these
// keeps each beforeEach off the graphs it never reads.
const SEED_CONTEXTS = [CI_MATHS];
const targetCtx = seededContexts(SEED_CONTEXTS).find((c) => c.grade === "ci" && c.subject === "maths")!;
const ns = kgNamespace(targetCtx.grade, targetCtx.subject);

const withActiveContext = <T>(actor: Actor | null, fn: () => Promise<T>): Promise<T> =>
  inContext(targetCtx, actor, fn);

async function slot(which: "a" | "b"): Promise<{ nodes: StoredNode[]; edges: StoredEdge[] }> {
  const [nodes, edges] = await Promise.all([store.listNodes(ns, which), store.listEdges(ns, which)]);
  return { nodes, edges };
}
async function draft(): Promise<{ nodes: StoredNode[]; edges: StoredEdge[] } | null> {
  const pointer = await store.readPointer(ns);
  return pointer?.draftSlot ? slot(pointer.draftSlot) : null;
}

/*
 * A movable Activity: contained by one Lesson via hasPart while ALIGNED to a
 * standard, plus a second Lesson to move it to. The alignment is the "other
 * axis" every assertion below watches — it must survive a move along hasPart.
 *
 * This comes from the SYNTHETIC graph, not the curriculum: ci/maths has no
 * Activity under a Lesson any more (its 104 illustrative tasks align outward
 * and are contained by nothing), so the shape this mechanic needs has to be
 * built. Being hand-built also makes the assertions deterministic.
 */
async function movableActivity(): Promise<{ activityId: string; fromLessonId: string; toLessonId: string; alignEdgeIds: string[] }> {
  await seedSyntheticChapters(store, ns);
  const { edges } = await slot("a");
  const alignEdgeIds = edges
    .filter((edge) => edge.type === ALIGN && edge.from === SYNTHETIC_IDS.activity)
    .map((edge) => edge.id);
  expect(alignEdgeIds.length, "the synthetic graph should align its Activity").toBeGreaterThan(0);
  return {
    activityId: SYNTHETIC_IDS.activity,
    fromLessonId: SYNTHETIC_IDS.lessonA,
    toLessonId: SYNTHETIC_IDS.lessonB,
    alignEdgeIds,
  };
}


/*
 * A grouping with a grandchild, for the subtree-detaching case: moving the
 * grouping under something two levels inside it is the move that leaves a ring.
 * From the synthetic graph (chapter → lesson-a → activity), since ci/maths no
 * longer nests content that deep under a grouping.
 */
async function aSubtree(): Promise<{ chapterId: string; grandchildId: string }> {
  await seedSyntheticChapters(store, ns);
  return { chapterId: SYNTHETIC_IDS.chapter, grandchildId: SYNTHETIC_IDS.activity };
}


// The standard the most content nodes align to — the blast radius a non-containment
// `via` would have had.
async function aMuchAlignedStandard(): Promise<{ sfiId: string; alignedCount: number; anyLessonId: string }> {
  const { nodes, edges } = await slot("a");
  const incoming = new Map<string, number>();
  for (const edge of edges.filter((e) => e.type === ALIGN)) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  const [sfiId, alignedCount] = [...incoming.entries()].sort((a, b) => b[1] - a[1])[0];
  return { sfiId, alignedCount, anyLessonId: nodes.find((n) => (n.labels ?? []).includes("Lesson"))!.id };
}

beforeAll(() => { __setStorageForTest(fakeStorage); });
beforeEach(async () => {
  store = await seedFreshStore();
  __setKgStoreForTest(store);
  __resetMutationsForTest();
  __resetDraftTokensForTest();
});
afterAll(() => { __setKgStoreForTest(null); });

async function seedFreshStore(): Promise<KgNodeStore> {
  return seedStore({ only: SEED_CONTEXTS });
}

describe("get_capabilities advertises only REGISTERED tools", () => {
  it("every verb in the RECIPES mirror is a tool the server actually serves", async () => {
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), buildServer().connect(serverTransport)]);
    try {
      const served = new Set((await client.listTools()).tools.map((tool) => tool.name));
      // The whole point: advertising a verb no tool implements sends a caller to
      // an "unknown tool" error, which is exactly what move_node did.
      for (const recipe of RECIPES) {
        expect(served.has(recipe.name), `RECIPES advertises '${recipe.name}' but no tool by that name is registered`).toBe(true);
      }
      expect(served.has("move_node")).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("move_node advertises exactly the arguments the registry names, plus the shared envelope", async () => {
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), buildServer().connect(serverTransport)]);
    try {
      const tool = (await client.listTools()).tools.find((t) => t.name === "move_node")!;
      const props = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
      // The registry's params + the envelope every write shares (catalog redirect,
      // two-phase confirm). Advertised schema IS the runtime validator.
      expect(Object.keys(props).sort()).toEqual(["catalog", "confirm", "confirmationToken", "nodeId", "position", "toParentId", "via"]);
      const declared = RECIPES.find((r) => r.name === "move_node")!.params.map((p) => p.name);
      for (const param of declared) expect(props).toHaveProperty(param);
    } finally {
      await client.close();
    }
  });
});

describe("move_node — the tool envelope", () => {
  it("dry-runs to a diff + token and stages NOTHING", async () => {
    const { activityId, toLessonId } = await movableActivity();
    const preview = await withActiveContext(CURATOR, () => runMoveNode({ nodeId: activityId, toParentId: toLessonId }));

    expect(preview).toMatchObject({ phase: "preview", needsConfirmation: true });
    expect(preview.confirmationToken).toBeTruthy();
    expect(preview.nextSteps).toBeTruthy();
    expect(await draft()).toBeNull();
  });

  it("re-parents along hasPart on confirm, leaving the alignment axis intact", async () => {
    const { activityId, fromLessonId, toLessonId, alignEdgeIds } = await movableActivity();

    const applied = await withActiveContext(CURATOR, async () => {
      const preview = await runMoveNode({ nodeId: activityId, toParentId: toLessonId, position: 3 });
      return runMoveNode({ nodeId: activityId, toParentId: toLessonId, position: 3, confirm: true, confirmationToken: preview.confirmationToken as string });
    });
    expect(applied).toMatchObject({ phase: "apply", ok: true });

    const staged = (await draft())!;
    expect(staged.edges.some((e) => e.id === makeEdgeId(HAS_PART, toLessonId, activityId))).toBe(true);
    expect(staged.edges.some((e) => e.id === makeEdgeId(HAS_PART, fromLessonId, activityId))).toBe(false);
    // The other axis is not this verb's business — the alignment survives whole.
    for (const id of alignEdgeIds) expect(staged.edges.some((e) => e.id === id)).toBe(true);
    // The node's own ordinal agrees with the slot it was given.
    expect(staged.nodes.find((n) => n.id === activityId)!.properties.order).toBe(3);
  });

  it("is a DRAFT edit — published stays untouched until publish_draft", async () => {
    const { activityId, fromLessonId, toLessonId } = await movableActivity();
    await withActiveContext(CURATOR, async () => {
      const preview = await runMoveNode({ nodeId: activityId, toParentId: toLessonId });
      await runMoveNode({ nodeId: activityId, toParentId: toLessonId, confirm: true, confirmationToken: preview.confirmationToken as string });
    });
    const published = await slot((await store.readPointer(ns))!.publishedSlot);
    expect(published.edges.some((e) => e.id === makeEdgeId(HAS_PART, fromLessonId, activityId))).toBe(true);
    expect(published.edges.some((e) => e.id === makeEdgeId(HAS_PART, toLessonId, activityId))).toBe(false);
  });

  it("refuses a caller with no role, before any token is issued", async () => {
    const { activityId, toLessonId } = await movableActivity();
    const result = await withActiveContext(NO_ROLE, () => runMoveNode({ nodeId: activityId, toParentId: toLessonId }));
    expect(result.phase).toBe("unauthorized");
    expect(result.confirmationToken).toBeUndefined();
  });
});

describe("move_node — a node on TWO axes moves along ONE", () => {
  /*
   * The invariant the verb exists for, and the one the seed cannot express on its
   * own: a CI-maths lesson is filed under a chapter (hasPart) AND scheduled under
   * a week (hasChild), and re-filing it must not reschedule it. We build that
   * shape first — a second, hasChild parent on the Activity — then move along
   * each axis in turn and check the other one survives.
   */
  const giveSecondAxis = async (nodeId: string, parentId: string): Promise<void> => {
    const edges = [{ edgeType: "hasChild", fromId: parentId, toId: nodeId }];
    const preview = await runCreateEdges({ edges });
    await runCreateEdges({ edges, confirm: true, confirmationToken: preview.confirmationToken as string });
  };

  it("moving along hasPart leaves the hasChild parent in place, and vice versa", async () => {
    const { activityId, fromLessonId, toLessonId } = await movableActivity();
    const { nodes } = await slot("a");
    const groupings = nodes
      .filter((node) => (node.labels ?? []).includes("LessonGrouping") && node.id !== fromLessonId && node.id !== toLessonId)
      .map((node) => node.id);
    expect(groupings.length, "the fixture should hold two groupings to schedule against").toBeGreaterThan(1);
    const [scheduleA, scheduleB] = groupings;

    await withActiveContext(CURATOR, async () => {
      await giveSecondAxis(activityId, scheduleA);

      // Axis 1: re-file it under another Lesson. The schedule must not budge.
      const toLesson = await runMoveNode({ nodeId: activityId, toParentId: toLessonId });
      await runMoveNode({ nodeId: activityId, toParentId: toLessonId, confirm: true, confirmationToken: toLesson.confirmationToken as string });

      // Axis 2: reschedule it, naming the axis explicitly. The filing must not budge.
      const toSchedule = await runMoveNode({ nodeId: activityId, toParentId: scheduleB, via: "hasChild" });
      await runMoveNode({ nodeId: activityId, toParentId: scheduleB, via: "hasChild", confirm: true, confirmationToken: toSchedule.confirmationToken as string });
    });

    const staged = (await draft())!;
    const has = (type: string, from: string) => staged.edges.some((e) => e.id === makeEdgeId(type, from, activityId));
    expect(has(HAS_PART, toLessonId)).toBe(true);     // moved
    expect(has(HAS_PART, fromLessonId)).toBe(false);
    expect(has("hasChild", scheduleB)).toBe(true);    // rescheduled
    expect(has("hasChild", scheduleA)).toBe(false);
  });
});

describe("move_node — what it refuses to guess at", () => {
  const blockedBy = async (args: { nodeId: string; toParentId: string; via?: string }): Promise<string[]> => {
    const result = await withActiveContext(CURATOR, () => runMoveNode(args));
    expect(result.phase, JSON.stringify(result)).toBe("blocked");
    expect(result.confirmationToken).toBeUndefined();
    return result.errors as string[];
  };

  it("blocks a target parent that does not exist", async () => {
    const { activityId } = await movableActivity();
    const errors = await blockedBy({ nodeId: activityId, toParentId: "no-such-parent" });
    expect(errors.join(" ")).toContain("no-such-parent");
  });

  it("blocks a node made its own parent", async () => {
    const { activityId } = await movableActivity();
    const errors = await blockedBy({ nodeId: activityId, toParentId: activityId });
    expect(errors.join(" ")).toMatch(/own parent/);
  });

  it("blocks a move along an axis the node has no parent on, and NAMES that axis", async () => {
    // A content Activity hangs off hasPart, never hasChild — so `via:"hasChild"`
    // is a caller who picked the wrong axis, not a caller who wants a new root.
    const { activityId, toLessonId } = await movableActivity();
    const errors = await blockedBy({ nodeId: activityId, toParentId: toLessonId, via: "hasChild" });
    expect(errors.join(" ")).toContain("hasChild");
  });

  it("blocks a target parent that sits INSIDE the node — the subtree-detaching move", async () => {
    /*
     * Moving a chapter under its own grandchild leaves a ring: nothing reaches the
     * chapter any more, so generation silently drops it, while the diff shows only
     * one edge removed and one added. Refused outright rather than warned about,
     * because the diff a reviewer sees does not look alarming.
     */
    const { chapterId, grandchildId } = await aSubtree();
    const errors = await blockedBy({ nodeId: chapterId, toParentId: grandchildId });
    expect(errors.join(" ")).toContain(grandchildId);
    expect(errors.join(" ")).toMatch(/INSIDE/);

    // And the graph is untouched: a blocked mutation opens no draft.
    expect(await draft()).toBeNull();
  });

  it("refuses a `via` that is not a containment edge, naming the two that are", async () => {
    /*
     * The reason this is an error and not a convenience: apply() detaches EVERY
     * edge of the named type pointing at the node, so `via:"hasEducationalAlignment"`
     * on a standard would strip every content node's alignment to it — a bulk
     * delete reported as a move. Verified below by counting what survives.
     */
    const { sfiId, alignedCount, anyLessonId } = await aMuchAlignedStandard();
    expect(alignedCount).toBeGreaterThan(1);

    const errors = await blockedBy({ nodeId: sfiId, toParentId: anyLessonId, via: "hasEducationalAlignment" });
    expect(errors.join(" ")).toContain("hasEducationalAlignment");
    expect(errors.join(" ")).toContain("hasPart");
    expect(errors.join(" ")).toContain("hasChild");

    // Nothing staged, so every alignment still stands.
    expect(await draft()).toBeNull();
    const published = await slot("a");
    expect(published.edges.filter((e) => e.type === ALIGN && e.to === sfiId)).toHaveLength(alignedCount);
  });
});

describe("move_node — the axis comes from the graph, not the label alone", () => {
  it("moves a derived LearningComponent, whose parent edge is hasChild", async () => {
    /*
     * containmentEdgeFor("LearningComponent") answers a different question — which
     * edge a NEW component is attached BY — and its answer, `supports`, points
     * component→SFI, so it is never an incoming parent edge. Resolving the axis
     * off the graph is what keeps a derived component movable at all.
     *
     * On the SYNTHETIC graph: ci/maths carried ~80 hasChild-parented components
     * under its "Composants dérivés" frames until the V2 rebuild, which left
     * none, so the shape this mechanic exists for has to be built. The mechanic
     * is unchanged — a subject may still carry derived frames.
     */
    await seedSyntheticChapters(store, ns);
    const { edges } = await slot("a");
    const component = { id: SYNTHETIC_IDS.component };
    const currentFrame = SYNTHETIC_IDS.frame;
    const otherFrame = SYNTHETIC_IDS.frame2;
    expect(edges.some((e) => e.type === "hasChild" && e.from === currentFrame && e.to === component.id)).toBe(true);

    const applied = await withActiveContext(CURATOR, async () => {
      const preview = await runMoveNode({ nodeId: component.id, toParentId: otherFrame });
      expect(preview.phase, JSON.stringify(preview)).toBe("preview");
      return runMoveNode({ nodeId: component.id, toParentId: otherFrame, confirm: true, confirmationToken: preview.confirmationToken as string });
    });
    expect(applied).toMatchObject({ phase: "apply", ok: true });

    const staged = (await draft())!;
    expect(staged.edges.some((e) => e.id === makeEdgeId("hasChild", otherFrame, component.id))).toBe(true);
    expect(staged.edges.some((e) => e.id === makeEdgeId("hasChild", currentFrame, component.id))).toBe(false);
    // Its outgoing `supports` edges are alignment, not membership — untouched.
    const supportsBefore = edges.filter((e) => e.type === "supports" && e.from === component.id).length;
    expect(staged.edges.filter((e) => e.type === "supports" && e.from === component.id)).toHaveLength(supportsBefore);
  });

  it("WARNS, without blocking, when the move detaches more than one parent", async () => {
    // Two parents on one axis is legal but rarely what someone re-filing one thing
    // means, and the diff alone reads as an ordinary move — so name them first.
    const { activityId, fromLessonId, toLessonId } = await movableActivity();
    const preview = await withActiveContext(CURATOR, async () => {
      const edges = [{ edgeType: HAS_PART, fromId: toLessonId, toId: activityId }];
      const staged = await runCreateEdges({ edges });
      await runCreateEdges({ edges, confirm: true, confirmationToken: staged.confirmationToken as string });

      const thirdLesson = (await slot("a")).nodes.find((n) =>
        (n.labels ?? []).includes("Lesson") && n.id !== fromLessonId && n.id !== toLessonId)!;
      return runMoveNode({ nodeId: activityId, toParentId: thirdLesson.id });
    });

    expect(preview.phase).toBe("preview");   // a warning, not a block
    expect((preview.warnings as string[]).join(" ")).toMatch(/2 'hasPart' parents/);
  });
});

// ── The formatter's declarative half, through the real tool ──────────────────
// The schema is unit-tested in kg-recipes; what matters here is that the tool
// actually REFUSES a bad knob rather than staging it. A `render` bag that
// reaches the graph unvalidated is silently ignored at render time, and the
// page comes out wrong with nothing to point at.

describe("edit_nodes — the `render` bag is schema-checked at authoring time", () => {
  // Any existing node will do: validation runs on the bag, not on the label.
  const aNode = async (): Promise<string> => {
    const nodes = await store.listNodes(ns, "a");
    return nodes.find((node) => (node.labels ?? []).includes("FormatterSpec"))!.id;
  };

  it("stages a valid render bag", async () => {
    const result = await withActiveContext(CURATOR, async () =>
      runEditNodes({ items: [{ nodeId: await aNode(), properties: { render: { page: { size: "A4" }, type: { family: "Andika", sizePt: 12 } } } }] }));
    expect(result.phase).toBe("preview");
    expect(result.confirmationToken).toBeTruthy();
  });

  it("BLOCKS an unknown knob, with no token issued", async () => {
    const result = await withActiveContext(CURATOR, async () =>
      runEditNodes({ items: [{ nodeId: await aNode(), properties: { render: { page: { size: "A4" }, colours: {} } } }] }));
    expect(result.phase).toBe("blocked");
    expect(result.confirmationToken).toBeUndefined();
    expect(JSON.stringify(result.errors)).toContain("render");
  });

  it("BLOCKS a mistyped value", async () => {
    const result = await withActiveContext(CURATOR, async () =>
      runEditNodes({ items: [{ nodeId: await aNode(), properties: { render: { type: { sizePt: "twelve" } } } }] }));
    expect(result.phase).toBe("blocked");
  });

  it("names the item AND the knob, so a batch failure is locatable", async () => {
    const nodeId = await aNode();
    const result = await withActiveContext(CURATOR, async () =>
      runEditNodes({ items: [
        { nodeId, properties: { render: { page: { size: "A4" } } } },
        { nodeId: (await store.listNodes(ns, "a")).find((n) => n.id !== nodeId)!.id, properties: { render: { page: { size: "Foolscap" } } } },
      ] }));
    expect(result.phase).toBe("blocked");
    const errors = JSON.stringify(result.errors);
    expect(errors).toContain("edit_nodes[1]");
    expect(errors).toContain("render.page.size");
  });
});
