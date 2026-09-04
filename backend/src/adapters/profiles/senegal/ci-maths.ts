/*
 * Subject profile: CI maths (data, not behavior).
 *
 * The converged `{ nodes, relationships }` LC envelope. Two axes read through
 * edges — schedule (grouping→OS) and content (grouping→lesson→OS). A `lesson` is
 * a content Lesson aligned to its spine `expectation` (the objectif spécifique).
 * The coded coverage rules were retired in phase 2c, so expectations live in the
 * guide's prose. See docs/design-notes/graph-native-authoring.md.
 *
 * The graph was rebuilt as "V2" in 2026-09: groupings are `Unité` (was
 * `Semaine`), authored content hangs off a DocumentSection spine, and the
 * bilans, the `metadata.illustratesComponent` links and the `relatesTo` edges
 * are gone. The parser still SUPPORTS all of those — a subject may still carry
 * an Assessment node or a Chapitre grouping — but nothing in this graph
 * exercises them, so the suites that cover them run on src/__tests__/synthetic.ts.
 */
import type { SubjectProfile } from "../../profile.js";

export const CI_MATHS_PROFILE: SubjectProfile = {
  id: "ci-maths/nodes-relationships-v1",

  // Kinds come straight from the graph's canonical fields: a grouping is a
  // LessonGrouping named by its `groupName` (`Unité` today, `Semaine` before the
  // V2 rebuild, `Chapitre` before that); a lesson is a `Lesson`, a standard a
  // `Standard` (its normalizedStatementType). No role table.
  parse: {
    // Content ordinals live in the canonical LC `position`.
    //
    // This read `metadata.order` until 2026-09, on the reasoning that "the maths
    // standards spine carries its ordinal in metadata.order" — which was doubly
    // wrong: parseGraph ignores any ordinal on a StandardsFrameworkItem outright
    // (standards sequence by traversal), so this knob only ever governed CONTENT.
    // After the V2 rebuild not one of the 60 Lessons or 519 Activities carried
    // metadata.order and every one carried `position`, so every content node was
    // parsing with a null ordinal and lessons within a grouping had no sequence
    // at all. The stale test fixture hid it: its lessons carried both fields.
    numberFrom: "position",
    // Chapter progression is the canonical content prerequisite (read reversed
    // into buildsTowards/buildsFrom).
    dependencyEdge: "hasDependency",
  },
};

// The authored GRAPH GUIDE for this subject ships as DATA, not a literal here:
// seeds/senegal/ci/maths/GRAPH_GUIDE.md, read at seed time by
// getRegisteredGuide (adapters/index.ts). See docs/design-notes/authorable-catalog.md.
