/*
 * The explorer's VIEWS, built from the graph rather than declared for it.
 *
 * The explorer offers a containment hierarchy and a by-label grouping, and both
 * are derived: which levels exist, and which labels are present, are read off
 * the nodes and edges in hand. That is why the explorer carries no subject
 * vocabulary — no domaine, chapitre, semaine, palier — and why a new workspace
 * gets working views without anyone configuring one.
 *
 * `assembleDisplayGraph` is the shared projection every export goes through, so
 * a namespace export, a scoped subtree and a draft read all produce the same
 * shape and the explorer needs one renderer.
 */
import type { DisplayNode, DisplayEdge, DisplayGraph, ViewConfig, ViewSpec, TaxonomyEntry } from "./types.js";
import { LABEL_DEFS } from "./types.js";
import type { StoredNode, StoredEdge } from "../kg-store/index.js";
import { kgNamespace } from "../kg-store/index.js";
import { listAvailableContexts } from "../context/index.js";
import { toDisplayNode, toDisplayEdges, edgeOrder, nsLabel, type FoldContext } from "./display.js";

// ── viewConfig — Learning-Commons ontology views ONLY ────────────────────────
// The four LC lenses (https://docs.learningcommons.org — core concepts), each
// emitted only when the namespace actually holds that layer's data, plus a
// generic catch-all. No subject vocabulary (no domaine/week/strand/palier).
//   1. STANDARDS      — the full containment tree (the former "Hierarchy"):
//      anchored on the framework root and expanded via hasChild, so
//      LearningComponents (supports, folded) and the curriculum content (hasPart /
//      hasEducationalAlignment, folded) all nest in with honest rel badges. The
//      other tabs below are focused lenses over the same graph.
//   2. LEARNING COMPONENTS — flows outward from each LearningComponent: LC →
//      (supports) framework item → framework, reversing the folded hasChild tree.
//   3. CURRICULUM     — the content layer Course → LessonGrouping → Lesson →
//      Activity → Material (hasPart), anchored on the top content nodes.
//   4. LEARNING PROGRESSION — prereq → successor chains over buildsTowards
//      (hasDependency is normalised onto it in toDisplayEdges).
//   5. BY-TYPE        — the generic node-type floor: every node grouped by its LC
//      label, each showing its outgoing relations. Works for any namespace.
const STANDARDS_LABELS = ["StandardsFramework", "StandardsFrameworkItem"];
// InstructionalRoutine + Material carry the shared "fiche de leçon" routine; it folds
// into the content tree under the Course only (see toDisplayEdges' usesRoutine case).
const CONTENT_LABELS = ["Course", "LessonGrouping", "Lesson", "Assessment", "Activity", "Material", "InstructionalRoutine"];
// The document / rendering / evaluation layer, nested by hasPart (folded onto the
// hasChild display axis): TLM ▸ DocumentSection · TLM ▸ Formatter ▸ FormatterSpec ·
// TLM ▸ Rubric ▸ RubricSection ▸ RubricCriterion.
const DOCUMENT_LABELS = [
  "TeachingLearningMaterial", "DocumentSection", "Formatter", "FormatterSpec",
  "Rubric", "RubricSection", "RubricCriterion",
];

function buildViewConfig(nodes: DisplayNode[], edges: DisplayEdge[]): ViewConfig {
  const present = new Set(nodes.map((n) => n.label));
  const has = (l: string) => present.has(l);
  const views: ViewSpec[] = [];

  if (has("StandardsFramework")) {
    views.push({
      id: "standards", label: { fr: "Standards", en: "Standards" }, shape: "grouped-spine",
      params: { anchorKind: "StandardsFramework", groupBy: [], expandEdge: "hasChild" },
    });
  }
  if (has("LearningComponent")) {
    views.push({
      id: "components", label: { fr: "Composants d'apprentissage", en: "Learning components" }, shape: "label-tree",
      // Flows FROM the LearningComponent outward: LC → (supports) → framework item →
      // framework. We reverse the same hasChild tree (which already folds `supports`
      // reversed), so each component heads its own branch up to the framework root.
      // Roots are the LearningComponents only (rootKinds), so a framework item with
      // no supporting component never floats up as an orphan root.
      params: { includeLabels: [...STANDARDS_LABELS, "LearningComponent"], expandEdge: "hasChild", rootKinds: ["LearningComponent"], reverse: true },
    });
  }
  if (CONTENT_LABELS.some(has)) {
    views.push({
      id: "curriculum", label: { fr: "Curriculum", en: "Curriculum" }, shape: "label-tree",
      // Only Course / top LessonGrouping anchor the content tree; Lesson/Activity/
      // Material never head it (illustrative Activities are exemplars under
      // components and must not surface here as orphans).
      // The tail lets the aligning content leaf walk out to the standard it teaches
      // (hasEducationalAlignment) and, under that standard, the learning components
      // that support it (supports) — the alignment the content walk folds away. The
      // leaf differs by subject: maths teacher-guide LESSONS align, while reading
      // authors alignment on the session ACTIVITIES (its Lessons are day containers
      // that teach no single standard), so both are seeded.
      params: {
        includeLabels: CONTENT_LABELS, expandEdge: "hasChild", rootKinds: ["Course", "LessonGrouping"],
        alignmentTail: [
          { from: "Lesson", rel: "hasEducationalAlignment", dir: "in" },
          { from: "Assessment", rel: "hasEducationalAlignment", dir: "in" },
          { from: "Activity", rel: "hasEducationalAlignment", dir: "in" },
          { from: "StandardsFrameworkItem", rel: "supports", dir: "out" },
        ],
      },
    });
  }
  if (edges.some((e) => e.rel === "buildsTowards")) {
    views.push({ id: "progression", label: { fr: "Progression", en: "Learning progression" }, shape: "progression", params: { edge: "buildsTowards" } });
  }
  if (has("TeachingLearningMaterial")) {
    views.push({
      id: "documents", label: { fr: "Documents", en: "Documents" }, shape: "label-tree",
      // Rooted on the TLM (rootKinds), walking its hasPart nesting (folded onto
      // hasChild) down through DocumentSection / Formatter / FormatterSpec. The tail
      // grafts each covered curriculum node — a TLM's Course, a section's Lesson —
      // as a display-only leaf out to the curriculum (dir "out" over the real
      // `covers` edge), the same way the Curriculum view reveals a lesson's standard.
      params: {
        includeLabels: DOCUMENT_LABELS, expandEdge: "hasChild", rootKinds: ["TeachingLearningMaterial"],
        alignmentTail: [
          { from: "TeachingLearningMaterial", rel: "covers", dir: "out" },
          { from: "DocumentSection", rel: "covers", dir: "out" },
        ],
      },
    });
  }
  views.push({ id: "generic", label: { fr: "Par type (LC)", en: "By type (LC)" }, shape: "node-type" });
  return { views };
}

// ── Shared projection: stored graph → display nodes/edges/meta ────────────────
// Extracted so the full-namespace export and the scoped-subtree export project
// the graph through the SAME transforms — the folding, taxonomy, and viewConfig
// stay identical whichever slice a caller asks for.

// Fold every stored edge to its display edge(s), threading the illustrates map
// (activity → component it exemplifies) the fold needs to nest illustrative
// activities under their component instead of beside their siblings.
// `addedEdgeIds` (draft reads) names the stored edges this draft created. Tagging
// happens HERE rather than over the finished display edges because the fold is
// lossy in both directions: one stored edge can yield zero or two display edges,
// and supports/hasEducationalAlignment come back with their endpoints reversed —
// so after the fact there is no reliable way back to the stored edge.
export function projectDisplayEdges(
  nodes: DisplayNode[],
  storedEdges: StoredEdge[],
  addedEdgeIds?: Set<string>,
): DisplayEdge[] {
  const illustrates = new Map<string, { comp: string; order: number }>();
  for (const n of nodes) {
    const ic = n.props?.illustratesComponent as { id?: string; order?: number } | undefined;
    if (ic?.id) illustrates.set(n.id, { comp: ic.id, order: typeof ic.order === "number" ? ic.order : 0 });
  }
  const nodeIds = new Set(nodes.map((n) => n.id));

  return storedEdges.flatMap((e) => {
    const projected = toDisplayEdges(e, { illustrates, has: (id) => nodeIds.has(id) });
    if (!addedEdgeIds?.has(e.id)) return projected;
    return projected.map((edge) => ({ ...edge, chg: "added" as const }));
  });
}

// Wrap a set of already-projected display nodes/edges in the meta envelope the
// explorer consumes: per-label counts, source chips, the present-labels legend
// taxonomy, and the derived viewConfig. `note` describes the slice (full graph
// vs. scoped subtree). Colouring/legend/views all reflect ONLY what is present,
// so a subtree's legend lists only its own labels.
export function assembleDisplayGraph(
  nodes: DisplayNode[],
  edges: DisplayEdge[],
  ns: string,
  slot: string,
  note: string,
): DisplayGraph {
  const byLabel: Record<string, number> = {};
  for (const n of nodes) byLabel[n.label] = (byLabel[n.label] ?? 0) + 1;
  const sources = [...new Set(nodes.map((n) => n.srcKey).filter(Boolean))].sort();
  // Legend taxonomy — only the LC labels actually present, in canonical order,
  // plus any unrecognised label appended (so nothing is ever silently uncoloured).
  const presentLabels = new Set(nodes.map((n) => n.label).filter(Boolean));
  const known = new Set(LABEL_DEFS.map((d) => d.key));
  const taxonomy = [
    ...LABEL_DEFS.filter((d) => presentLabels.has(d.key)),
    ...[...presentLabels].filter((l) => !known.has(l)).sort().map((l) => ({ key: l, label: { fr: l, en: l }, color: "#9aa0a6" })),
  ];

  // Label from the installed context list (so we get the pretty per-subject name).
  const ctx = listAvailableContexts().find((c) => kgNamespace(c.workspace, c.grade, c.subject) === ns);
  const label = ctx ? nsLabel(ctx.grade, ctx.subject) : { fr: ns, en: ns };

  return {
    nodes,
    edges,
    meta: {
      ns,
      label,
      publishedSlot: slot,
      counts: { nodes: nodes.length, edges: edges.length, byKind: byLabel },
      sources,
      taxonomy,
      viewConfig: buildViewConfig(nodes, edges),
      generatedAt: new Date().toISOString(),
      note,
    },
  };
}
