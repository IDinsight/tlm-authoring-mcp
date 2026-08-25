/*
 * The read-boundary projection: what a tool response drops from a stored node
 * or edge, and — just as important — what it must never drop.
 */
import { describe, it, expect } from "vitest";
import { nodeOut, edgeOut } from "../read-projection.js";
import type { RawGraphSnapshot } from "../../types.js";

type RawNode = RawGraphSnapshot["nodes"][number];
type RawEdge = RawGraphSnapshot["relationships"][number];

const ATTRIBUTION = "Node/edge types follow the Learning Commons ontology (CC BY-4.0). Curriculum content is taken verbatim from source documents…";

const storedNode = (properties: Record<string, unknown>): RawNode =>
  ({ id: "node-1", labels: ["Lesson"], properties }) as unknown as RawNode;

const storedEdge = (properties: Record<string, unknown>): RawEdge =>
  ({ id: "edge-1", type: "hasPart", start: "node-1", end: "node-2", properties }) as unknown as RawEdge;

describe("read projection", () => {
  it("drops provenance boilerplate but keeps the curriculum content", () => {
    const node = storedNode({
      attributionStatement: ATTRIBUTION,
      license: "https://creativecommons.org/licenses/by/4.0/",
      provider: "Learning Commons ontology (generated)",
      author: "Genesis Analytics",
      dateCreated: "2025-01-01",
      dateModified: "2025-01-02",
      academicSubject: "Mathematics",
      inLanguage: "fr-FR",
      jurisdiction: "Senegal",
      description: "Compter jusqu'à 10",
      position: 3,
      metadata: { role: "lesson", order: 3 },
    });

    const projected = nodeOut(node);

    expect(projected.properties).toEqual({
      description: "Compter jusqu'à 10",
      position: 3,
      metadata: { role: "lesson", order: 3 },
    });
    expect(projected.id).toBe("node-1");
    expect(projected.labels).toEqual(["Lesson"]);
  });

  it("drops a mirror property only when it really copies the top-level field", () => {
    const matching = nodeOut(storedNode({ identifier: "node-1", caseIdentifierUUID: "node-1" }));
    expect(matching.properties).toEqual({});

    // A divergent identifier is information, not an echo — it must survive.
    const divergent = nodeOut(storedNode({ identifier: "legacy-import-77" }));
    expect(divergent.properties).toEqual({ identifier: "legacy-import-77" });
  });

  it("drops the endpoint echoes an edge already carries in start/end", () => {
    const edge = storedEdge({
      identifier: "edge-1",
      relationshipType: "hasPart",
      sourceEntityValue: "node-1",
      targetEntityValue: "node-2",
      sourceEntity: "Course",
      targetEntity: "Lesson",
      sourceEntityKey: "identifier",
      targetEntityKey: "identifier",
      sourceLabels: ["Course"],
      targetLabels: ["Lesson"],
      attributionStatement: ATTRIBUTION,
      orderIndex: 4,
      axis: "content",
    });

    const projected = edgeOut(edge);

    // Only the two properties that say something about THIS edge remain.
    expect(projected.properties).toEqual({ orderIndex: 4, axis: "content" });
    expect(projected).toMatchObject({ id: "edge-1", type: "hasPart", start: "node-1", end: "node-2" });
  });

  it("leaves the stored object untouched", () => {
    const properties = { attributionStatement: ATTRIBUTION, description: "Séance 1" };
    const node = storedNode(properties);

    nodeOut(node);

    expect(properties.attributionStatement).toBe(ATTRIBUTION);
    expect(node.properties).toEqual({ attributionStatement: ATTRIBUTION, description: "Séance 1" });
  });

  it("handles a node or edge with no properties at all", () => {
    expect(nodeOut({ id: "n", labels: ["Lesson"] } as unknown as RawNode).properties).toEqual({});
    expect(edgeOut({ id: "e", type: "hasPart", start: "a", end: "b" } as unknown as RawEdge).properties).toEqual({});
  });
});

describe("the metadata extension sidecar", () => {
  it("drops extraction bookkeeping and keeps what the curriculum authored", () => {
    const node = storedNode({
      description: "Conjuguer des verbes au passé",
      metadata: {
        role: "session",
        day: "Jour 2",
        duration: 30,
        llm_model: "gemini-2.0",
        llm_rationale: "L'énoncé demande explicitement la conjugaison au passé.",
        provenance: { page_indices: [42, 43], bbox: [79, 40, 2860, 2024] },
        source_decision_ids: ["curriculum_skeleton:d452…:39764932"],
        canonical_node_id: "39764932-7dcb-52e9-96fe-e3cdbd82ce95",
        normalized_text: "conjuguer des verbes au passe",
      },
    });

    const projected = nodeOut(node);

    expect(projected.properties.metadata).toEqual({ role: "session", day: "Jour 2", duration: 30 });
  });

  it("strips the bookkeeping NESTED inside an authored value", () => {
    // aux_statements carries real guidance wrapped in per-entry provenance —
    // dropping the whole key would lose curriculum text.
    const node = storedNode({
      metadata: {
        aux_statements: [
          {
            role: "guidance",
            text: "Recherche de mots dans le dictionnaire",
            canonical_node_id: "c134703e-8d52-5ee1-a848-d0e0aefc92b5",
            page_indices: [69, 70],
            source_segment_ids: ["45e8cc96"],
            bbox: [111, 1459],
          },
        ],
      },
    });

    const projected = nodeOut(node);

    expect(projected.properties.metadata).toEqual({
      aux_statements: [{ role: "guidance", text: "Recherche de mots dans le dictionnaire" }],
    });
  });

  it("drops a description copy only when it really copies the description", () => {
    const copied = nodeOut(storedNode({
      description: "Séance 1",
      metadata: { split_display_text: "Séance 1", split_id_text: "Séance 1" },
    }));
    // Nothing survives, so the sidecar goes with it.
    expect(copied.properties.metadata).toBeUndefined();

    const diverged = nodeOut(storedNode({
      description: "Séance 1",
      metadata: { split_display_text: "Séance 1 (partie A)" },
    }));
    expect(diverged.properties.metadata).toEqual({ split_display_text: "Séance 1 (partie A)" });
  });

  it("drops the denormalized containment path, keeping what the graph cannot restate", () => {
    // progression_context restates the containment the walk already returns; the
    // week/session fields beside it are the node's own schedule and must stay.
    const node = storedNode({
      metadata: {
        progression_context: { thread_key: "substage=palier_2|week=15", topic_path_parts: [{ role: "week", label: "Semaine 15" }] },
        day: "Jour 2",
        session_order: 3,
      },
    });

    expect(nodeOut(node).properties.metadata).toEqual({ day: "Jour 2", session_order: 3 });
  });

  it("projects an edge's metadata the same way", () => {
    const edge = storedEdge({
      metadata: { phase: "révision", canonical_parent_id: "node-1", export_order_index: 4, source_kg: "reading_ce1" },
    });

    expect(edgeOut(edge).properties.metadata).toEqual({ phase: "révision" });
  });

  it("leaves the stored sidecar untouched", () => {
    const metadata = { role: "session", llm_model: "gemini-2.0" };
    const node = storedNode({ metadata });

    nodeOut(node);

    expect(metadata).toEqual({ role: "session", llm_model: "gemini-2.0" });
  });

  it("leaves a metadata value that is not an object alone", () => {
    expect(nodeOut(storedNode({ metadata: "opaque" })).properties.metadata).toBe("opaque");
    expect(nodeOut(storedNode({ metadata: null })).properties.metadata).toBeNull();
  });
});
