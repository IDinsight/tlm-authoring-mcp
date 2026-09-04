/*
 * Exporting a SCOPED SLICE — the containment subtree under one node.
 *
 * Feeds a self-contained in-chat visualization artifact rather than the hosted
 * explorer, so the whole point is that it fits: the slice is self-bounded
 * against a byte budget, dropping node properties before it gives up and, if it
 * still will not fit, returning `{ tooLarge, counts, message }` instead of a
 * response the caller cannot use.
 */
import { getKgStore, kgNamespace } from "../kg-store/index.js";
import { responseBytes } from "../utils/index.js";
import type { DisplayNode, DisplayEdge, DisplayGraph } from "./types.js";
import { toDisplayNode } from "./display.js";
import { assembleDisplayGraph, projectDisplayEdges } from "./views.js";

// ── Export a scoped subtree (for an in-chat visualization artifact) ───────────
// Returns the containment descendants of `fromId` as a self-contained DisplayGraph
// — the SAME shape exportNamespace returns, so the explorer's view engine renders
// it unchanged, just over a smaller slice. "Containment" is the folded hasChild
// display axis (hasPart + reversed supports/alignment + illustrates + usesRoutine
// all collapse onto it in toDisplayEdges), i.e. exactly the tree the explorer
// walks — so this is one Course / chapter / week and everything nested beneath it.

const SUBTREE_DEFAULT_DEPTH = 4;
const SUBTREE_MAX_DEPTH = 12;
// Keep the scoped payload under the 100 KB global asJson cap, so the artifact
// data comes back as a normal response rather than being withheld. Measured the
// way asJson serializes it (pretty-printed). Leaves headroom for the wrapper.
// Tunable for ops (and tests) via TLM_SUBTREE_MAX_BYTES, mirroring walk_graph's
// TLM_WALK_MAX_PAGE_BYTES.
const DEFAULT_SUBTREE_MAX_BYTES = 80 * 1024;
const subtreeMaxBytes = (): number => {
  const override = Number(process.env.TLM_SUBTREE_MAX_BYTES);
  return Number.isFinite(override) && override > 0 ? override : DEFAULT_SUBTREE_MAX_BYTES;
};

const clampDepth = (depth: number): number =>
  Math.min(SUBTREE_MAX_DEPTH, Math.max(1, Math.floor(depth)));

const displayGraphBytes = (graph: DisplayGraph): number =>
  responseBytes(graph);

// The scoped node set for a subtree: the containment descendants of `fromId`,
// PLUS the alignment tail the Curriculum view grafts onto content leaves (a
// lesson/activity's aligned standard, and that standard's supporting components)
// so the "lesson → standard → components" branch renders instead of folding away.
//
// Both are computed over the display edges, which fold every containment/alignment
// edge onto r === "hasChild" while keeping the REAL type in `rel`:
//   • hasPart / usesRoutine / supports fold as parent(s) → child(t)  — walked outward.
//   • hasEducationalAlignment / illustrates fold as standard/component(s) → content(t).
// The tail closure is DIRECTIONAL, matching the view engine's alignmentTail: an
// in-scope content node pulls IN its standard (not the standard's other lessons),
// and an in-scope standard pulls in its components — so the scope stays a bounded
// lesson↔standard↔components star, never the whole spine.
const ALIGN_TO_PARENT_RELS = new Set(["hasEducationalAlignment", "illustrates"]); // content(t) → add its parent(s)
const SUPPORT_REL = "supports"; // standard(s) → add its component(t)

function scopedSubtreeIds(edges: DisplayEdge[], fromId: string, maxDepth: number): Set<string> {
  // 1. Containment descendants — BFS outward over folded hasChild, bounded to
  //    `maxDepth` hops, shortest-hop visitation like walk_graph.
  const childrenOf = new Map<string, string[]>();
  for (const e of edges) {
    if (e.r !== "hasChild") continue;
    const list = childrenOf.get(e.s) ?? [];
    list.push(e.t);
    childrenOf.set(e.s, list);
  }
  const reached = new Set<string>([fromId]);
  let frontier = [fromId];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const child of childrenOf.get(id) ?? []) {
        if (!reached.has(child)) {
          reached.add(child);
          next.push(child);
        }
      }
    }
    frontier = next;
  }

  // 2. Alignment-tail closure to a fixpoint (bounded: content → standard →
  //    components is only two levels, so this settles in a couple of passes).
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of edges) {
      if (e.r !== "hasChild") continue;
      if (ALIGN_TO_PARENT_RELS.has(e.rel) && reached.has(e.t) && !reached.has(e.s)) {
        reached.add(e.s); // content in scope → add the standard/component it aligns to
        changed = true;
      } else if (e.rel === SUPPORT_REL && reached.has(e.s) && !reached.has(e.t)) {
        reached.add(e.t); // standard in scope → add its supporting component
        changed = true;
      }
    }
  }
  return reached;
}

// Drop the per-node raw LC `props` bag — the detail-panel data — to shrink the
// payload when the caller doesn't need it (the default) or when the full-detail
// slice would overflow the budget.
const stripProps = (nodes: DisplayNode[]): DisplayNode[] =>
  nodes.map((n) => ({ ...n, props: {} }));

export type SubtreeExport =
  | DisplayGraph
  | { error: string }
  | { tooLarge: true; counts: { nodes: number; edges: number }; approxBytes: number; softCapBytes: number; message: string };

export async function exportSubtree(
  ns: string,
  fromId: string,
  opts: { maxDepth?: number; detail?: boolean } = {},
): Promise<SubtreeExport | null> {
  const store = getKgStore();
  const pointer = await store.readPointer(ns);
  if (!pointer) return null; // never seeded

  const slot = pointer.publishedSlot;
  const [storedNodes, storedEdges] = await Promise.all([
    store.listNodes(ns, slot),
    store.listEdges(ns, slot),
  ]);

  const allNodes = storedNodes.map(toDisplayNode);
  if (!allNodes.some((n) => n.id === fromId)) {
    return { error: `Start node '${fromId}' not found in the published graph for '${ns}'. Use namespace_stats to find a root (a Course/chapter), or walk_graph to find a node id.` };
  }
  const allEdges = projectDisplayEdges(allNodes, storedEdges);

  const maxDepth = clampDepth(opts.maxDepth ?? SUBTREE_DEFAULT_DEPTH);
  const scopedIds = scopedSubtreeIds(allEdges, fromId, maxDepth);
  const scopedNodes = allNodes.filter((n) => scopedIds.has(n.id));
  // Keep every display edge whose BOTH endpoints are in scope — so cross-links
  // among in-scope nodes (buildsTowards, relatesTo) render too, not just the
  // containment tree we walked.
  const scopedEdges = allEdges.filter((e) => scopedIds.has(e.s) && scopedIds.has(e.t));

  const note = `Read-only, published slot only (no draft). Scoped subtree from '${fromId}' (containment descendants to depth ${maxDepth}) — a self-contained slice for a single visualization.`;
  const build = (detail: boolean): DisplayGraph =>
    assembleDisplayGraph(detail ? scopedNodes : stripProps(scopedNodes), scopedEdges, ns, slot, note);

  // Honour the requested detail, but fall back to props-stripped if the detailed
  // slice would overflow the budget; if even the lean slice overflows, refuse
  // with a sized, actionable message rather than tripping the generic cap.
  const budget = subtreeMaxBytes();
  let graph = build(opts.detail ?? false);
  if (displayGraphBytes(graph) > budget && (opts.detail ?? false)) {
    graph = build(false);
  }
  const bytes = displayGraphBytes(graph);
  if (bytes > budget) {
    return {
      tooLarge: true,
      counts: { nodes: scopedNodes.length, edges: scopedEdges.length },
      approxBytes: bytes,
      softCapBytes: budget,
      message: `The subtree from '${fromId}' (${scopedNodes.length} nodes, ${scopedEdges.length} edges at depth ${maxDepth}) is ~${Math.round(bytes / 1024)} KB, over the ~${Math.round(budget / 1024)} KB budget for one visualization payload. Lower maxDepth, pick a deeper root (a chapter/week rather than the whole Course), or view the full graph in the live explorer instead.`,
    };
  }
  return graph;
}
