/*
 * Per-call context override — a read naming its own (workspace, grade, subject).
 *
 * THE DEFECT. The active context lives in the SESSION bag, and a session is one
 * MCP CONNECTION, not one caller. Reported from a real authoring session:
 * subagents fanning out over a week's sessions each called `set_context`, and
 * the parent's next two `walk_graph` calls failed with "Start node not found" on
 * ids that had resolved seconds earlier — the ids were fine, the graph under
 * them had moved.
 *
 * WHY NOT KEY THE BAG BY CALLER. There is nothing to key it on: a subagent and
 * its parent arrive on the same connection with the same `mcp-session-id` AND
 * the same verified actor, and MCP carries no sub-caller identity. Letting the
 * CALLER be stateless is the only fix available.
 *
 * So the property under test is ISOLATION, in both directions: a call naming a
 * context reads THAT graph, and it neither leaves its model behind for the next
 * ambient read nor moves the session's selection. Two fixtures are seeded here
 * because the whole point is reading a namespace that is not the active one —
 * and that second seed is why this suite is its own file (adding it to
 * graph.test.ts pushed several of that suite's tests past the 5s timeout).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  seedStore, seededContexts, fakeStorage, CI_MATHS, CE1_READING,
  withActiveContext as inContext,
} from "../../__tests__/index.js";
import { __setKgStoreForTest, kgNamespace } from "../../kg-store/index.js";
import { __setStorageForTest } from "../../storage/index.js";
import { walkActiveGraph, namespaceStats, findActiveNodes } from "../graph.js";
import { readStandards } from "../curriculum.js";
import { withContextOverride } from "../context-override.js";
import type { Actor } from "../../actor.js";
import type { KgNodeStore } from "../../kg-store/index.js";

const CURATOR: Actor = { id: "curator-1", email: "curator@idinsight.org", unknown: false, memberships: [{ workspace: "senegal", role: "curator" }] } as unknown as Actor;

const SEED = [CI_MATHS, CE1_READING];
const active = seededContexts(SEED).find((c) => c.grade === "ci" && c.subject === "maths")!;
const READING = { workspace: "senegal", grade: "ce1", subject: "reading" };

let store: KgNodeStore;
const inActive = <T>(fn: () => Promise<T>): Promise<T> => inContext(active, CURATOR, fn);

beforeAll(() => { __setStorageForTest(fakeStorage); });
beforeEach(async () => {
  store = await seedStore({ only: SEED });
  __setKgStoreForTest(store);
});
afterAll(() => { __setKgStoreForTest(null); });

describe("a read can name its own context", () => {
  it("reads the named namespace and leaves the session's selection alone", async () => {
    const result = await inActive(async () => ({
      before: await namespaceStats(),
      overridden: await namespaceStats({ context: READING }),
      after: await namespaceStats(),
    }));

    // The override really read the other graph…
    expect(String(result.overridden.namespace)).toContain("ce1/reading");
    // …and the session sat still, before and after.
    expect(String(result.before.namespace)).toContain("ci/maths");
    expect(result.after.namespace).toBe(result.before.namespace);
  });

  it("does not leave its model behind for the NEXT ambient read", async () => {
    // This is the reported regression in miniature: an id that resolved a moment
    // ago must still resolve after a read against another namespace.
    const outcome = await inActive(async () => {
      const nodes = await store.listNodes(kgNamespace(active.workspace, active.grade, active.subject), "a");
      const courseId = nodes.find((node) => (node.labels ?? []).includes("Course"))!.id;

      const overridden = await walkActiveGraph({ fromId: courseId, direction: "out", context: READING });
      const ambient = await walkActiveGraph({ fromId: courseId, direction: "out", edgeTypes: ["hasPart"] });
      return { overridden, ambient };
    });

    // A ci/maths Course id is genuinely absent from the reading graph, so the
    // overridden call SHOULD fail to find it — that proves the switch happened.
    expect(String(outcome.overridden.error)).toMatch(/not found/);
    // And the ambient call that follows is unharmed, which is the whole point.
    expect(outcome.ambient.error).toBeUndefined();
    expect((outcome.ambient.nodes as unknown[]).length).toBeGreaterThan(0);
  });

  it("resolves a NAME against the named namespace, not the active one", async () => {
    const found = await inActive(() =>
      findActiveNodes({ query: "Guide de l'enseignant", context: READING, limit: 5 }),
    );
    const matches = found.matches as Array<{ title: string }> | undefined;
    // That document is the reading Guide; ci/maths has no node by that name.
    expect(matches?.length ?? 0).toBeGreaterThan(0);
  });

  it("carries the override through get_standards too", async () => {
    const readingLesson = await inActive(async () => {
      const stats = await namespaceStats({ context: READING });
      expect(String(stats.namespace)).toContain("ce1/reading");
      // Any reading Lesson id, taken from the reading graph itself.
      const nodes = await store.listNodes(kgNamespace("senegal", "ce1", "reading"), "a");
      return nodes.find((node) => (node.labels ?? []).includes("Lesson"))!.id;
    });

    const standards = await inActive(async () =>
      withContextOverride(READING, async () => readStandards({ nodeId: readingLesson })),
    );
    // Read against ci/maths this id does not exist; against reading it resolves.
    expect((standards as Record<string, unknown>).error).toBeUndefined();
  });

  it("refuses a namespace that does not exist, and says how to list them", async () => {
    const result = await inActive(() =>
      namespaceStats({ context: { workspace: "nowhere", grade: "x", subject: "y" } }),
    );
    expect(String(result.error)).toMatch(/Cannot act on workspace 'nowhere'/);
    expect(String(result.error)).toMatch(/list_workspaces/);
  });

  it("behaves exactly as before when no context is given", async () => {
    // Every existing caller omits it, so the default path must be untouched.
    const result = await inActive(() => namespaceStats());
    expect(String(result.namespace)).toContain("ci/maths");
    expect(result.error).toBeUndefined();
  });
});
