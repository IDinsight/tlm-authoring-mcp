/*
 * fromRawEnvelope — the restore path for a namespace with no subject adapter.
 *
 * The reserved `_catalog` / `_glossary` partitions hold real graphs that export
 * fine but cannot be re-derived by a parse, so `import-kg --raw` writes them back
 * verbatim. The invariant that makes an export a BACKUP rather than a diagnostic:
 * fromRawEnvelope must be an exact inverse of toRawEnvelope.
 */
import { describe, it, expect } from "vitest";
import { fromRawEnvelope, toRawEnvelope } from "../store-bridge.js";
import type { RawGraphSnapshot } from "../../types.js";

// A catalog in miniature: an entry under the root, holding one Material.
const catalog: RawGraphSnapshot = {
  nodes: [
    { id: "catalog-root", labels: ["InstructionalRoutine"], properties: { description: "Routine library" } },
    { id: "entry-1", labels: ["InstructionalRoutine"], properties: { description: "Fiche de fluidité", metadata: { catalogKind: "formatter" } } },
    { id: "mat-1", labels: ["Material"], properties: { description: "Spec", content: "…texte…" } },
  ],
  relationships: [
    { id: "hasPart:catalog-root->entry-1", type: "hasPart", start: "catalog-root", end: "entry-1", properties: { orderInParent: 1 } },
    { id: "hasPart:entry-1->mat-1", type: "hasPart", start: "entry-1", end: "mat-1", properties: { orderInParent: 1 } },
  ],
};

describe("fromRawEnvelope", () => {
  it("round-trips an envelope through store shape unchanged", () => {
    const restored = toRawEnvelope(fromRawEnvelope(catalog, "senegal/_catalog/routines"));
    expect(restored).toEqual(catalog);
  });

  it("stores every node non-spine, namespaced, with labels and raw props intact", () => {
    const { nodes } = fromRawEnvelope(catalog, "senegal/_catalog/routines");
    const entry = nodes.find((n) => n.id === "entry-1")!;
    expect(entry.spine).toBe(false);
    expect(entry.namespace).toBe("senegal/_catalog/routines");
    expect(entry.type).toBe("InstructionalRoutine");     // type = first LC label, as the explorer categorises by
    expect(entry.properties.raw).toEqual(catalog.nodes[1].properties);
  });

  it("preserves an original LC edge id through the round-trip", () => {
    // A graph authored upstream carries its own edge identifier; the stored id is
    // deterministic, so the original only survives inside properties.identifier.
    const withLcId: RawGraphSnapshot = {
      nodes: catalog.nodes,
      relationships: [{ ...catalog.relationships[0], id: "lc-edge-uuid", properties: { identifier: "lc-edge-uuid" } }],
    };
    const restored = toRawEnvelope(fromRawEnvelope(withLcId, "ns"));
    expect(restored.relationships[0].id).toBe("lc-edge-uuid");
  });

  it("keeps edge count faithful when a (type, from, to) triple repeats", () => {
    const duplicated: RawGraphSnapshot = {
      nodes: catalog.nodes,
      relationships: [catalog.relationships[0], catalog.relationships[0]],
    };
    expect(fromRawEnvelope(duplicated, "ns").edges).toHaveLength(2);
  });
});
