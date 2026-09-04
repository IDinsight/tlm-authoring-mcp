/*
 * Copying an entry's subtree out of a catalog.
 *
 * Using an entry COPIES it: the entry and everything under it get fresh ids in
 * the destination namespace, so the copy is INDEPENDENT and later edits to the
 * library entry never reach copies already made. That independence is the point
 * — a workspace that adopted a routine last term is not silently rewritten when
 * the master drifts.
 *
 * The clone is produced against the CATALOG graph and applied against the active
 * one, which is why it is a plain function here rather than part of a mutation:
 * a mutation's apply() only ever sees the base graph it is writing to.
 */
import { edgeId, type MutationEdge, type MutationGraph, type MutationNode } from "../../kg-store/index.js";
import { CONTAINMENT, indexContainment } from "./entries.js";

// Everything reachable from an entry via hasPart (the entry, its steps, their
// Materials) — the subtree a copy carries.
export function subtreeIds(entryId: string, children: Map<string, string[]>): string[] {
  const ids: string[] = [];
  const stack = [entryId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    for (const c of children.get(id) ?? []) stack.push(c);
  }
  return ids;
}

export type ClonedSubtree = { nodes: MutationNode[]; edges: MutationEdge[]; newEntryId: string; idMap: Record<string, string> };

// Copy an entry's subtree into `namespace` with fresh ids. `mint(oldId)` supplies the
// new id for each node (the tool passes a stable map so dry-run and confirm agree).
// Returns the cloned nodes/edges (hasPart re-pointed to the new ids) and the new entry
// id the caller attaches a `usesRoutine` edge to. null when `entryId` isn't in the graph.
export function cloneRoutineSubtree(catalog: MutationGraph, entryId: string, namespace: string, mint: (oldId: string) => string): ClonedSubtree | null {
  const { byId, children } = indexContainment(catalog);
  if (!byId.has(entryId)) return null;

  const ids = subtreeIds(entryId, children);
  const idMap: Record<string, string> = {};
  for (const oldId of ids) idMap[oldId] = mint(oldId);

  const idSet = new Set(ids);
  const nodes: MutationNode[] = ids.map((oldId) => ({ ...(byId.get(oldId) as MutationNode), id: idMap[oldId], namespace, spine: false }));
  const edges: MutationEdge[] = catalog.edges
    .filter((e) => e.type === CONTAINMENT && idSet.has(e.from) && idSet.has(e.to))
    .map((e) => ({ id: edgeId(CONTAINMENT, idMap[e.from], idMap[e.to]), type: CONTAINMENT, from: idMap[e.from], to: idMap[e.to], namespace, properties: e.properties ?? {} }));

  return { nodes, edges, newEntryId: idMap[entryId], idMap };
}
