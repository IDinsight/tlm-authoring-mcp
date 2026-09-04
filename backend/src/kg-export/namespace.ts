/*
 * Exporting ONE namespace's graph — the explorer's main read.
 *
 * Two things live here because they are the same question at different scopes:
 * which namespaces are offerable at all (a graph appears in the selector once it
 * has a published pointer), and the full graph for one of them.
 *
 * PUBLISHED IS THE DEFAULT AND THE DRAFT IS GATED BY THE CALLER. This module
 * will read the draft slot when asked and tag each node `chg` via the same
 * `diffGraphs` the curator loop uses, but it does not decide who may ask —
 * http.ts holds that to a curator of the namespace's workspace, and the
 * `KG_EXPLORER_PUBLIC` ungate is scoped to published reads and can never reach a
 * draft.
 */
import { getKgStore, kgNamespace, parseNamespace, diffGraphs } from "../kg-store/index.js";
import type { StoredNode, StoredEdge, MutationGraph, MutationNode, MutationEdge } from "../kg-store/index.js";
import { listAvailableContexts } from "../context/index.js";
import type { DisplayGraph, DisplayNode } from "./types.js";
import { nsLabel, toDisplayNode } from "./display.js";
import { assembleDisplayGraph, projectDisplayEdges } from "./views.js";

// ── Enumerate available namespaces (only those with a published pointer) ──────
export type NamespaceEntry = {
  ns: string; workspace: string; grade: string; subject: string;
  label: { fr: string; en: string };
  /** Whether an unpublished draft is open — the explorer offers its slot switch only then. */
  hasDraft: boolean;
};

export async function listExportNamespaces(): Promise<NamespaceEntry[]> {
  const store = getKgStore();
  const out: NamespaceEntry[] = [];
  for (const { workspace, grade, subject } of listAvailableContexts()) {
    const ns = kgNamespace(workspace, grade, subject);
    const pointer = await store.readPointer(ns).catch(() => null);
    if (!pointer) continue; // never seeded → not selectable
    out.push({ ns, workspace, grade, subject, label: nsLabel(grade, subject), hasDraft: Boolean(pointer.draftSlot) });
  }
  return out;
}

// ── Export one namespace (published, or — role-gated by the caller — the draft) ─
// Publish is an act of faith while the only view of a draft is a diff narrated
// back in chat. Reading the DRAFT slot here is what lets an expert LOOK at their
// own work before promoting it (self-serve-authoring.md, phase 1). The route in
// http.ts is what gates `slot:"draft"` to a curator — this function only reads.
export async function exportNamespace(
  ns: string,
  opts: { slot?: "published" | "draft" } = {},
): Promise<DisplayGraph | null> {
  const store = getKgStore();
  const pointer = await store.readPointer(ns);
  if (!pointer) return null; // never seeded

  const wantsDraft = opts.slot === "draft" && Boolean(pointer.draftSlot);
  const slot = wantsDraft ? pointer.draftSlot! : pointer.publishedSlot;
  const [storedNodes, storedEdges] = await Promise.all([
    store.listNodes(ns, slot),
    store.listEdges(ns, slot),
  ]);

  // The store holds the FULL Learning-Commons graph (spine + framework/derived
  // nodes + supports/relatesTo cross-links); the explorer renders all of it as-is.
  // No subject-specific post-processing — nodes are coloured by LC label, the
  // hierarchy walks hasChild, and the generic view exposes every node + edge.
  const nodes = storedNodes.map(toDisplayNode);

  // The diff runs BEFORE the edges are projected: it is what tells projection
  // which links are new, and the fold cannot be reversed afterwards.
  const draftChanges = wantsDraft
    ? await annotateDraftChanges(ns, pointer.publishedSlot, nodes, storedNodes, storedEdges)
    : null;

  const edges = projectDisplayEdges(nodes, storedEdges, draftChanges?.addedEdgeIds);

  const graph = assembleDisplayGraph(
    nodes,
    edges,
    ns,
    pointer.publishedSlot,
    wantsDraft
      ? "Read-only view of the UNPUBLISHED draft. Nodes are tagged `chg` (added / changed) and edges the draft created are tagged `chg:\"added\"`, both against the published version; nodes and links the draft removed are listed in meta.draft.removed / meta.draft.unlinked."
      : "Read-only, published slot only (no draft). Full Learning-Commons graph — the curriculum spine plus framework/derived nodes and supports/relatesTo cross-links.",
  );
  graph.meta.reading = wantsDraft ? "draft" : "published";
  graph.meta.draft = draftChanges
    ? draftChanges.meta
    : {
        open: Boolean(pointer.draftSlot),
        ...(opts.slot === "draft" && !pointer.draftSlot
          ? { note: "No draft in progress: the published version is shown." }
          : {}),
      };
  return graph;
}

type DraftChanges = {
  meta: NonNullable<DisplayGraph["meta"]["draft"]>;
  /** Stored ids of the edges this draft created — projectDisplayEdges tags these. */
  addedEdgeIds: Set<string>;
};

// Tag each draft node with how it differs from published, and report what the
// draft REMOVED (those nodes are gone from the draft, so they cannot carry a tag
// — they need their own list, or a deletion would be invisible). Deleted EDGES
// get the same treatment for the same reason.
//
// The comparison is diffGraphs — the very same one diff_draft and publish_draft
// use — so the coloured tree and the textual diff can never disagree.
//
// Tags `nodes` in place and returns the edge ids for the caller to thread into
// projectDisplayEdges.
async function annotateDraftChanges(
  ns: string,
  publishedSlot: string,
  nodes: DisplayNode[],
  draftNodes: StoredNode[],
  draftEdges: StoredEdge[],
): Promise<DraftChanges> {
  const store = getKgStore();
  const [publishedNodes, publishedEdges] = await Promise.all([
    store.listNodes(ns, publishedSlot as StoredNode["slot"]),
    store.listEdges(ns, publishedSlot as StoredEdge["slot"]),
  ]);
  const dropSlot = <T extends { slot: unknown }>(row: T): Omit<T, "slot"> => {
    const { slot: _slot, ...rest } = row;
    return rest;
  };
  const diff = diffGraphs(
    { nodes: publishedNodes.map((n) => dropSlot(n) as MutationNode), edges: publishedEdges.map((e) => dropSlot(e) as MutationEdge) },
    { nodes: draftNodes.map((n) => dropSlot(n) as MutationNode), edges: draftEdges.map((e) => dropSlot(e) as MutationEdge) },
  );

  const added = new Set(diff.nodes.added.map((entry) => entry.id));
  const changed = new Set(diff.nodes.changed.map((entry) => entry.id));
  for (const node of nodes) {
    if (added.has(node.id)) node.chg = "added";
    else if (changed.has(node.id)) node.chg = "changed";
  }

  const publishedById = new Map(publishedNodes.map((node) => [node.id, node]));
  const removed = diff.nodes.removed
    .map((entry) => publishedById.get(entry.id))
    .filter((node): node is StoredNode => Boolean(node))
    .map(toDisplayNode)
    .map((node) => ({ id: node.id, label: node.label, desc: node.desc }));

  // A deleted edge names ids; show the endpoints the way the tree does, falling
  // back to the raw id for an endpoint the same draft also deleted.
  const draftById = new Map(draftNodes.map((node) => [node.id, node]));
  const nameOf = (id: string): string => {
    const stored = draftById.get(id) ?? publishedById.get(id);
    if (!stored) return id;
    return toDisplayNode(stored).desc || id;
  };

  const unlinked = diff.edges.removed
    .map((entry) => entry.before as StoredEdge | undefined)
    .filter((edge): edge is StoredEdge => Boolean(edge))
    .map((edge) => ({ rel: edge.type, from: nameOf(edge.from), to: nameOf(edge.to) }));

  const addedEdgeIds = new Set(diff.edges.added.map((entry) => entry.id));

  return {
    meta: {
      open: true,
      counts: {
        added: added.size,
        changed: changed.size,
        removed: removed.length,
        linked: addedEdgeIds.size,
        unlinked: unlinked.length,
      },
      removed,
      unlinked,
    },
    addedEdgeIds,
  };
}
