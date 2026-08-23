/*
 * Module: kg-store · structural lint (the check_draft rules)
 *
 * Mechanical WIRING checks over a graph — the failures that are silent today.
 * The motivating one is in our own tool description: mint a document but forget
 * its `covers` edge and nothing errors; generation simply reads an empty
 * document, and the expert finds out at the end.
 *
 * THE LINE THIS MUST NOT CROSS (docs/design-notes/self-serve-authoring.md, D4):
 * these rules check wiring, NEVER pedagogy. "This document has no formatter" is
 * wiring — true for every subject, a mechanical failure mode. "This chapter
 * doesn't cover enough of the addition objective" is pedagogy — it lives as
 * prose in the subject guide and is judged by review_draft. If a rule would need
 * to know what the subject TEACHES, it does not belong here. That is why the
 * retired coded coverage rules are not coming back through this door.
 *
 * Findings are reported in French: the reader is a subject expert, not an
 * operator. They are warnings, never blocks — publish is never refused by a lint.
 *
 * It lives in kg-store (not a server tool) because the publish dry-run runs it
 * too, and kg-store may not import upward.
 */

import type { MutationGraph, MutationNode } from "./types.js";

// The document/rendering layer we can check the wiring of. Non-canonical LC (see
// docs/design-notes/teaching-learning-materials.md) but ontology vocabulary all
// the same — no subject speaks here.
const TLM_LABEL = "TeachingLearningMaterial";
const SECTION_LABEL = "DocumentSection";
const FORMATTER_LABEL = "Formatter";
const ROUTINE_LABEL = "InstructionalRoutine";

const CONTAINMENT_EDGES = new Set(["hasPart", "hasChild"]);

export type LintSeverity = "warning" | "info";

export type LintFinding = {
  /** Stable machine id for the rule, so a caller can filter or count by kind. */
  rule: string;
  severity: LintSeverity;
  nodeId: string;
  /** The node's display title, so the expert recognises what is being talked about. */
  title: string;
  /** What is wrong, in plain French. */
  message: string;
  /** What to do about it, in plain French. */
  fix: string;
};

export type LintOptions = {
  /**
   * Restrict findings to these node ids — the publish dry-run passes the nodes
   * the draft actually touched, so an approver is not shown pre-existing issues
   * they did not cause.
   */
  onlyNodes?: Set<string>;
};

const labelsOf = (node: MutationNode): string[] => node.labels ?? [];
const has = (node: MutationNode, label: string): boolean => labelsOf(node).includes(label);

// Best-effort display title (normalized fields first, then the raw LC
// description) — the same precedence the readers use.
function titleOf(node: MutationNode): string {
  const properties = (node.properties ?? {}) as Record<string, unknown>;
  const normalized = properties.title ?? properties.text;
  if (typeof normalized === "string" && normalized.length > 0) return normalized;
  const raw = (properties.raw ?? {}) as Record<string, unknown>;
  const description = raw.description;
  return typeof description === "string" ? description : node.id;
}

// Edge indexes each rule reads, built once per lint run.
type Index = {
  byId: Map<string, MutationNode>;
  /** node → its containment children (hasPart/hasChild targets). */
  childrenOf: Map<string, string[]>;
  /** node → the types of edges pointing AT it. */
  inTypes: Map<string, Set<string>>;
  /** node → the types of edges leaving it. */
  outTypes: Map<string, Set<string>>;
};

function buildIndex(graph: MutationGraph): Index {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const childrenOf = new Map<string, string[]>();
  const inTypes = new Map<string, Set<string>>();
  const outTypes = new Map<string, Set<string>>();

  const add = (map: Map<string, Set<string>>, key: string, value: string): void => {
    const set = map.get(key) ?? new Set<string>();
    set.add(value);
    map.set(key, set);
  };

  for (const edge of graph.edges) {
    add(outTypes, edge.from, edge.type);
    add(inTypes, edge.to, edge.type);
    if (CONTAINMENT_EDGES.has(edge.type)) {
      childrenOf.set(edge.from, [...(childrenOf.get(edge.from) ?? []), edge.to]);
    }
  }
  return { byId, childrenOf, inTypes, outTypes };
}

// Every containment descendant of `rootId`, cycle-guarded (the graph is authored
// data, so a loop is possible and must not hang a lint).
function descendantsOf(rootId: string, index: Index): string[] {
  const seen = new Set<string>([rootId]);
  const queue = [rootId];
  const out: string[] = [];
  while (queue.length > 0) {
    for (const child of index.childrenOf.get(queue.shift()!) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child);
      queue.push(child);
    }
  }
  return out;
}

// ── The rules ────────────────────────────────────────────────────────────────
// Each returns the findings it produces; `lintGraph` concatenates them. Adding a
// rule means adding a function here and to RULES — and passing the D4 test above.

// The headline failure: a document that points at no curriculum. Generation
// resolves the TLM's scope through `covers` (its own, or its sections'), so a
// TLM with neither renders an empty document and says nothing about it.
function documentCoversNothing(graph: MutationGraph, index: Index): LintFinding[] {
  return graph.nodes
    .filter((node) => has(node, TLM_LABEL))
    .filter((tlm) => {
      const ownCovers = index.outTypes.get(tlm.id)?.has("covers") ?? false;
      const sectionCovers = descendantsOf(tlm.id, index).some((id) => index.outTypes.get(id)?.has("covers"));
      return !ownCovers && !sectionCovers;
    })
    .map((tlm) => ({
      rule: "document-sans-contenu",
      severity: "warning" as const,
      nodeId: tlm.id,
      title: titleOf(tlm),
      message: "Ce document n'est rattaché à aucun contenu du programme : la génération produirait un document vide.",
      fix: "Reliez le document au cours ou au chapitre qu'il doit produire (une relation « couvre »), ou donnez-lui des sections qui, elles, couvrent un contenu.",
    }));
}

// A document with no formatter renders with no house style. Mechanical: the
// rendering stack hangs under the TLM by containment, so its absence is a fact,
// not a judgment about the style itself.
function documentHasNoFormatter(graph: MutationGraph, index: Index): LintFinding[] {
  return graph.nodes
    .filter((node) => has(node, TLM_LABEL))
    .filter((tlm) => !descendantsOf(tlm.id, index).some((id) => {
      const node = index.byId.get(id);
      return node ? has(node, FORMATTER_LABEL) : false;
    }))
    .map((tlm) => ({
      rule: "document-sans-mise-en-forme",
      severity: "warning" as const,
      nodeId: tlm.id,
      title: titleOf(tlm),
      message: "Ce document n'a aucune règle de mise en forme : il sera produit sans style maison.",
      fix: "Appliquez un formateur du catalogue au document (use_formatter), ou créez-en un si aucun ne convient.",
    }));
}

// A section covering nothing is legitimate for front matter (a cover page, a
// table of contents), so this is INFO, not a warning — it asks rather than
// accuses.
function sectionCoversNothing(graph: MutationGraph, index: Index): LintFinding[] {
  return graph.nodes
    .filter((node) => has(node, SECTION_LABEL))
    .filter((section) => !(index.outTypes.get(section.id)?.has("covers") ?? false))
    .map((section) => ({
      rule: "section-sans-contenu",
      severity: "info" as const,
      nodeId: section.id,
      title: titleOf(section),
      message: "Cette section ne couvre aucun contenu du programme.",
      fix: "C'est normal pour une page de garde ou un sommaire. Sinon, reliez-la au contenu qu'elle doit présenter.",
    }));
}

// A section that hangs under no document is unreachable from generation, which
// always enters through a TLM.
function sectionOutsideDocument(graph: MutationGraph, index: Index): LintFinding[] {
  const insideDocument = new Set<string>();
  for (const node of graph.nodes) {
    if (has(node, TLM_LABEL)) descendantsOf(node.id, index).forEach((id) => insideDocument.add(id));
  }
  return graph.nodes
    .filter((node) => has(node, SECTION_LABEL) && !insideDocument.has(node.id))
    .map((section) => ({
      rule: "section-hors-document",
      severity: "warning" as const,
      nodeId: section.id,
      title: titleOf(section),
      message: "Cette section n'appartient à aucun document : rien ne l'utilisera.",
      fix: "Rattachez-la au document auquel elle appartient, ou supprimez-la.",
    }));
}

// A routine nothing uses is invisible to generation — the "routine attached to
// no lesson" case.
function routineUnused(graph: MutationGraph, index: Index): LintFinding[] {
  return graph.nodes
    .filter((node) => has(node, ROUTINE_LABEL))
    .filter((routine) => !(index.inTypes.get(routine.id)?.has("usesRoutine") ?? false))
    .map((routine) => ({
      rule: "routine-inutilisee",
      severity: "warning" as const,
      nodeId: routine.id,
      title: titleOf(routine),
      message: "Cette routine pédagogique n'est utilisée par aucune leçon ni aucun cours.",
      fix: "Rattachez-la à la leçon ou au cours qui doit la suivre, ou supprimez-la.",
    }));
}

// A node with no edge at all is reachable by nothing — the clearest mechanical
// break there is, and the usual trace of an interrupted authoring session.
function isolatedNode(graph: MutationGraph, index: Index): LintFinding[] {
  return graph.nodes
    .filter((node) => (index.inTypes.get(node.id)?.size ?? 0) === 0 && (index.outTypes.get(node.id)?.size ?? 0) === 0)
    .map((node) => ({
      rule: "noeud-isole",
      severity: "warning" as const,
      nodeId: node.id,
      title: titleOf(node),
      message: "Cet élément n'est relié à rien : il n'apparaîtra dans aucune lecture du graphe.",
      fix: "Rattachez-le à son parent (chapitre, leçon, document…), ou supprimez-le.",
    }));
}

const RULES = [
  documentCoversNothing,
  documentHasNoFormatter,
  sectionCoversNothing,
  sectionOutsideDocument,
  routineUnused,
  isolatedNode,
];

/**
 * Run every wiring rule over `graph`. Warnings first, then info; stable order
 * within a severity (by rule, then node id) so two runs read the same.
 */
export function lintGraph(graph: MutationGraph, options: LintOptions = {}): LintFinding[] {
  const index = buildIndex(graph);
  const all = RULES.flatMap((rule) => rule(graph, index));

  // "Connected to nothing" is the catch-all, so it fires on top of the specific
  // rules — an unused routine has no edges either. Report the specific finding
  // only: two lines about one node, saying nearly the same thing, is how a lint
  // trains its reader to skim past it.
  const explained = new Set(all.filter((finding) => finding.rule !== "noeud-isole").map((finding) => finding.nodeId));
  const findings = all.filter((finding) => finding.rule !== "noeud-isole" || !explained.has(finding.nodeId));

  const scoped = options.onlyNodes
    ? findings.filter((finding) => options.onlyNodes!.has(finding.nodeId))
    : findings;

  return scoped.sort((a, b) =>
    (a.severity === b.severity ? 0 : a.severity === "warning" ? -1 : 1) ||
    a.rule.localeCompare(b.rule) ||
    a.nodeId.localeCompare(b.nodeId));
}

/** One line per finding, for a caller that wants the lint as plain warnings. */
export const lintWarnings = (findings: LintFinding[]): string[] =>
  findings.map((finding) => `${finding.title} — ${finding.message}`);
