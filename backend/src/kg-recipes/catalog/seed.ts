/*
 * Assembling a catalog namespace from source snapshots.
 *
 * Seed tooling, not a runtime path: it takes raw graph snapshots and re-homes
 * their entries under one catalog root in the destination namespace. Authored
 * entries (formatters, rubrics) keep their kind tags; harvested routines do not.
 *
 * It is deliberately separate from the mutations in apply.ts. A seed that could
 * reach a live workspace library is not hypothetical — one once deleted 19
 * entries from the senegal catalog — so the two stay apart.
 */
import { edgeId, type MutationEdge, type MutationGraph, type MutationNode } from "../../kg-store/index.js";
import type { RawGraphSnapshot } from "../../types.js";
import {
  CATALOG_ROOT_ID, SHARED_CATALOG_NAMESPACE, ROUTINE_LABEL, ROUTINE_ROLE, CONTAINMENT,
  rawOf, metaOf, isRoutine, kindOf, indexContainment,
} from "./entries.js";
import { subtreeIds } from "./clone.js";

// ── Authored formatter entries live in the seed tooling, not here ────────────
// The formatter house-style specs (the docx house style, the Senegalese art style, and
// the CI-maths pupil-manual illustration layout) are authored DATA, not server
// mechanism, so they live in `scripts/seed-catalog.mjs` and are fed to
// assembleCatalog(..., authored) at seed time — exactly like the subject bundles under
// sources/. This module keeps only the catalog machinery below (toCatalogStoreShape,
// rehomeEntries, assembleCatalog), plus the read/clone helpers above.

// ── Seeding the catalog ──────────────────────────────────────────────────────
// Convert a raw LC graph (as read from a source knowledge_graph.json — `start`/`end`
// edges, LC props at properties.*) into store shape for the catalog namespace: every
// node non-spine (type = its first label, props under properties.raw), namespaced to
// the catalog.
function toCatalogStoreShape(raw: RawGraphSnapshot, namespace: string): MutationGraph {
  const nodes: MutationNode[] = raw.nodes.map((n) => ({
    id: n.id, type: (n.labels ?? [])[0] ?? "", namespace,
    labels: n.labels ?? [], spine: false, properties: { raw: n.properties ?? {} },
  }));
  const edges: MutationEdge[] = raw.relationships.map((e) => ({
    id: edgeId(e.type, e.start, e.end), type: e.type, from: e.start, to: e.end,
    namespace, properties: e.properties ?? {},
  }));
  return { nodes, edges };
}

// Re-home one source's top-level routine subtrees under `rootId`, appending to
// `nodes`/`edges`. A top-level routine is an `InstructionalRoutine` with no routine
// `hasPart` parent; its subtree (steps + Materials) comes along verbatim, ids
// preserved. `keepAuthoredKinds` decides whether NON-routine entries (formatters,
// rubrics) are taken — true for the authored literals that ARE those entries, false
// for scraped subject bundles: a subject graph CARRIES formatter/rubric attachments,
// but those are copies of authored entries and re-scraping them would seed a second
// copy of every one. (Copies applied since the document layer landed are relabelled
// to Formatter/Rubric and so fail `isRoutine` anyway; this guards the older ones that
// are still InstructionalRoutine with only a metadata tag.)
function rehomeEntries(source: RawGraphSnapshot, namespace: string, rootId: string, keepAuthoredKinds: boolean, nodes: MutationNode[], edges: MutationEdge[]): void {
  const graph = toCatalogStoreShape(source, namespace);
  const { byId, children, hasRoutineParent } = indexContainment(graph);
  const entries = graph.nodes.filter((n) => isRoutine(n) && !hasRoutineParent.has(n.id) && (keepAuthoredKinds || kindOf(n) === "routine"));
  for (const entry of entries) {
    const ids = new Set(subtreeIds(entry.id, children));
    for (const id of ids) { const n = byId.get(id); if (n) nodes.push(n); }
    for (const e of graph.edges) if (e.type === CONTAINMENT && ids.has(e.from) && ids.has(e.to)) edges.push(e);
    edges.push({ id: edgeId(CONTAINMENT, rootId, entry.id), type: CONTAINMENT, from: rootId, to: entry.id, namespace, properties: {} });
  }
}

// Build a catalog's stored graph: a single root container plus re-homed entries.
// `sources` are subject graphs (a subject's knowledge_graph.json) — scraped for their
// ROUTINE subtrees only; any formatter or rubric a subject graph carries (a copy
// attached under its document via use_formatter / use_rubric) is deliberately NOT
// re-scraped, since those come solely from the authored literals in `authored`.
// `authored` are the routine/formatter/rubric literals, taken whole (every kind kept).
// Everything else in a source (chapters, lessons, the spine) is dropped. `namespace`
// is the target catalog.
export function assembleCatalog(sources: RawGraphSnapshot[], namespace = SHARED_CATALOG_NAMESPACE, rootId = CATALOG_ROOT_ID, authored: RawGraphSnapshot[] = []): MutationGraph {
  const root: MutationNode = {
    id: rootId, type: ROUTINE_LABEL, namespace, labels: [ROUTINE_LABEL], spine: false,
    properties: { raw: { description: "Routine library", metadata: { role: "instructional-routine" } } },
  };
  const nodes: MutationNode[] = [root];
  const edges: MutationEdge[] = [];

  for (const source of sources) rehomeEntries(source, namespace, rootId, false, nodes, edges);
  for (const source of authored) rehomeEntries(source, namespace, rootId, true, nodes, edges);
  return { nodes, edges };
}
