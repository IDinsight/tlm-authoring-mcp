/*
 * computeGraphStats — roots cap
 *
 * namespace_stats must always return small, and must not call attached nodes
 * orphans. A node is placed either by being CONTAINED or by ALIGNING itself to a
 * standard; only a node with neither is a root. The interesting roots
 * (Course/Framework/grouping) sort first and the list is capped.
 */
import { describe, it, expect } from "vitest";
import { computeGraphStats } from "../stats.js";
import type { CurriculumModel, RawGraphSnapshot } from "../../types.js";

const modelOf = (raw: RawGraphSnapshot): CurriculumModel => ({ rawGraph: raw }) as unknown as CurriculumModel;

describe("computeGraphStats roots cap", () => {
  it("does not count alignment-attached nodes as roots", () => {
    // The Nigeria standards-only shape: 300 LearningComponents that `supports` the
    // framework. They have no containment parent, but they are attached — calling
    // them roots reads as 300 orphans to clean up.
    const raw: RawGraphSnapshot = {
      nodes: [
        { id: "fw", labels: ["StandardsFramework"], properties: {} },
        ...Array.from({ length: 300 }, (_u, i) => ({ id: `lc${i}`, labels: ["LearningComponent"], properties: {} })),
      ],
      relationships: Array.from({ length: 300 }, (_u, i) => ({
        id: `supports:lc${i}->fw`, type: "supports", start: `lc${i}`, end: "fw", properties: {},
      })),
    } as unknown as RawGraphSnapshot;

    const stats = computeGraphStats(modelOf(raw));

    // Only the framework is genuinely unplaced.
    expect(stats.rootsTotal).toBe(1);
    expect(stats.roots[0].labels).toContain("StandardsFramework");
    expect(stats.attachedByAlignment).toEqual({ count: 300, byLabel: { LearningComponent: 300 } });
    // Flags still come from the full set.
    expect(stats.structuralFlags).toContain("no Course (content root) authored");
  });

  it("does not count an illustrative Activity as a root (the ci/maths case)", () => {
    // An Activity that aligns OUT to its component's SFI: nothing points in to it,
    // but buildSlice reaches it by reverse lookup from the standard.
    const raw: RawGraphSnapshot = {
      nodes: [
        { id: "sfi", labels: ["StandardsFrameworkItem"], properties: {} },
        { id: "task", labels: ["Activity"], properties: {} },
        { id: "stranded", labels: ["LessonGrouping"], properties: {} },
      ],
      relationships: [
        { id: "hasEducationalAlignment:task->sfi", type: "hasEducationalAlignment", start: "task", end: "sfi", properties: {} },
      ],
    } as unknown as RawGraphSnapshot;

    const stats = computeGraphStats(modelOf(raw));
    const rootIds = stats.roots.map((root) => root.id);

    expect(rootIds).not.toContain("task");
    // The genuinely stranded grouping IS still reported — that is a real finding.
    expect(rootIds).toContain("stranded");
    expect(stats.attachedByAlignment.count).toBe(1);
  });

  it("counts a routine attached by usesRoutine as attached, not a root", () => {
    const raw: RawGraphSnapshot = {
      nodes: [
        { id: "lesson", labels: ["Lesson"], properties: {} },
        { id: "routine", labels: ["InstructionalRoutine"], properties: {} },
        { id: "step", labels: ["Material"], properties: {} },
      ],
      relationships: [
        { id: "usesRoutine:lesson->routine", type: "usesRoutine", start: "lesson", end: "routine", properties: {} },
        { id: "hasPart:routine->step", type: "hasPart", start: "routine", end: "step", properties: {} },
      ],
    } as unknown as RawGraphSnapshot;

    const stats = computeGraphStats(modelOf(raw));

    expect(stats.roots.map((root) => root.id)).toEqual(["lesson"]);
    expect(stats.attachedByAlignment.byLabel).toEqual({ InstructionalRoutine: 1 });
  });

  it("reports only edge-less nodes as isolated", () => {
    const raw: RawGraphSnapshot = {
      nodes: [
        { id: "sfi", labels: ["StandardsFrameworkItem"], properties: {} },
        { id: "task", labels: ["Activity"], properties: {} },
        { id: "nowhere", labels: ["Material"], properties: {} },
      ],
      relationships: [
        { id: "hasEducationalAlignment:task->sfi", type: "hasEducationalAlignment", start: "task", end: "sfi", properties: {} },
      ],
    } as unknown as RawGraphSnapshot;

    const stats = computeGraphStats(modelOf(raw));

    // The aligned Activity and the standard it points at are both reachable;
    // only the untouched Material is genuinely orphaned.
    expect(stats.isolatedCount).toBe(1);
  });

  it("still caps at 50 when there are genuinely many roots", () => {
    const raw: RawGraphSnapshot = {
      nodes: [
        { id: "fw", labels: ["StandardsFramework"], properties: {} },
        // Stranded: no containment parent AND no alignment of their own.
        ...Array.from({ length: 300 }, (_u, i) => ({ id: `orphan${i}`, labels: ["LessonGrouping"], properties: {} })),
      ],
      relationships: [],
    } as unknown as RawGraphSnapshot;

    const stats = computeGraphStats(modelOf(raw));
    expect(stats.rootsTotal).toBe(301);
    expect(stats.roots.length).toBe(50);
    expect(stats.attachedByAlignment.count).toBe(0);
  });

  it("does not cap or note when roots fit under the limit", () => {
    const raw: RawGraphSnapshot = {
      nodes: [
        { id: "course", labels: ["Course"], properties: {} },
        { id: "ch1", labels: ["LessonGrouping"], properties: {} },
      ],
      relationships: [{ id: "hasPart:course->ch1", type: "hasPart", start: "course", end: "ch1", properties: {} }],
    } as unknown as RawGraphSnapshot;

    const stats = computeGraphStats(modelOf(raw));
    expect(stats.rootsTotal).toBe(1);         // only the Course is a root
    expect(stats.roots.length).toBe(1);
    expect(stats.roots[0].labels).toContain("Course");
  });
});
