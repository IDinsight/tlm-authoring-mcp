/*
 * explorer/lib · finding a draft's changes in the tree
 *
 * The draft read tags changed nodes with `chg`, but a tag only helps once you
 * are looking at the row. In a 2000-node graph the changed node is three levels
 * down inside a collapsed branch — and often on a tab you are not on, since the
 * counts are graph-wide while the tree is per-view.
 *
 * This module turns "1 modifié" into "here it is": a tree filter, a per-tab
 * count, and the ancestor set that opens the tree straight to the changes.
 */

import { buildViewIndex, ancestorsOf, type ViewIndex } from "./viewIndex";
import type { GraphModel } from "./graphModel";
import type { TreeFilter } from "./search";
import type { ViewSpec } from "../types";

/**
 * Rows this draft touched, in the order the view walk reached them.
 *
 * Two ways a row counts. The node itself differs from published (`chg`), OR the
 * link that hangs it under its parent is new — `use_routine` attaching an
 * existing routine to a lesson writes only an edge, so the routine's row is
 * untagged yet is genuinely new *here*. Without the second test the filter and
 * the tab counts would both miss it, which is the whole point of finding it.
 */
function changedRows(model: GraphModel, index: ViewIndex): string[] {
  const found: string[] = [];

  for (const id of index.rows) {
    if (model.N[id]?.chg) {
      found.push(id);
      continue;
    }

    const parent = index.parentOf[id];
    if (!parent) continue;

    const link = model.relBetween(parent, id);
    if (link?.chg === "added") found.push(id);
  }

  return found;
}

/**
 * A tree filter holding only this draft's added/changed nodes and the rows above
 * them — the same `{ keep, hits }` shape search produces, so the tree prunes and
 * force-expands it with no extra code.
 */
export function computeChangeFilter(
  model: GraphModel,
  spec: ViewSpec,
  sourceOn: Record<string, boolean>,
): TreeFilter {
  const index = buildViewIndex(model, spec, sourceOn);
  const keep = new Set<string>();
  const hits = new Set<string>();

  for (const id of changedRows(model, index)) {
    hits.add(id);
    keep.add(id);
    ancestorsOf(index, id).forEach((ancestor) => keep.add(ancestor));
  }

  return { keep, hits };
}

/**
 * How many changed nodes each view contains, keyed by view id.
 *
 * This is what tells you the edit is on Curriculum while you are on Standards.
 * Counts differ per view by design: a node the current view does not show is not
 * counted there, and the by-type view reaches everything so it counts them all.
 */
export function countChangesByView(
  model: GraphModel,
  specs: ViewSpec[],
  sourceOn: Record<string, boolean>,
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const spec of specs) {
    const index = buildViewIndex(model, spec, sourceOn);
    counts[spec.id] = changedRows(model, index).length;
  }

  return counts;
}

/**
 * The rows to expand so every change in this view is on screen without the user
 * unfolding anything.
 *
 * Returns an empty set past `maxChanges`: opening the ancestors of 200 edits
 * unfolds most of the graph, which hides the changes instead of showing them.
 * Past that point the filter is the right tool.
 */
export function revealChanges(
  model: GraphModel,
  spec: ViewSpec,
  sourceOn: Record<string, boolean>,
  maxChanges: number,
): Set<string> {
  const index = buildViewIndex(model, spec, sourceOn);
  const changed = changedRows(model, index);
  if (changed.length === 0 || changed.length > maxChanges) return new Set();

  const reveal = new Set<string>();
  for (const id of changed) {
    ancestorsOf(index, id).forEach((ancestor) => reveal.add(ancestor));
  }

  return reveal;
}
