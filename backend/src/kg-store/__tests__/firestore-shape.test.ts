import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { toFirestoreShape, fromFirestoreShape, NESTED_ARRAY_KEY, FOLDED_JSON_KEY, FIRESTORE_MAX_DEPTH, nestingDepth, assertFirestoreStorable } from "../firestore-shape.js";

// Firestore refuses an array directly inside an array, which is how a page
// template writes a table's rows. The store wraps those on the way in and
// unwraps them on the way out; nothing above the store may notice.
const hasNestedArray = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.some((element) => Array.isArray(element) || hasNestedArray(element))
    : value !== null && typeof value === "object"
      ? Object.values(value as Record<string, unknown>).some(hasNestedArray)
      : false;

describe("Firestore shape — arrays nested in arrays", () => {
  const pupilLayout = JSON.parse(readFileSync(new URL("../../../test/fixtures/senegal-pupil-layout.json", import.meta.url), "utf8"));

  it("the pupil page template carries table rows Firestore would refuse", () => {
    expect(hasNestedArray(pupilLayout)).toBe(true);
  });

  it("wraps every nested array so the document is acceptable, and unwraps it byte for byte", () => {
    const stored = toFirestoreShape({ properties: { layout: pupilLayout } });
    expect(hasNestedArray(stored)).toBe(false);
    expect(fromFirestoreShape(stored)).toEqual({ properties: { layout: pupilLayout } });
  });

  it("wraps only what sits directly inside an array — a list under a key is left alone", () => {
    const node = { labels: ["Lesson"], properties: { raw: { columnsCm: [9.4, 8.2], tags: [] } } };
    expect(toFirestoreShape(node)).toEqual(node);
    expect(fromFirestoreShape(node)).toEqual(node);
  });

  it("handles three levels and empty inner arrays", () => {
    const deep = { grid: [[[1, 2], []], [[3]]] };
    const stored = toFirestoreShape(deep);
    expect(hasNestedArray(stored)).toBe(false);
    expect((stored.grid[0] as unknown as Record<string, unknown>)[NESTED_ARRAY_KEY]).toBeDefined();
    expect(fromFirestoreShape(stored)).toEqual(deep);
  });

  it("leaves dates, nulls and scalars untouched", () => {
    const when = new Date("2026-09-14T00:00:00Z");
    const record = { ts: when, none: null, n: 0, s: "" };
    expect(toFirestoreShape(record).ts).toBe(when);
    expect(fromFirestoreShape(toFirestoreShape(record))).toEqual(record);
  });
});

// A document nested more than twenty levels is refused too. The fiche template
// (nested tables, runs, pictures) fits in a node document; embedded before and
// after in an APPLY audit record it does not, and the live edit that added a
// rule to that formatter lost its audit and its version stamp (2026-09-14).
describe("Firestore shape — documents nested past the depth limit", () => {
  const ficheLayout = JSON.parse(readFileSync(new URL("../../../test/fixtures/senegal-fiche-layout.json", import.meta.url), "utf8"));
  const formatter = { id: "fmt", labels: ["Formatter"], properties: { raw: { description: "Gabarit", layout: ficheLayout } } };
  const applyRecord = {
    id: "a1", ts: "2026-09-14T14:55:00.000Z", actor: { id: "u" }, namespace: "senegal/ci/maths", eventType: "apply",
    diff: { nodes: { added: [], removed: [], changed: [{ id: "fmt", before: formatter, after: { ...formatter, properties: { raw: { ...formatter.properties.raw, lintRules: [{ id: "r", where: "guide", match: "x", message: "m" }] } } } }] }, edges: { added: [], removed: [], changed: [] } },
  };

  it("leaves the node document as it was — it fits, so nothing is folded", () => {
    const stored = toFirestoreShape(formatter);
    expect(JSON.stringify(stored)).not.toContain(FOLDED_JSON_KEY);
    expect(nestingDepth(stored)).toBeLessThanOrEqual(FIRESTORE_MAX_DEPTH);
    expect(fromFirestoreShape(stored)).toEqual(formatter);
  });

  it("folds the apply record that embeds it, so it fits, and unfolds it byte for byte", () => {
    expect(nestingDepth(toFirestoreShape(applyRecord.diff))).toBeGreaterThan(0);
    const stored = toFirestoreShape(applyRecord);
    expect(nestingDepth(stored)).toBeLessThanOrEqual(FIRESTORE_MAX_DEPTH);
    expect(JSON.stringify(stored)).toContain(FOLDED_JSON_KEY);
    expect(hasNestedArray(stored)).toBe(false);
    expect(fromFirestoreShape(stored)).toEqual(applyRecord);
    // The record's own top-level fields stay queryable — only deep subtrees fold.
    expect((stored as Record<string, unknown>).eventType).toBe("apply");
    expect((stored as { diff: { nodes: { changed: unknown[] } } }).diff.nodes.changed).toHaveLength(1);
  });

  it("is what the memory store asserts on every write, so the refusal fails a test and not a live edit", () => {
    expect(() => assertFirestoreStorable(applyRecord, "test")).not.toThrow();
    expect(() => assertFirestoreStorable({ grid: [[1]] }, "test")).not.toThrow();
  });
});
