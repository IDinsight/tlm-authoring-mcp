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
