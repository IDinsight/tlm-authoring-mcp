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
 *   • walk_graph returned every node in full, and one authored field —
 *     metadata.assemblyGuide — was 84% of a ci/maths page. A page of the live
 *     document's DocumentSections held FOUR of 579, so enumerating one document's
 *     spine cost ~145 round-trips. detail:'skeleton' drops the prose.
 *   • walk_document budget-checked only its `curriculum`, so the TLM subtree —
 *     2.3 MB on that same document — rode unbounded and the whole 2.78 MB payload
 *     was WITHHELD by the response cap. It now sheds in tiers and pages the spine.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { subjectDir, KG_FIXTURE } from "../../__tests__/index.js";
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
import { findActiveNodes, walkActiveGraph, walkDocument } from "../graph.js";
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

beforeAll(async () => { installFakeStorage(); await pickLandmarkNames(); });
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
// exactly one node, and one that several nodes carry — ambiguity is the normal
// case here, and a batch must report it rather than pick.
//
// Both are READ OFF THE SEED rather than spelled out. The names that happen to
// be unique or repeated in ci/maths are curriculum content, and the previous
// pair ("Guide de l'enseignant" / "Planification") stopped existing when the
// curriculum was revised — which broke these tests without anything being wrong
// with find_node. What is being tested is the one-vs-many behaviour, so the
// fixture is asked which names have it.
let UNIQUE_NAME: string;
let AMBIGUOUS_NAME: string;

// The fixture's fattest document root — the TLM holding the most DocumentSections.
// Read off the seed for the same reason the names above are: which document is
// biggest is curriculum content, and pinning an id here would break on a refresh.
let DOCUMENT_ROOT_ID: string;

// First line of `description` is the display name find_node matches on.
const firstLine = (node: { properties?: Record<string, unknown> }): string =>
  String(node.properties?.description ?? "").split("\n")[0].trim();

async function pickLandmarkNames(): Promise<void> {
  const raw = JSON.parse(readFileSync(resolve(subjectDir("senegal", "ci", "maths"), KG_FIXTURE), "utf8"));
  const counts = new Map<string, number>();
  for (const node of raw.nodes) {
    const name = firstLine(node);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const sorted = [...counts].sort(([a], [b]) => a.localeCompare(b));
  UNIQUE_NAME = sorted.find(([name, n]) => n === 1 && name.length > 3 && name.length < 40)![0];
  AMBIGUOUS_NAME = sorted.find(([, n]) => n > 1)![0];

  DOCUMENT_ROOT_ID = pickFattestDocumentRoot(raw);
}

// The TLM with the most DocumentSections under it by hasPart — the document whose
// spine is expensive to enumerate, which is the case detail:'skeleton' exists for.
function pickFattestDocumentRoot(raw: {
  nodes: Array<{ id: string; labels?: string[] }>;
  relationships: Array<{ type: string; start: string; end: string }>;
}): string {
  const isSection = new Set(
    raw.nodes.filter((node) => (node.labels ?? []).includes("DocumentSection")).map((node) => node.id),
  );
  const sectionsUnder = new Map<string, number>();
  for (const edge of raw.relationships) {
    if (edge.type !== "hasPart" || !isSection.has(edge.end)) continue;
    sectionsUnder.set(edge.start, (sectionsUnder.get(edge.start) ?? 0) + 1);
  }

  const roots = raw.nodes.filter((node) => (node.labels ?? []).includes("TeachingLearningMaterial"));
  const ranked = roots
    .map((root) => ({ id: root.id, sections: sectionsUnder.get(root.id) ?? 0 }))
    .sort((left, right) => right.sections - left.sections);

  if (ranked.length === 0 || ranked[0].sections === 0) {
    throw new Error("Fixture holds no TeachingLearningMaterial with DocumentSections — the walk_graph detail tests need one.");
  }
  return ranked[0].id;
}

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

// ── walk_graph detail, against the REAL fixture ──────────────────────────────
// The mechanics are unit-tested in graph.test.ts on a hand-built graph. What
// matters here is the MEASUREMENT on real authored data: the ci/maths fixture
// carries the same multi-KB assemblyGuides live does, and it is the size of
// those, not the node count, that bounds a page. Assertions are RELATIVE so a
// fixture refresh cannot make them stale — only a regression in the projection
// itself can fail them.
describe("walk_graph pages the real document spine at skeleton detail", () => {
  // Every DocumentSection reachable from the fixture's document root, so the
  // walk is the one a caller actually makes when listing a document's sections.
  const walkSections = (detail?: "skeleton" | "full") =>
    asCurator(() =>
      walkActiveGraph({
        fromId: DOCUMENT_ROOT_ID,
        direction: "out",
        edgeTypes: ["hasPart"],
        nodeTypes: ["DocumentSection"],
        maxDepth: 10,
        limit: 500,
        detail,
      }),
    );

  it("fits many times more sections per page than full detail", async () => {
    const full = await walkSections("full");
    const skeleton = await walkSections("skeleton");

    const fullCount = (full.nodes as unknown[]).length;
    const skeletonCount = (skeleton.nodes as unknown[]).length;

    // Both pages are bounded by the same byte budget, so the ratio IS the win.
    // Measured at ~18x on this fixture; 5x is a floor that only a regression trips.
    expect(skeletonCount).toBeGreaterThan(fullCount * 5);
  });

  it("drops the authored prose and keeps what identifies and orders a section", async () => {
    const skeleton = await walkSections("skeleton");
    const sections = skeleton.nodes as Array<{ properties: Record<string, unknown> }>;
    expect(sections.length).toBeGreaterThan(0);

    for (const section of sections) {
      // The field that was 84% of the page is gone everywhere, not just on average.
      expect(section.properties.metadata).toBeUndefined();
      expect(section.properties.content).toBeUndefined();
      // A caller can still name the section and place it in reading order.
      expect(typeof section.properties.description).toBe("string");
    }
  });

  it("still returns the prose at full detail, so generation is unaffected", async () => {
    const full = await walkSections("full");
    const sections = full.nodes as Array<{ properties: Record<string, unknown> }>;
    const withGuide = sections.filter((section) => {
      const metadata = section.properties.metadata as Record<string, unknown> | undefined;
      return typeof metadata?.assemblyGuide === "string";
    });
    // The fixture's sections are authored, so full detail must still carry them.
    expect(withGuide.length).toBeGreaterThan(0);
  });
});

// ── walk_document self-bounding, against the REAL fixture ────────────────────
// The tiers and the cursor are unit-tested in graph.test.ts on staged documents.
// What matters here is that the fixture's genuinely huge document — the one the
// live server withheld at 2,780,814 B against a 102,400 B cap — now ANSWERS, and
// that paging it delivers every section exactly once.
describe("walk_document answers on the fixture's largest document", () => {
  // Read from the response cap the server actually enforces, so raising the cap
  // cannot leave this test asserting a stale number.
  const responseCap = () => Number(process.env.TLM_MAX_RESPONSE_BYTES) || 102_400;

  it("returns every page under the response cap, and the whole spine across them", async () => {
    const pages: Array<Record<string, unknown>> = [];
    await asCurator(async () => {
      let cursor: string | undefined;
      for (let page = 0; page < 40; page++) {
        const result = await walkDocument({ tlmId: DOCUMENT_ROOT_ID, cursor });
        pages.push(result);
        if (!result.nextCursor) break;
        cursor = result.nextCursor as string;
      }
    });

    // Nothing is withheld any more: the cap is never reached.
    for (const page of pages) {
      expect(responseBytes(page)).toBeLessThanOrEqual(responseCap());
    }

    const total = pages[0].sectionsTotal as number;
    expect(total).toBeGreaterThan(100); // the fixture's big document, not a stub

    const seen = pages.flatMap((page) => (page.sections as Array<{ id: string }>).map((section) => section.id));
    expect(seen).toHaveLength(total);       // no section lost to the budget
    expect(new Set(seen).size).toBe(total); // and none served twice
  });

  it("keeps the assembly guide on every page and redirects the parts it shed", async () => {
    const page = await asCurator(() => walkDocument({ tlmId: DOCUMENT_ROOT_ID }));

    // The guide is the document's "how to build me" — small, and useless to defer.
    expect(typeof page.assemblyGuide).toBe("string");
    expect((page.assemblyGuide as string).length).toBeGreaterThan(0);

    // This document is far over budget, so both heavy parts are shed — each with a
    // route, because a marker without one just moves the dead end.
    const document = page.document as { tooLarge?: true; message?: string };
    expect(document.tooLarge).toBe(true);
    expect(document.message).toMatch(/walk_document_section/);
    expect((page.curriculum as { tooLarge?: true }).tooLarge).toBe(true);
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
