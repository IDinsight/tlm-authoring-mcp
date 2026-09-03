/*
 * Response projections (WP2) — the three read surfaces that were too big to use.
 *
 * Each test states the DEFECT it prevents coming back, because each was measured
 * against the live server before the fix:
 *
 *   • list_catalog returned all 26 live entries in full — 63,125 characters,
 *     which no caller can afford. It now browses by NAME and detail is asked for.
 *   • get_capabilities cost ~7,200 tokens as a session preamble. It now returns a
 *     digest, with each area reachable by name — and nothing unreachable.
 *   • find_node took one query, so resolving 60 lesson names cost 60 round-trips
 *     and 60 graph loads. It now takes a batch against ONE load.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  seedStore, fixtureContext, installFakeStorage, withActiveContext as inContext,
  CI_MATHS, CURATOR, APPROVER,
} from "../../__tests__/index.js";
import { __setKgStoreForTest, kgNamespace, type KgNodeStore, type StoredMeta, type StoredNode, type StoredEdge } from "../../kg-store/index.js";
import { SHARED_CATALOG_NAMESPACE } from "../../kg-recipes/index.js";
import { edgeId as makeEdgeId } from "../../kg-store/index.js";
import { listCatalog } from "../catalog.js";
import { buildCapabilitiesReport, projectCapabilities, CAPABILITY_SECTIONS } from "../capabilities.js";
import { runLintContent } from "../check.js";
import { findActiveNodes } from "../graph.js";
import { responseBytes } from "../../utils/index.js";
import type { Actor } from "../../actor.js";

const context = fixtureContext(CI_MATHS);
let store: KgNodeStore;

// ── A catalog with enough entries, of all three kinds, to page and filter ──────
// Shaped like the real library: a root InstructionalRoutine holding entries, each
// entry holding steps. Summaries are deliberately long — on the live catalog they
// are the single biggest contributor (up to 3.4 KB on one entry), which is what
// `detail:'names'` has to drop.
const LONG_SUMMARY = "Règle transversale. ".repeat(60);

const catalogNode = (id: string, label: string, raw: Record<string, unknown>): Omit<StoredNode, "slot"> =>
  ({ id, type: label, namespace: SHARED_CATALOG_NAMESPACE, labels: [label], spine: false, properties: { raw } });
const catalogEdge = (from: string, to: string): Omit<StoredEdge, "slot"> =>
  ({ id: makeEdgeId("hasPart", from, to), type: "hasPart", from, to, namespace: SHARED_CATALOG_NAMESPACE, properties: {} });

const ENTRY_KINDS = [
  { kind: undefined, prefix: "rout", count: 8 },              // untagged ⇒ routine
  { kind: "formatter", prefix: "fmt", count: 4 },
  { kind: "rubric", prefix: "rub", count: 2 },
];

async function seedCatalog(target: KgNodeStore): Promise<void> {
  const nodes = [catalogNode("cat-root", "InstructionalRoutine", { description: "Catalog library" })];
  const edges: Array<Omit<StoredEdge, "slot">> = [];

  for (const { kind, prefix, count } of ENTRY_KINDS) {
    for (let index = 1; index <= count; index++) {
      const entryId = `${prefix}-${index}`;
      const metadata: Record<string, unknown> = { summary: LONG_SUMMARY };
      if (kind) metadata.catalogKind = kind;
      nodes.push(catalogNode(entryId, "InstructionalRoutine", { description: `${prefix} entry ${index}`, metadata }));
      edges.push(catalogEdge("cat-root", entryId));

      // One step per entry, so `stepCount` is a real projection of real children.
      const stepId = `${entryId}-step`;
      nodes.push(catalogNode(stepId, "Material", { description: `step of ${entryId}`, position: 1, content: "corps" }));
      edges.push(catalogEdge(entryId, stepId));
    }
  }

  const meta: StoredMeta = { contentHash: "test", seededAt: "1970-01-01T00:00:00Z", adapterId: "catalog", nodeCount: nodes.length, edgeCount: edges.length };
  await target.writeSlot(SHARED_CATALOG_NAMESPACE, "a", { nodes, edges, meta });
  await target.ensurePointer(SHARED_CATALOG_NAMESPACE, "a");
}

beforeAll(() => { installFakeStorage(); });
beforeEach(async () => {
  store = await seedStore({ only: [CI_MATHS] });
  await seedCatalog(store);
  __setKgStoreForTest(store);
});
afterAll(() => { __setKgStoreForTest(null as unknown as KgNodeStore); });

const asCurator = <T>(fn: () => Promise<T>): Promise<T> => inContext(context, CURATOR, fn);

// ── 2a. list_catalog ──────────────────────────────────────────────────────────

describe("list_catalog projects, filters and pages", () => {
  it("defaults to names — every entry, small enough to actually call", async () => {
    const result = await asCurator(() => listCatalog());
    const entries = result.entries as Array<Record<string, unknown>>;

    expect(result.detail).toBe("names");
    expect(result.total).toBe(14);
    expect(entries).toHaveLength(14);

    // The projection is what makes it callable: names carry no summary and no
    // step detail, only what CHOOSING an entry needs.
    expect(Object.keys(entries[0]).sort()).toEqual(["id", "kind", "materialCount", "name", "scope", "stepCount"]);
    expect(entries.every((entry) => !("summary" in entry))).toBe(true);
    expect(responseBytes(result)).toBeLessThan(8 * 1024);
  });

  it("detail:'full' carries the authored spec — and is the payload that needed bounding", async () => {
    const names = await asCurator(() => listCatalog());
    const full = await asCurator(() => listCatalog({ detail: "full" }));

    const firstFull = (full.entries as Array<Record<string, unknown>>)[0];
    expect(firstFull.summary).toBe(LONG_SUMMARY);
    expect(Array.isArray(firstFull.steps)).toBe(true);
    expect(responseBytes(full)).toBeGreaterThan(responseBytes(names) * 5);
  });

  it("filters by kind and by scope", async () => {
    const rubrics = await asCurator(() => listCatalog({ kind: "rubric" }));
    expect(rubrics.total).toBe(2);
    expect((rubrics.entries as Array<{ kind: string }>).every((entry) => entry.kind === "rubric")).toBe(true);

    // Only the asked-for scope is read, so a workspace with no library of its own
    // still answers a scope:'shared' call.
    const shared = await asCurator(() => listCatalog({ scope: "shared" }));
    expect((shared.scopes as Array<{ scope: string }>).map((s) => s.scope)).toEqual(["shared"]);
    expect((shared.entries as Array<{ scope: string }>).every((entry) => entry.scope === "shared")).toBe(true);
  });

  it("pages with a cursor, and the pages partition the list", async () => {
    const first = await asCurator(() => listCatalog({ limit: 6 }));
    expect(first.count).toBe(6);
    expect(first.nextCursor).toBeTruthy();

    const second = await asCurator(() => listCatalog({ limit: 6, cursor: first.nextCursor as string }));
    const third = await asCurator(() => listCatalog({ limit: 6, cursor: second.nextCursor as string }));
    expect(third.nextCursor).toBeNull();

    const idOf = (page: Record<string, unknown>) => (page.entries as Array<{ id: string }>).map((entry) => entry.id);
    const seen = [...idOf(first), ...idOf(second), ...idOf(third)];
    expect(seen).toHaveLength(14);
    expect(new Set(seen).size).toBe(14);
  });

  it("re-lists from the start on a stale cursor rather than erroring", async () => {
    const result = await asCurator(() => listCatalog({ cursor: "not-a-real-cursor" }));
    expect(result.count).toBe(14);
  });
});

// ── 2b. get_capabilities ──────────────────────────────────────────────────────

describe("get_capabilities projects to a digest with every area reachable", () => {
  it("returns a small digest by default", async () => {
    const report = await asCurator(() => buildCapabilitiesReport());
    const digest = projectCapabilities(report);

    expect(responseBytes(digest)).toBeLessThan(6 * 1024);
    expect(digest.actor).toBeDefined();
    expect(digest.context).toBeDefined();
    expect(digest.actions).toBeDefined();
    expect(digest.draft).toBeDefined();
    expect(digest.sections).toEqual([...CAPABILITY_SECTIONS]);

    // The digest is a projection, never a second computation: it must be a
    // fraction of what it projects.
    expect(responseBytes(digest)).toBeLessThan(responseBytes(report) / 4);
  });

  it("loses no field — every section of the full report is reachable by name", async () => {
    const report = await asCurator(() => buildCapabilitiesReport());
    const digest = projectCapabilities(report);

    const reachable = new Set<string>(Object.keys(digest));
    for (const section of CAPABILITY_SECTIONS) {
      const projected = projectCapabilities(report, section);
      expect(projected[section]).toEqual(report[section]);
      reachable.add(section);
    }

    // `sections` and the two notes are the projection's own scaffolding.
    const scaffolding = new Set(["sections", "note", "note2"]);
    const unreachable = Object.keys(report).filter((key) => !reachable.has(key) && !scaffolding.has(key));
    expect(unreachable).toEqual([]);
  });

  it("`verbs` mirrors the gates — an approver may publish, a curator may not", async () => {
    const asApprover = await inContext(context, APPROVER, () => buildCapabilitiesReport());
    const asCuratorReport = await asCurator(() => buildCapabilitiesReport());

    expect(asApprover.actions).toMatchObject({ canPublish: true });
    expect((asApprover.verbs as string[])).toContain("publish_draft");
    expect((asCuratorReport.verbs as string[])).not.toContain("publish_draft");

    // The open reads are in every caller's list, membership or not.
    expect(asCuratorReport.verbs as string[]).toContain("walk_graph");
    expect(asCuratorReport.verbs as string[]).toContain("find_node");
  });

  it("answers an unknown section with the digest and the valid names", async () => {
    const report = await asCurator(() => buildCapabilitiesReport());
    const projected = projectCapabilities(report, "nonsense");

    expect(projected.sections).toEqual([...CAPABILITY_SECTIONS]);
    expect(String(projected.note)).toContain("nonsense");
  });
});

// ── 2c. find_node ─────────────────────────────────────────────────────────────

// Two fixture landmarks, chosen for what they prove: one name that resolves to
// exactly one node, and one that two nodes carry (the ci/maths Course and the
// standards framework are both « Planification ») — ambiguity is the normal case
// here, and a batch must report it rather than pick.
const UNIQUE_NAME = "Guide de l'enseignant";
const AMBIGUOUS_NAME = "Planification";

describe("find_node resolves a batch of names against one graph load", () => {
  it("keys results by the query the caller sent", async () => {
    const single = await asCurator(() => findActiveNodes({ query: UNIQUE_NAME }));
    const batch = await asCurator(() => findActiveNodes({ queries: [UNIQUE_NAME, "nothing carries this name"] }));

    const results = batch.results as Record<string, { matches: unknown[] }>;
    expect(Object.keys(results)).toEqual([UNIQUE_NAME, "nothing carries this name"]);
    expect(batch.count).toBe(2);

    // A batch entry says exactly what a lone call would.
    expect(results[UNIQUE_NAME].matches).toEqual(single.matches);
  });

  it("names what did NOT resolve — no match, and AMBIGUOUS alike", async () => {
    const batch = await asCurator(() => findActiveNodes({ queries: [UNIQUE_NAME, AMBIGUOUS_NAME, "no such thing"] }));
    const results = batch.results as Record<string, { ambiguous?: true; note?: string }>;

    // Both failure modes still need a person: nothing matched, or several did.
    expect(batch.unresolved).toEqual([AMBIGUOUS_NAME, "no such thing"]);
    expect(results[AMBIGUOUS_NAME].ambiguous).toBe(true);
    expect(results["no such thing"].note).toContain("Nothing carries this name");
  });

  it("omits `unresolved` when every name landed on exactly one node", async () => {
    const batch = await asCurator(() => findActiveNodes({ queries: [UNIQUE_NAME] }));
    expect(batch.unresolved).toBeUndefined();
  });

  it("refuses a call with neither query nor queries", async () => {
    const result = await asCurator(() => findActiveNodes({}));
    expect(String(result.error)).toContain("find_node needs");
  });
});

// ── lint_content, through the real tool against a seeded catalog ─────────────
// The rules are unit-tested in kg-recipes; what matters here is the WIRING —
// that the tool reads the catalog the server actually has, resolves references
// across both libraries, and reports where each finding came from.

describe("lint_content reads the real catalog", () => {
  // Give the seeded catalog a routine with the live defect: a total in its name
  // and steps that do not add up to it.
  beforeEach(async () => {
    const nodes = [
      catalogNode("lint-root", "InstructionalRoutine", { description: "Catalog library" }),
      catalogNode("lint-entry", "InstructionalRoutine", { description: "Fiche de leçon — enseignement explicite (30 min)" }),
      catalogNode("lint-s1", "InstructionalRoutine", { description: "Étape 1", timeRequired: "PT20M" }),
      catalogNode("lint-s2", "InstructionalRoutine", { description: "Étape 2", timeRequired: "PT15M" }),
    ];
    const edges = [catalogEdge("lint-root", "lint-entry"), catalogEdge("lint-entry", "lint-s1"), catalogEdge("lint-entry", "lint-s2")];
    const meta = { contentHash: "lint", seededAt: "1970-01-01T00:00:00Z", adapterId: "catalog", nodeCount: nodes.length, edgeCount: edges.length };
    await store.writeSlot(SHARED_CATALOG_NAMESPACE, "a", { nodes, edges, meta });
    await store.ensurePointer(SHARED_CATALOG_NAMESPACE, "a");
  });

  it("finds the mismatch in the catalog and says which library it is in", async () => {
    const result = await asCurator(() => runLintContent({ scope: "catalog" }));
    const findings = result.findings as Array<Record<string, unknown>>;

    const mismatch = findings.find((f) => f.rule === "routine-duration-mismatch");
    expect(mismatch).toBeDefined();
    expect(String(mismatch!.message)).toContain("35");
    expect(String(mismatch!.where)).toContain("_catalog");
  });

  it("reports which rules ran and which are still waiting on a rendered page", async () => {
    const result = await asCurator(() => runLintContent());

    expect(result.rulesRun).toContain("routine-duration-mismatch");
    expect(Array.isArray(result.rulesPending)).toBe(true);
  });

  it("narrows to one rule when asked", async () => {
    const result = await asCurator(() => runLintContent({ scope: "catalog", rules: ["rubric-weights-sum"] }));

    expect(result.rulesRun).toBeDefined();
    expect((result.findings as unknown[]).every((f) => (f as { rule: string }).rule === "rubric-weights-sum")).toBe(true);
  });

  it("does not report the subject graph's own ids as dangling", async () => {
    // The subject fixture cites nothing, but this pins the cross-scope resolution:
    // a finding here would mean the known-id set was built from one graph only.
    const result = await asCurator(() => runLintContent({ scope: "all", rules: ["dangling-reference"] }));
    expect(result.findings).toEqual([]);
  });
});
