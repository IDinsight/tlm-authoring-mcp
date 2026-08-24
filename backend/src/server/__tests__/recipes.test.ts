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
import { seedStore, seededContexts, fakeStorage, CI_MATHS, withActiveContext as inContext } from "../../__tests__/index.js";
import {
  __setKgStoreForTest, kgNamespace, edgeId as makeEdgeId,
  __resetMutationsForTest, __resetDraftTokensForTest,
} from "../../kg-store/index.js";
import { RECIPES } from "../../kg-recipes/index.js";
import { __setStorageForTest } from "../../storage/index.js";
import { __setActorForTest, type Actor } from "../../actor.js";
import { buildServer } from "../index.js";
import { runMoveNode } from "../recipes.js";
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
 * A movable Activity, discovered from the seed rather than hard-coded so a
 * re-import cannot silently invalidate the suite: an Activity filed under one
 * Lesson by hasPart that also ALIGNS to a standard, plus a second Lesson to move
 * it to. The alignment edge is the "other axis" every assertion below watches —
 * it must survive a move along hasPart.
 */
async function movableActivity(): Promise<{ activityId: string; fromLessonId: string; toLessonId: string; alignEdgeIds: string[] }> {
  const { nodes, edges } = await slot("a");
  const isLesson = new Set(nodes.filter((n) => (n.labels ?? []).includes("Lesson")).map((n) => n.id));
  const parentOf = new Map(edges.filter((e) => e.type === HAS_PART).map((e) => [e.to, e.from]));

  const activity = nodes.find((node) =>
    (node.labels ?? []).includes("Activity") &&
    isLesson.has(parentOf.get(node.id) ?? "") &&
    edges.some((edge) => edge.type === ALIGN && edge.from === node.id));
  expect(activity, "the CI-maths fixture should hold an aligned Activity under a Lesson").toBeTruthy();

  const fromLessonId = parentOf.get(activity!.id)!;
  const toLessonId = [...isLesson].find((id) => id !== fromLessonId)!;
  const alignEdgeIds = edges.filter((edge) => edge.type === ALIGN && edge.from === activity!.id).map((edge) => edge.id);
  return { activityId: activity!.id, fromLessonId, toLessonId, alignEdgeIds };
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
    const [scheduleA, scheduleB] = nodes
      .filter((node) => (node.labels ?? []).includes("LessonGrouping") && node.id !== fromLessonId && node.id !== toLessonId)
      .map((node) => node.id);

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
});
