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
 * The same applies inside the `metadata` extension sidecar, which the first pass
 * did not look into: on ce1/reading it is 38% of the stored graph and 70% of a
 * default walk_graph page, nearly all of it PDF-extraction bookkeeping (bboxes,
 * decision ids, LLM rationales, verbatim copies of `description`). No module in
 * src/ reads any of those keys.
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

// ── The `metadata` extension sidecar ─────────────────────────────────────────

/**
 * Keys inside `metadata` that describe how a node GOT here, not what it teaches:
 * page coordinates, source-document and decision ids, the extracting model and
 * its reasoning, the text-splitting audit trail. A curriculum author never asks
 * any of them, and nothing in src/ reads them — they are kept at rest for
 * faithful re-export and dropped on the way out.
 *
 * Applied at ANY DEPTH inside metadata, because the same bookkeeping is nested
 * inside otherwise-meaningful values: `aux_statements` carries real authored
 * guidance (`role` + `text`) wrapped in per-entry bboxes and decision ids, so a
 * recursive strip keeps the guidance and drops the wrapper.
 */
const METADATA_BOOKKEEPING_KEYS = new Set([
  // Where in the source PDF this came from.
  "bbox",
  "bbox_ref",
  "page_indices",
  "pdf_name",
  "pdfName",
  "doc_key",
  "provenance",
  "provenance_context",
  // Which pipeline run / decision produced it.
  "decision_set_id",
  "export_dialect",
  "source_kg",
  "source_label",
  "source_decision_ids",
  "source_segment_ids",
  "canonical_edge_source_decision_ids",
  "canonical_edge_source_segment_ids",
  "id_source_kind",
  // Ids of the pipeline's own intermediate nodes, not ids of anything callable.
  "canonical_node_id",
  "canonical_parent_id",
  "canonical_child_id",
  "canonical_order_index",
  "export_parent_id",
  "export_order_index",
  "supporting_sfi_case_uuid",
  // The extracting model and why it split a statement the way it did.
  "llm_model",
  "llm_rationale",
  "split_policy",
  "split_index",
  "split_hash",
  "split_truncated",
  // A case-folded, accent-stripped copy of `description`, for the importer's
  // own matching. Derived text, never the text to show or edit.
  "normalized_text",
  // The importer's denormalized copy of where the node sits — thread/topic path
  // keys rebuilt from the containment the graph itself already expresses, and
  // which find_node hands back as a real `path`. Reading it from here is reading
  // a cache of the graph instead of the graph.
  "progression_context",
]);

/**
 * Metadata keys holding a VERBATIM copy of the node's `description`. Dropped
 * only when the copy really matches — the same rule the top-level mirror keys
 * follow, so a graph where the split text genuinely diverged keeps it.
 */
const METADATA_DESCRIPTION_COPIES = ["split_display_text", "split_id_text"];

/** Recursively drop the bookkeeping keys from a metadata value of any shape. */
function stripBookkeeping(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripBookkeeping);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  const kept: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (METADATA_BOOKKEEPING_KEYS.has(key)) {
      continue;
    }
    kept[key] = stripBookkeeping(child);
  }
  return kept;
}

/**
 * Project `properties.metadata` in place: strip the bookkeeping, drop the
 * description copies that really are copies, and remove the sidecar entirely
 * when nothing survives (an empty object is 15 bytes on every node of a
 * 2000-node graph).
 */
function projectMetadata(properties: Record<string, unknown>): void {
  const metadata = properties.metadata;
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return;
  }

  const stripped = stripBookkeeping(metadata) as Record<string, unknown>;

  const description = properties.description;
  for (const key of METADATA_DESCRIPTION_COPIES) {
    if (stripped[key] === description) {
      delete stripped[key];
    }
  }

  if (Object.keys(stripped).length === 0) {
    delete properties.metadata;
    return;
  }
  properties.metadata = stripped;
}

/** Project a stored node into the shape a tool response carries. */
export function nodeOut(node: RawNode): NodeOut {
  const out: NodeOut = { id: node.id, labels: node.labels ?? [], properties: {} };
  out.properties = project(node.properties ?? {}, PROVENANCE_KEYS, NODE_MIRROR_KEYS, out);
  projectMetadata(out.properties);
  return out;
}

/** Project a stored edge into the shape a tool response carries. */
export function edgeOut(edge: RawEdge): EdgeOut {
  const out: EdgeOut = { id: edge.id, type: edge.type, start: edge.start, end: edge.end, properties: {} };
  out.properties = project(edge.properties ?? {}, EDGE_DROP_KEYS, EDGE_MIRROR_KEYS, out);
  projectMetadata(out.properties);
  return out;
}
