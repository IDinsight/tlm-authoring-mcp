/*
 * The SHAPE of a fixture graph, and the manifest that pins it.
 *
 * The committed fixtures are the ground truth for ~27 suites, and they are a
 * snapshot of a live graph that keeps moving. When the snapshot goes unrefreshed
 * the suites keep passing while testing a curriculum that no longer exists:
 * ci/maths held 0 `DocumentSection`s here long after production had grown ~1,100
 * of them, so every section-based generation test was green against a shape the
 * server never sees. Nothing failed, because nothing was watching.
 *
 * A shape is a coarse census — how many nodes carry each Learning-Commons label,
 * how many edges carry each type — deliberately too blunt to notice a reworded
 * lesson and precisely sharp enough to notice a structural change. It is pinned
 * in `test/fixtures/SHAPE.json` and asserted by fixture-shape.test.ts, so a
 * refresh that alters what the suites stand on FAILS until someone reads the
 * diff and re-pins it on purpose. The manifest is the review gate, not a cache.
 *
 * `scripts/refresh-fixtures.mjs` reads this module too — one definition of
 * "shape" for the offline test and the credentialed refresh, so the two can
 * never disagree about what drifted.
 */

/** A node's LC labels and an edge's type, counted. Both maps are key-sorted. */
export type FixtureShape = {
  nodes: number;
  edges: number;
  /** LC label → how many nodes carry it. A node with two labels counts under both. */
  nodesByLabel: Record<string, number>;
  /** Relationship type (`hasPart`, `covers`, …) → how many edges carry it. */
  edgesByType: Record<string, number>;
};

export type FixtureShapeManifest = {
  note: string;
  /** When the fixtures were last pulled from the live store, or null if never. */
  refreshedAt: string | null;
  /** "<workspace>/<grade>/<subject>" → the shape pinned for it. */
  contexts: Record<string, FixtureShape>;
};

/** The raw Learning-Commons envelope, as the fixtures and `export-kg` write it. */
type RawEnvelope = {
  nodes?: Array<{ labels?: unknown }>;
  relationships?: Array<{ type?: unknown }>;
};

// Sorted so a manifest re-write produces a stable diff — an unsorted map would
// reorder on every refresh and bury the one count that actually changed.
const sortedTally = (values: string[]): Record<string, number> => {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
};

export function fixtureShape(envelope: RawEnvelope): FixtureShape {
  const nodes = envelope.nodes ?? [];
  const edges = envelope.relationships ?? [];
  const labels = nodes.flatMap((n) => (Array.isArray(n.labels) ? n.labels.filter((l): l is string => typeof l === "string") : []));
  const types = edges.map((e) => (typeof e.type === "string" ? e.type : "(untyped)"));
  return {
    nodes: nodes.length,
    edges: edges.length,
    nodesByLabel: sortedTally(labels),
    edgesByType: sortedTally(types),
  };
}

/** One drifted count: the key, what the manifest pins, what the graph holds. */
export type ShapeDelta = { key: string; pinned: number; actual: number };

/*
 * Every count that differs, as a flat list a caller can print. Keys read as
 * `nodes`, `edges`, `nodesByLabel.Lesson`, `edgesByType.covers` — the path to
 * the number, so a failure names the structure that moved rather than dumping
 * two objects for the reader to diff by eye. A key present on one side only is
 * reported with 0 on the other, which is the honest reading: the label or edge
 * type went to zero, or arrived from nothing.
 */
export function shapeDeltas(pinned: FixtureShape, actual: FixtureShape): ShapeDelta[] {
  const deltas: ShapeDelta[] = [];
  const compare = (key: string, a: number, b: number) => { if (a !== b) deltas.push({ key, pinned: a, actual: b }); };

  compare("nodes", pinned.nodes, actual.nodes);
  compare("edges", pinned.edges, actual.edges);
  for (const group of ["nodesByLabel", "edgesByType"] as const) {
    const keys = [...new Set([...Object.keys(pinned[group]), ...Object.keys(actual[group])])].sort();
    for (const k of keys) compare(`${group}.${k}`, pinned[group][k] ?? 0, actual[group][k] ?? 0);
  }
  return deltas;
}

/** A drift list as printable lines, e.g. `nodesByLabel.DocumentSection: 0 → 1096 (+1096)`. */
export const formatDeltas = (deltas: ShapeDelta[]): string =>
  deltas
    .map(({ key, pinned, actual }) => {
      const sign = actual > pinned ? "+" : "";
      return `  ${key}: ${pinned} → ${actual} (${sign}${actual - pinned})`;
    })
    .join("\n");
