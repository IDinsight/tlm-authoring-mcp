/*
 * explorer/lib · view index — every row in a view, and its parent row
 *
 * The tree is built lazily: `viewChildren` answers "what hangs under this row"
 * one row at a time, and nothing walks the whole view. Three features need the
 * opposite direction — given a node, what is the chain of rows above it:
 * search (reveal a match's ancestors), the draft change filter, and auto-expand.
 *
 * A row can be synthetic (a "grp:"/"kind:" bucket in the grouped and by-type
 * views), so this is NOT the same as the graph's hasChild parent — a Semaine in
 * the Curriculum view hangs under a grouping bucket that exists only on screen.
 */

import type { GraphModel } from "./graphModel";
import type { ViewSpec } from "../types";

export type ViewIndex = {
  /** Row id → the row directly above it. Absent for a view root. */
  parentOf: Record<string, string>;
  /** Every row reachable in this view, synthetic buckets included. */
  rows: Set<string>;
};

/**
 * Walk one view top to bottom and record each row's parent.
 *
 * `sourceOn` matters: a row filtered out by the source chips is not walked, so
 * its subtree is absent from the index too — the same rows the tree renders.
 */
export function buildViewIndex(
  model: GraphModel,
  spec: ViewSpec,
  sourceOn: Record<string, boolean>,
): ViewIndex {
  const parentOf: Record<string, string> = {};
  const rows = new Set<string>();

  const walk = (id: string) => {
    // A node reachable by two paths (a maths lesson sits under both its chapter
    // and its week) keeps the first parent we reach — one revealed path is enough.
    if (rows.has(id)) return;
    rows.add(id);

    for (const child of model.viewChildren(spec, id, sourceOn)) {
      if (!parentOf[child]) {
        parentOf[child] = id;
      }
      walk(child);
    }
  };

  model.viewRoots(spec).forEach(walk);

  return { parentOf, rows };
}

/** Every row above `id`, nearest first. Empty when `id` is a root or absent. */
export function ancestorsOf(index: ViewIndex, id: string): string[] {
  const chain: string[] = [];
  let parent = index.parentOf[id];

  while (parent) {
    chain.push(parent);
    parent = index.parentOf[parent];
  }

  return chain;
}
