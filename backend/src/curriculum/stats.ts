/*
 * Module: curriculum · namespace statistics
 *
 * The model-derived half of the namespace_stats tool: node counts by LC label,
 * edge counts by type, the structural roots, and a few cheap orientation flags —
 * all read straight off the echoed raw graph (`model.rawGraph`), no traversal.
 * The tool layer adds the namespace string and the live draft state (which need
 * the store), because those are not on the read model.
 *
 * Purpose: one call that answers "what am I looking at?" before writing any
 * query — e.g. "112 StandardsFrameworkItems, 1 framework, 0 groupings, 112
 * alignment edges" — replacing a whole discovery phase.
 */
import type { CurriculumModel, RawGraphSnapshot } from "../types.js";

type RawNode = RawGraphSnapshot["nodes"][number];

// A structural root: a node no containment edge points at AND that does not
// attach itself to a standard (a Course, a StandardsFramework, or a genuinely
// stranded grouping). `description` is a best-effort display string so a human
// can tell the roots apart at a glance.
export type StatsRoot = { id: string; labels: string[]; description: string };

// Nodes that hang off a standard by their OWN outbound edge instead of being
// contained. Reported apart from `roots` because they are attached, not
// stranded — counting them as roots reads as "100 orphans to clean up".
export type AlignmentAttached = { count: number; byLabel: Record<string, number> };

export type GraphStats = {
  nodeCounts: Record<string, number>;   // keyed by the node's primary LC label
  edgeCounts: Record<string, number>;   // keyed by edge type
  roots: StatsRoot[];                   // capped to MAX_ROOTS, interesting kinds first
  rootsTotal: number;                   // full count before the cap (roots.length may be smaller)
  attachedByAlignment: AlignmentAttached; // NOT roots: attached to a standard, not contained
  isolatedCount: number;                // no edge of any type touches these — the real orphans
  structuralFlags: string[];            // cheap "looks off" hints (e.g. no Course authored)
};

// Containment edges — the ones that give a node a structural parent, via an
// INBOUND hasPart/hasChild.
const CONTAINMENT_EDGES = new Set(["hasPart", "hasChild"]);

// The other way a node gets a home: it attaches ITSELF outward, so nothing ever
// contains it. Two real cases, both of which used to be counted as roots and read
// as junk:
//   • ci/maths illustrative Activities — hasEducationalAlignment to their
//     component's SFI; buildSlice reaches them by reverse lookup from the
//     standard, never by walking down from a Course.
//   • standards-only graphs (Nigeria) — LearningComponents that `supports` an SFI.
// On ci/maths this is ~100 of the 110 "roots".
const OUTBOUND_ATTACHMENT_EDGES = new Set(["hasEducationalAlignment", "supports"]);

// A routine root is attached by an INBOUND usesRoutine (Lesson → Routine), the
// same way a contained node is attached by an inbound hasPart. `covers` is
// deliberately NOT here: a TeachingLearningMaterial points at the Course it
// covers, and both of them ARE roots.
const INBOUND_ATTACHMENT_EDGES = new Set(["usesRoutine"]);

// namespace_stats is an orientation call that must ALWAYS return small. The bulk
// of what used to overflow it — alignment-attached nodes — is now excluded from
// `roots` outright, but the cap stays as a backstop for a graph with genuinely
// many roots: interesting kinds first (content Course, framework root, then
// groupings), true total reported separately. The dropped tail is never a Course.
const MAX_ROOTS = 50;
// A TeachingLearningMaterial is a document root (it points AT a Course via
// `covers`, so nothing contains it) — rank it up with the other content roots so
// documents surface in the capped orientation list, not buried among leaf tails.
const ROOT_LABEL_RANK: Record<string, number> = { Course: 0, TeachingLearningMaterial: 1, StandardsFramework: 2, LessonGrouping: 3 };
const rootRank = (root: StatsRoot): number => {
  const best = Math.min(...root.labels.map((label) => ROOT_LABEL_RANK[label] ?? 99), 99);
  return best;
};

// A node's primary LC label (Course / Lesson / StandardsFrameworkItem / …). LC
// nodes carry their main label first; count by it so a node isn't tallied under
// each of its several labels.
const primaryLabel = (node: RawNode): string => node.labels?.[0] ?? "(unlabeled)";

// Best-effort human title for a root, trying the normalized fields first, then
// the raw LC description. Empty string when the node carries no text at all.
function displayText(node: RawNode): string {
  const properties = (node.properties ?? {}) as Record<string, unknown>;
  const normalizedTitle = properties.title ?? properties.text;
  if (typeof normalizedTitle === "string" && normalizedTitle.length > 0) {
    return normalizedTitle;
  }
  const raw = (properties.raw ?? {}) as Record<string, unknown>;
  return typeof raw.description === "string" ? raw.description : "";
}

function countBy<T>(items: T[], keyOf: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyOf(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function computeGraphStats(model: CurriculumModel): GraphStats {
  const raw = model.rawGraph;
  if (!raw) {
    return { nodeCounts: {}, edgeCounts: {}, roots: [], rootsTotal: 0, attachedByAlignment: { count: 0, byLabel: {} }, isolatedCount: 0, structuralFlags: ["graph not available as a raw envelope"] };
  }

  const nodeCounts = countBy(raw.nodes, primaryLabel);
  const edgeCounts = countBy(raw.relationships, (edge) => edge.type);

  // A node is placed either by being CONTAINED (inbound hasPart/hasChild) or by
  // ALIGNING itself to a standard (outbound hasEducationalAlignment/supports).
  // Only a node with neither is genuinely stranded.
  const hasStructuralParent = new Set<string>();
  const attachesItself = new Set<string>();
  const touched = new Set<string>();
  for (const edge of raw.relationships) {
    touched.add(edge.start);
    touched.add(edge.end);
    if (CONTAINMENT_EDGES.has(edge.type)) {
      hasStructuralParent.add(edge.end);
    }
    if (OUTBOUND_ATTACHMENT_EDGES.has(edge.type)) {
      attachesItself.add(edge.start);
    }
    if (INBOUND_ATTACHMENT_EDGES.has(edge.type)) {
      attachesItself.add(edge.end);
    }
  }

  const unContained = raw.nodes.filter((node) => !hasStructuralParent.has(node.id));
  const attached = unContained.filter((node) => attachesItself.has(node.id));

  const allRoots: StatsRoot[] = unContained
    .filter((node) => !attachesItself.has(node.id))
    .map((node) => ({ id: node.id, labels: node.labels ?? [], description: displayText(node) }));

  const attachedByAlignment: AlignmentAttached = {
    count: attached.length,
    byLabel: countBy(attached, primaryLabel),
  };

  // Nodes NO edge touches at all. Unlike a "root", this is unambiguous: nothing
  // reaches them by any path, in any direction. This is the number worth acting on.
  const isolated = raw.nodes.filter((node) => !touched.has(node.id));

  // Interesting kinds first (stable within a rank), then cap. Flags are computed
  // from the FULL root set so "no Course" etc. stay accurate after the cap.
  const roots = [...allRoots].sort((a, b) => rootRank(a) - rootRank(b)).slice(0, MAX_ROOTS);

  return {
    nodeCounts, edgeCounts, roots, rootsTotal: allRoots.length, attachedByAlignment,
    isolatedCount: isolated.length,
    structuralFlags: structuralFlags(raw, nodeCounts, allRoots),
  };
}

// A handful of cheap, honest "this might be incomplete" hints — orientation
// only, not the adapter's authoritative coverageWarnings. Computed from the
// aggregates already in hand, so it stays a no-traversal call.
function structuralFlags(raw: RawGraphSnapshot, nodeCounts: Record<string, number>, roots: StatsRoot[]): string[] {
  const flags: string[] = [];

  if (!nodeCounts["Course"]) {
    flags.push("no Course (content root) authored");
  }

  // A framework with nothing hanging off it (no hasChild spine) is the classic
  // "seeded the root but not the standards" state worth surfacing up front.
  const frameworkIds = raw.nodes.filter((node) => (node.labels ?? []).includes("StandardsFramework")).map((node) => node.id);
  const hasChildFromFramework = new Set(
    raw.relationships.filter((edge) => edge.type === "hasChild").map((edge) => edge.start),
  );
  for (const frameworkId of frameworkIds) {
    if (!hasChildFromFramework.has(frameworkId)) {
      flags.push(`StandardsFramework '${frameworkId}' has no hasChild children`);
    }
  }

  if (roots.length === 0 && raw.nodes.length > 0) {
    flags.push("no structural roots — every node has a containment parent (unexpected for a seeded graph)");
  }

  return flags;
}
