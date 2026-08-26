import { buildViewIndex, ancestorsOf } from "./viewIndex";
import type { GraphModel } from "./graphModel";
import type { ViewSpec } from "../types";

// What the tree renders when a filter is active: `keep` is pruned to, `hits` is
// highlighted, and every kept branch is force-expanded. The draft change filter
// (lib/changes.ts) produces the same shape, so the tree handles both unchanged.
export type TreeFilter = {
  keep: Set<string>; // every node to render (matches + their ancestors)
  hits: Set<string>; // the nodes that actually matched (highlighted)
};

export type SearchResult = TreeFilter;

// Filter the current view to nodes matching `query`, keeping each match's
// ancestors so the path stays visible. Mirrors the original explorer's search:
// a real node matches on its French/English text or its code.
export function computeSearch(
  model: GraphModel,
  spec: ViewSpec,
  query: string,
  sourceOn: Record<string, boolean>,
): SearchResult {
  const q = query.toLowerCase().trim();
  const keep = new Set<string>();
  const hits = new Set<string>();
  if (!q) return { keep, hits };

  const index = buildViewIndex(model, spec, sourceOn);

  const matches = (id: string): boolean => {
    const n = model.N[id];
    if (!n) return false;
    return (
      (n.desc || "").toLowerCase().includes(q) ||
      (n.desc_en || "").toLowerCase().includes(q) ||
      (n.code || "").toLowerCase().includes(q)
    );
  };

  model.data.nodes.forEach((n) => {
    if (!matches(n.id)) return;
    hits.add(n.id);
    keep.add(n.id);
    ancestorsOf(index, n.id).forEach((ancestor) => keep.add(ancestor));
  });

  return { keep, hits };
}
