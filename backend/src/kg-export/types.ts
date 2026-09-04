/*
 * The DISPLAY SCHEMA — what the explorer actually consumes.
 *
 * The React explorer (frontend/explorer/) reads these node fields directly and
 * mirrors this shape in its own `src/types.ts`, so this file is one half of a
 * contract that crosses a package boundary: changing a field name here breaks a
 * page nobody runs `tsc` over. Edges are deliberately terse (`{s,t,r}` plus an
 * order hint `o`) because a whole graph goes over the wire.
 *
 * Types and the legend taxonomy only — every transform that produces them lives
 * in display.ts, and every export that ships them in namespace.ts / subtree.ts /
 * libraries.ts.
 */
// ── Display schema (what the explorer consumes) ──────────────────────────────
// The React explorer (frontend/explorer/, schema mirrored in
// frontend/explorer/src/types.ts) consumes these node fields directly;
// edges use {s,t,r} + an order hint `o`.
export type DisplayNode = {
  id: string;
  label: string;                 // Learning-Commons ontology label — the node's identity
  kind: string;                  // = label (the explorer speaks LC labels only)
  cat: string;                   // = label (legend category → drives colour/legend/stats)
  code: string;                  // identifier / statement_code
  ord: number | null;            // metadata.order (stable sort within a parent)
  desc: string; desc_en: string; // display text (bilingual)
  nt: string;                    // LC sub-type hint (normalized_type / normalized_statement_type)
  st: string; st_en: string;     // LC statement_type (category detail), bilingual
  srcKey: string;                // provenance (source_key) → source-filter chips
  props: Record<string, unknown>;// the node's raw LC properties, for the detail panel
  // Draft reads only: how this node differs from published ("added" / "changed").
  // Absent on a published read, and on a draft node that is untouched — so the
  // explorer can colour a curator's own work without a second request.
  chg?: "added" | "changed";
};

// ── Legend taxonomy — by Learning-Commons LABEL ──────────────────────────────
// The explorer follows the LC ontology ONLY: a node's legend category is its LC
// top-level label (no subject roles like chapter/week/strand). `meta.taxonomy`
// lists, in this canonical order, only the labels actually present, each with a
// bilingual name + colour.
export type TaxonomyEntry = { key: string; label: { fr: string; en: string }; color: string };

// One colour per LC label (palette kept in sync with frontend/explorer's theme).
// Canonical LC labels, in containment order (Course → grouping → lesson →
// activity → material), with the standards labels first and LearningComponent last.
export const LABEL_DEFS: TaxonomyEntry[] = [
  { key: "StandardsFramework",     label: { fr: "Cadre de référence", en: "Standards framework" }, color: "#5b8def" },
  { key: "StandardsFrameworkItem", label: { fr: "Élément du cadre",   en: "Framework item" },      color: "#378add" },
  { key: "Course",                 label: { fr: "Cours",              en: "Course" },               color: "#b5651d" },
  { key: "LessonGrouping",         label: { fr: "Regroupement",       en: "Lesson grouping" },      color: "#7f77dd" },
  { key: "Lesson",                 label: { fr: "Leçon",              en: "Lesson" },               color: "#1d9e75" },
  // A bilan is a leaf beside a Lesson, so it takes a darker shade of the Lesson green
  // rather than a hue of its own — related, still tellable apart at a glance.
  { key: "Assessment",             label: { fr: "Bilan",              en: "Assessment" },           color: "#0f7a63" },
  { key: "Activity",               label: { fr: "Activité",           en: "Activity" },             color: "#c98a1a" },
  { key: "Material",               label: { fr: "Matériel",           en: "Material" },             color: "#888780" },
  { key: "LearningComponent",      label: { fr: "Composant",          en: "Learning component" },   color: "#d4537e" },
  // The non-canonical document / rendering layer (teaching-learning-materials.md):
  // a teal family for the document nodes (TLM ▸ DocumentSection), a plum family for
  // the rendering nodes (Formatter ▸ FormatterSpec) — kept clearly apart from the
  // curriculum hues above so a Documents view reads as its own layer.
  { key: "TeachingLearningMaterial", label: { fr: "Document",         en: "Document (TLM)" },        color: "#0e7c86" },
  { key: "DocumentSection",          label: { fr: "Section",          en: "Document section" },      color: "#3ba7a0" },
  { key: "Formatter",                label: { fr: "Formateur",        en: "Formatter" },             color: "#6d597a" },
  { key: "FormatterSpec",            label: { fr: "Règle de format",  en: "Formatter spec" },        color: "#9b8aa8" },
  // The evaluation grids (evaluation-rubrics.md) hang beside the formatters under a
  // TLM: an amber family, so "how the document is judged" reads apart from "how it
  // is rendered" at a glance.
  { key: "Rubric",                   label: { fr: "Grille d'évaluation", en: "Evaluation rubric" },   color: "#b07d19" },
  { key: "RubricSection",            label: { fr: "Section de grille", en: "Rubric section" },        color: "#d3a238" },
  { key: "RubricCriterion",          label: { fr: "Critère",          en: "Rubric criterion" },       color: "#e5c477" },
];

// `r` is the TRAVERSAL type (what the containment tree walks — always "hasChild"
// for folded edges), while `rel` is the REAL LC edge type for the badge, so the UI
// can tell a genuine hasChild from a folded supports/hasEducationalAlignment/hasPart
// (or a metadata-derived "illustrates"). Keeping them separate is what makes the
// tree walkable AND the badges honest.
export type DisplayEdge = {
  s: string;
  t: string;
  r: string;
  rel: string;
  o: number;
  /**
   * Draft reads only: this draft created the link. Set even when both endpoints
   * are untouched nodes — `use_routine` attaching a routine to a lesson writes
   * ONLY an edge, so without this the change has nothing to render on and the
   * counts read 0/0/0 while the tree silently grows a branch.
   */
  chg?: "added";
};

export type GroupByLevel = { key: keyof DisplayNode | string; labelFr?: string; labelEn?: string };
export type ViewSpec =
  | {
      id: string; label: { fr: string; en: string }; shape: "grouped-spine";
      params: { anchorKind: string; groupBy: GroupByLevel[]; expandEdge: string; stopKind?: string | null; order?: string[] };
    }
  // A containment tree filtered to a set of LC labels: roots are included nodes
  // with no included parent, children are `expandEdge` targets whose label is in
  // `includeLabels`. `rootKinds` (optional) restricts which labels may be a root —
  // needed for Curriculum, where illustrative Activities are re-parented under
  // components (excluded here) and would otherwise float up as orphan roots.
  // `pruneToLabel` hides any branch with no descendant of that label (so the
  // Learning-components view shows only decomposed standards).
  // `reverse` walks `expandEdge` bottom-up (target→source), so the tree flows from
  // the leaf outward — the Learning-components view reads LearningComponent →
  // (supports) → framework item → framework, not the framework down.
  // `alignmentTail` grafts extra branches onto content leaves that the plain
  // containment walk folds away: an ordered chain of steps, each expanding a node
  // of LC label `from` along a REAL edge type `rel` (`dir:"in"` follows it toward
  // the node, `"out"` away from it). Curriculum uses it to let a Lesson walk out to
  // the standard it aligns with, then to that standard's supporting components.
  | {
      id: string; label: { fr: string; en: string }; shape: "label-tree";
      params: {
        includeLabels: string[]; expandEdge: string; rootKinds?: string[]; pruneToLabel?: string; reverse?: boolean;
        alignmentTail?: Array<{ from: string; rel: string; dir: "in" | "out" }>;
      };
    }
  // Learning progression: prereq → successor chains over one edge type. Roots are
  // nodes with an outgoing `edge` and no incoming one (chain starts).
  | { id: string; label: { fr: string; en: string }; shape: "progression"; params: { edge: string } }
  | { id: string; label: { fr: string; en: string }; shape: "node-type"; params?: Record<string, never> };

export type ViewConfig = { views: ViewSpec[] };

export type DisplayGraph = {
  nodes: DisplayNode[];
  edges: DisplayEdge[];
  meta: {
    ns: string;
    label: { fr: string; en: string };
    publishedSlot: string;
    /** Which slot this payload was read from — the explorer's slot switch. */
    reading?: "published" | "draft";
    /** Draft state, so the switch can be offered (or explained) without a second call. */
    draft?: {
      open: boolean;
      note?: string;
      removed?: Array<{ id: string; label: string; desc: string }>;
      /**
       * Links this draft DELETED. Like removed nodes, a deleted edge is absent
       * from the draft graph, so it cannot carry a tag and needs its own list —
       * otherwise detaching a routine from a lesson looks like nothing happened.
       */
      unlinked?: Array<{ rel: string; from: string; to: string }>;
      counts?: { added: number; changed: number; removed: number; linked: number; unlinked: number };
    };
    counts: { nodes: number; edges: number; byKind: Record<string, number> };
    sources: string[];           // distinct srcKeys present → source-filter chips
    taxonomy: TaxonomyEntry[];   // graph-agnostic legend categories present, in canonical order
    viewConfig: ViewConfig;
    generatedAt: string;
    note: string;                // human note: published-only, spine-scope
  };
};
