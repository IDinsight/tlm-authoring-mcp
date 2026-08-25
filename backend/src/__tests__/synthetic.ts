/*
 * A tiny hand-built Learning-Commons graph, for the shapes the live curriculum
 * no longer contains.
 *
 * ci/maths retired two things when its Student's Book became a
 * TeachingLearningMaterial: `Chapitre` groupings (it has weeks now), and any
 * Activity filed under a Lesson by `hasPart`. Both are still supported by the
 * code — a subject may group by Chapitre/Unité/Module, and move_node must keep a
 * node's alignment when it moves along the containment axis — so the suites that
 * test THOSE mechanics need a graph that has them. Everything else should use
 * the real fixture and stay honest about production's shape.
 *
 * Deliberately minimal and deterministic: no provenance boilerplate, ids that
 * read as what they are, and exactly enough structure to exercise a move.
 *
 *   framework ─hasChild→ standard
 *   course ─hasPart→ chapter ─hasPart→ lesson-a ─hasPart→ activity
 *          │                 ├hasPart→ lesson-b        └hasEducationalAlignment→ standard
 *          │                 └hasPart→ lesson-c
 *          ├hasPart→ chapter-2       (chapter ─hasDependency→ chapter-2: progression)
 *          ├hasPart→ week-a          (the schedule axis, for two-axis moves)
 *          └hasPart→ week-b
 */
import type { RawGraphSnapshot } from "../types.js";

export const SYNTHETIC_IDS = {
  framework: "syn-framework",
  standard: "syn-standard",
  course: "syn-course",
  chapter: "syn-chapter",
  chapter2: "syn-chapter-2",
  lessonA: "syn-lesson-a",
  lessonB: "syn-lesson-b",
  lessonC: "syn-lesson-c",
  weekA: "syn-week-a",
  weekB: "syn-week-b",
  activity: "syn-activity",
} as const;

const node = (id: string, label: string, properties: Record<string, unknown>) => ({
  id,
  labels: [label],
  properties: { identifier: id, inLanguage: "fr-FR", ...properties },
});

const edge = (type: string, start: string, end: string, orderIndex = 0) => ({
  id: `${type}:${start}->${end}`,
  type,
  start,
  end,
  properties: { relationshipType: type, orderIndex },
});

/**
 * The LC envelope. Parses through any subject adapter, so a suite can seed it
 * into an existing namespace and keep using that context's adapter.
 */
export function chapterFixtureGraph(): RawGraphSnapshot {
  const nodes = [
    node(SYNTHETIC_IDS.framework, "StandardsFramework", {
      description: "Cadre synthétique",
      name: "Cadre synthétique",
    }),
    node(SYNTHETIC_IDS.standard, "StandardsFrameworkItem", {
      description: "compter jusqu'à 10",
      normalizedStatementType: "Standard",
      statementType: "Arithmétique",
      metadata: { role: "expectation", order: 1 },
      position: 1,
    }),
    node(SYNTHETIC_IDS.course, "Course", {
      description: "Cours synthétique",
      normalizedType: "Course",
      position: 1,
    }),
    node(SYNTHETIC_IDS.chapter, "LessonGrouping", {
      description: "Chapitre 1",
      groupName: "Chapitre",
      groupLevel: 1,
      metadata: { role: "chapter", order: 1 },
      position: 1,
    }),
    // A second chapter, so chapter→chapter progression has somewhere to point.
    node(SYNTHETIC_IDS.chapter2, "LessonGrouping", {
      description: "Chapitre 2",
      groupName: "Chapitre",
      groupLevel: 1,
      metadata: { role: "chapter", order: 2 },
      position: 2,
    }),
    node(SYNTHETIC_IDS.lessonA, "Lesson", {
      description: "Leçon A",
      normalizedType: "Lesson",
      educationalUse: "Instruction",
      metadata: { order: 1 },
      position: 1,
    }),
    node(SYNTHETIC_IDS.lessonB, "Lesson", {
      description: "Leçon B",
      normalizedType: "Lesson",
      educationalUse: "Instruction",
      metadata: { order: 2 },
      position: 2,
    }),
    // A third lesson: the multi-parent detach case moves the activity somewhere
    // that is neither its current parent nor the obvious target.
    node(SYNTHETIC_IDS.lessonC, "Lesson", {
      description: "Leçon C",
      normalizedType: "Lesson",
      educationalUse: "Instruction",
      metadata: { order: 3 },
      position: 3,
    }),
    // Two weeks: the SCHEDULE axis. A node can be filed under a chapter by
    // hasPart and scheduled under a week by hasChild at the same time, and a move
    // along one axis must leave the other alone — which needs two weeks to move
    // between.
    node(SYNTHETIC_IDS.weekA, "LessonGrouping", {
      description: "1",
      groupName: "Semaine",
      groupLevel: 1,
      metadata: { role: "week", order: 1 },
      position: 1,
    }),
    node(SYNTHETIC_IDS.weekB, "LessonGrouping", {
      description: "2",
      groupName: "Semaine",
      groupLevel: 1,
      metadata: { role: "week", order: 2 },
      position: 2,
    }),
    node(SYNTHETIC_IDS.activity, "Activity", {
      description: "Tâche synthétique",
      normalizedType: "Activity",
      metadata: { order: 1 },
      position: 1,
    }),
  ];

  const relationships = [
    edge("hasChild", SYNTHETIC_IDS.framework, SYNTHETIC_IDS.standard),
    edge("hasPart", SYNTHETIC_IDS.course, SYNTHETIC_IDS.chapter),
    edge("hasPart", SYNTHETIC_IDS.course, SYNTHETIC_IDS.chapter2, 1),
    edge("hasPart", SYNTHETIC_IDS.course, SYNTHETIC_IDS.weekA, 1),
    edge("hasPart", SYNTHETIC_IDS.course, SYNTHETIC_IDS.weekB, 2),
    edge("hasPart", SYNTHETIC_IDS.chapter, SYNTHETIC_IDS.lessonA, 0),
    edge("hasPart", SYNTHETIC_IDS.chapter, SYNTHETIC_IDS.lessonB, 1),
    edge("hasPart", SYNTHETIC_IDS.chapter, SYNTHETIC_IDS.lessonC, 2),
    // The two axes a move must keep apart: the activity is CONTAINED by lesson A
    // but ALIGNED to the standard. Moving it to lesson B must not drop the
    // alignment.
    edge("hasPart", SYNTHETIC_IDS.lessonA, SYNTHETIC_IDS.activity),
    edge("hasEducationalAlignment", SYNTHETIC_IDS.activity, SYNTHETIC_IDS.standard),
    // Progression: chapter 1 builds towards chapter 2 (parsed into buildsTowards).
    edge("hasDependency", SYNTHETIC_IDS.chapter, SYNTHETIC_IDS.chapter2),
  ];

  return { nodes, relationships } as unknown as RawGraphSnapshot;
}
