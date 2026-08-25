/*
 * Module: curriculum · read-boundary node/edge projection
 *
 * The one place that turns a stored raw Learning-Commons node/edge into the
 * shape a TOOL RESPONSE carries. Every stored edge repeats the same 436-char
 * `attributionStatement`, plus `identifier` (a copy of its own id) and
 * `relationshipType` (a copy of its own type) — measured at 61% of a default
 * walk_graph page, which is why a 50-node page delivered 4 nodes. Stripping
 * those here buys back the reader's token budget without touching the store.
 *
 * READ BOUNDARY ONLY. `toRawEnvelope` (store-bridge.ts) is what export-kg and
 * adapter.parse consume, and it does NOT go through this file — so faithful
 * re-export and parsing still see every original property.
 */
import type { RawGraphSnapshot } from "../types.js";

type RawNode = RawGraphSnapshot["nodes"][number];
type RawEdge = RawGraphSnapshot["relationships"][number];

/** A bare node as returned to a caller — raw LC labels + the projected properties. */
export type NodeOut = { id: string; labels: string[]; properties: Record<string, unknown> };

/** A bare edge as returned to a caller — endpoints + the projected properties. */
export type EdgeOut = { id: string; type: string; start: string; end: string; properties: Record<string, unknown> };

// Provenance and licensing that is identical on (nearly) every node and edge of a
// graph: the CC-BY attribution blurb, the source system, the import timestamps.
// It says nothing about THIS node, and the namespace already tells the reader the
// subject and language.
const PROVENANCE_KEYS = new Set([
  "attributionStatement",
  "license",
  "provider",
  "author",
  "dateCreated",
  "dateModified",
  "academicSubject",
  "inLanguage",
  "jurisdiction",
]);

// Edge properties that re-describe the endpoints already present as `start`/`end`
// — e.g. sourceEntity:"Course", targetEntityKey:"identifier", targetLabels:["Lesson"].
// A caller that needs an endpoint's labels reads the endpoint node.
const EDGE_ENDPOINT_ECHO_KEYS = [
  "sourceEntity",
  "targetEntity",
  "sourceEntityKey",
  "targetEntityKey",
  "sourceLabels",
  "targetLabels",
];

// Built once: edgeOut runs per edge on every page, so this must not re-allocate.
const EDGE_DROP_KEYS = new Set([...PROVENANCE_KEYS, ...EDGE_ENDPOINT_ECHO_KEYS]);

// Properties that mirror a top-level field, mapped to the field they copy. These
// are dropped ONLY when the value really matches — a graph where `identifier`
// diverges from `id` is carrying information, so it survives.
const NODE_MIRROR_KEYS: Record<string, keyof NodeOut> = {
  identifier: "id",
  caseIdentifierUUID: "id",
};
const EDGE_MIRROR_KEYS: Record<string, "id" | "type" | "start" | "end"> = {
  identifier: "id",
  relationshipType: "type",
  sourceEntityValue: "start",
  targetEntityValue: "end",
};

/**
 * Drop `keys` from `properties`, plus any mirror key whose value equals the
 * top-level field it copies. Returns a new object; the input is untouched.
 */
function project(
  properties: Record<string, unknown>,
  alwaysDrop: Set<string>,
  mirrors: Record<string, string>,
  topLevel: Record<string, unknown>,
): Record<string, unknown> {
  const kept: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (alwaysDrop.has(key)) {
      continue;
    }
    const mirroredField = mirrors[key];
    if (mirroredField !== undefined && value === topLevel[mirroredField]) {
      continue;
    }
    kept[key] = value;
  }

  return kept;
}

/** Project a stored node into the shape a tool response carries. */
export function nodeOut(node: RawNode): NodeOut {
  const out: NodeOut = { id: node.id, labels: node.labels ?? [], properties: {} };
  out.properties = project(node.properties ?? {}, PROVENANCE_KEYS, NODE_MIRROR_KEYS, out);
  return out;
}

/** Project a stored edge into the shape a tool response carries. */
export function edgeOut(edge: RawEdge): EdgeOut {
  const out: EdgeOut = { id: edge.id, type: edge.type, start: edge.start, end: edge.end, properties: {} };
  out.properties = project(edge.properties ?? {}, EDGE_DROP_KEYS, EDGE_MIRROR_KEYS, out);
  return out;
}
