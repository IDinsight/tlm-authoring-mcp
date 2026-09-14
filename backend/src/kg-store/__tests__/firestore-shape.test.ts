import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { toFirestoreShape, fromFirestoreShape, NESTED_ARRAY_KEY } from "../firestore-shape.js";

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
