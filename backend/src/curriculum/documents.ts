/*
 * Module: curriculum · generic document (TLM) reader
 *
 * The generation-side counterpart to courses.ts, rooted at a
 * TeachingLearningMaterial (TLM) instead of a Course. Where courseSubgraph reads
 * "the curriculum to teach", documentSubgraph reads "the document to produce":
 * given one TLM node it returns the three things generation composes over a
 * document (see docs/design-notes/teaching-learning-materials.md · "What changes
 * for generation"):
 *
 *   1. the TLM's own descriptive fields + `metadata.assemblyGuide` (this
 *      document's authored "how to build me" logic);
 *   2. the document's rendering stack — the Formatter/FormatterSpec subtree hung
 *      under the TLM (doc-wide) and under each DocumentSection (per-section),
 *      reached by `hasPart`;
 *   3. the CURRICULUM to render, resolved by the section-spine-or-Course rule: a
 *      DocumentSection spine when the TLM has one (walk the ordered sections, each
 *      `covers` its curriculum node(s)), otherwise the Course the TLM `covers`.
 *      Sections NEST — a « Partie » holding « Chapitre 1..5 », each holding its own
 *      lesson sheets — so the spine comes back in reading order (depth-first,
 *      siblings by position) with each entry naming the `parent` it sits in.
 *
 * Like the Course readers it does NO projection — it surfaces raw Learning-Commons
 * nodes + edges and lets the caller (the LLM) assemble the material. It also does
 * NOT follow `usesRoutine`: a formatter is a property of the DOCUMENT, reached
 * through the TLM, so the curriculum walk here stays pure containment and never
 * pulls formatting in through the curriculum (the "formatters leave the Course
 * walk" separation, expressed additively — courseSubgraph is left untouched).
 */
import type { CurriculumModel, RawGraphSnapshot } from "../types.js";
import { nodeOut, edgeOut, type NodeOut, type EdgeOut } from "./read-projection.js";
import { responseBytes } from "../utils/index.js";

type RawNode = RawGraphSnapshot["nodes"][number];
type RawEdge = RawGraphSnapshot["relationships"][number];

const TLM_LABEL = "TeachingLearningMaterial";
const SECTION_LABEL = "DocumentSection";
// The document's own spine + rendering stack hang off the TLM by `hasPart`
// (DocumentSection · Formatter · FormatterSpec). This is the ONLY edge the
// document-side walk follows.
const DOCUMENT_EDGE = "hasPart";
// The curriculum-to-render walk is pure containment — hasPart (content) + hasChild
// (standards). Deliberately NOT usesRoutine: formatting reaches generation via the
// TLM, never through the curriculum subtree.
const CURRICULUM_EDGES = new Set(["hasPart", "hasChild"]);


// walk_document inlines the WHOLE curriculum a document renders. For a
// whole-Course document (a pupil manual whose section spine covers the full
// Course) that subtree is essentially the entire graph and would blow the 100 KB
// response cap — so, exactly as exportSubtree bounds a visualization slice, bound
// it here: measure the assembled scope and, when the curriculum pushes it over
// budget, drop the curriculum nodes/edges for a {tooLarge, …} marker that steers
// the caller to the per-section path. The small, always-useful parts (assembly
// guide, scope, the sections spine, the document subtree) still come back with the
// section ids the caller needs. Budget sits under the response cap with headroom
// for the document subtree + envelope; tunable via TLM_DOCUMENT_MAX_BYTES.
const DEFAULT_DOCUMENT_MAX_BYTES = 80 * 1024;
const documentMaxBytes = (): number => {
  const override = Number(process.env.TLM_DOCUMENT_MAX_BYTES);
  return Number.isFinite(override) && override > 0 ? override : DEFAULT_DOCUMENT_MAX_BYTES;
};
const byteLength = (value: unknown): number => responseBytes(value);

const labelsOf = (n: RawNode): string[] => n.labels ?? [];
const props = (n: RawNode): Record<string, any> => (n.properties ?? {}) as Record<string, any>;

// A section's ordinal, read the same way the parser reads a content leaf's: the
// canonical LC `position`, falling back to the maths-style `metadata.order`, then 0
// so an unordered section still sorts stably (by author/insertion order).
function positionOf(n: RawNode): number {
  const p = props(n);
  if (typeof p.position === "number") return p.position;
  if (typeof p.metadata?.order === "number") return p.metadata.order;
  return 0;
}

// This document's authored assembly logic, from the `metadata.assemblyGuide`
// sidecar (markdown). null when the TLM carries none.
function assemblyGuideOf(n: RawNode): string | null {
  const guide = props(n).metadata?.assemblyGuide;
  return typeof guide === "string" && guide !== "" ? guide : null;
}

// BFS out from `roots` (inclusive) over the given edge types — the shared
// containment walk both the document subtree and the curriculum subtree use.
function descendants(raw: RawGraphSnapshot, roots: string[], edgeTypes: Set<string>): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const e of raw.relationships) {
    if (!edgeTypes.has(e.type)) continue;
    (childrenOf.get(e.start) ?? childrenOf.set(e.start, []).get(e.start)!).push(e.end);
  }
  const inSet = new Set<string>(roots);
  const stack = [...roots];
  while (stack.length) {
    for (const c of childrenOf.get(stack.pop()!) ?? []) if (!inSet.has(c)) { inSet.add(c); stack.push(c); }
  }
  return inSet;
}

// One DocumentSection in the document's spine: its id, its ordinal, the node it
// hangs under (the TLM, or the section it is nested in), and the curriculum
// node(s) it renders (`covers` targets). An EMPTY `covers` marks a front-matter
// section (cover, table of contents, intro) — or a section that exists only to
// group the sections beneath it.
export type DocumentSectionOut = { id: string; position: number; parent: string; covers: string[] };

// The document's section spine in READING order: depth-first through the hasPart
// tree, siblings ordered by position. Sections nest (a « Partie » holding
// « Chapitre 1..5 », each holding its lesson sheets), and a nested section's
// position only means something among its own siblings — sorting every section of
// the document into one flat list by position would interleave a part with its
// own children. Cycle-guarded: this is authored data.
function sectionSpine(
  raw: RawGraphSnapshot,
  rootId: string,
  coversTargets: (fromId: string) => string[],
): DocumentSectionOut[] {
  const byId = new Map(raw.nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, string[]>();
  for (const e of raw.relationships) {
    if (e.type !== DOCUMENT_EDGE) continue;
    (childrenOf.get(e.start) ?? childrenOf.set(e.start, []).get(e.start)!).push(e.end);
  }

  const spine: DocumentSectionOut[] = [];
  const seen = new Set<string>([rootId]);

  const walk = (parentId: string): void => {
    const children = (childrenOf.get(parentId) ?? [])
      .map((id) => byId.get(id))
      .filter((n): n is RawNode => n !== undefined && labelsOf(n).includes(SECTION_LABEL))
      .sort((a, b) => positionOf(a) - positionOf(b));
    for (const section of children) {
      if (seen.has(section.id)) continue;
      seen.add(section.id);
      spine.push({ id: section.id, position: positionOf(section), parent: parentId, covers: coversTargets(section.id) });
      walk(section.id);
    }
  };
  walk(rootId);
  return spine;
}

// The resolved curriculum inlined when it fits, or a self-bounding marker (its
// node/edge counts + how to fetch it in bounded pieces) when it would blow the
// response cap. Mirrors exportSubtree's `tooLarge` shape.
export type CurriculumTooLarge = {
  tooLarge: true;
  counts: { nodes: number; edges: number };
  approxBytes: number;
  softCapBytes: number;
  message: string;
};

// The full document scope generation composes over. `scope` records HOW the
// curriculum was resolved: "sections" (a DocumentSection spine), "course" (the
// simple TLM→covers→Course fallback), or "none" (the TLM covers nothing yet).
export type DocumentScope = {
  tlm: string;
  assemblyGuide: string | null;
  scope: "sections" | "course" | "none";
  sections: DocumentSectionOut[];              // ordered by position; [] when there is no spine
  document: { nodes: NodeOut[]; edges: EdgeOut[] };   // the TLM subtree: TLM + hasPart(sections/formatters/specs) + covers edges
  curriculum: { nodes: NodeOut[]; edges: EdgeOut[] } | CurriculumTooLarge;  // the resolved curriculum, inlined or self-bounded
};

// How to fetch the curriculum in bounded pieces once it is too big to inline. A
// document with a section spine has a per-section entry (walk_document_section);
// the spine-less Course fallback has none, so it points at walk_graph paging.
function curriculumTooLargeMessage(
  scope: DocumentScope["scope"],
  sections: DocumentSectionOut[],
  bytes: number,
  budget: number,
): string {
  const size = `~${Math.round(bytes / 1024)} KB, over the ~${Math.round(budget / 1024)} KB budget for one document payload`;
  const route = scope === "sections"
    ? `Generate section by section: call walk_document_section on each of the ${sections.length} ids in \`sections\` — each returns just that slot's curriculum, routine and formatters.`
    : `This document covers a Course directly (no DocumentSection spine), so there is no per-section entry. Page the curriculum with walk_graph from the covered Course root, or give the document a DocumentSection spine so it can be generated section by section.`;
  return `The curriculum this document renders is ${size}. ${route}`;
}

// The document rooted at one TLM. Returns null if `tlmId` is not a
// TeachingLearningMaterial node in this graph.
export function documentSubgraph(model: CurriculumModel, tlmId: string): DocumentScope | null {
  const raw = model.rawGraph;
  if (!raw) return null;
  const tlm = raw.nodes.find((n) => n.id === tlmId);
  if (!tlm || !labelsOf(tlm).includes(TLM_LABEL)) return null;

  // 1. The document's own subtree: the TLM plus everything hung under it by
  //    hasPart (DocumentSections, Formatters, FormatterSpecs). `covers` is kept on
  //    its own axis — the document→curriculum bridge, never containment.
  const docIds = descendants(raw, [tlmId], new Set([DOCUMENT_EDGE]));
  const coversEdges = raw.relationships.filter((e) => e.type === "covers" && docIds.has(e.start));
  const documentEdges = raw.relationships
    .filter((e) => e.type === DOCUMENT_EDGE && docIds.has(e.start) && docIds.has(e.end))
    .concat(coversEdges);
  const document = {
    nodes: raw.nodes.filter((n) => docIds.has(n.id)).map(nodeOut),
    edges: documentEdges.map(edgeOut),
  };

  const coversTargets = (fromId: string): string[] =>
    coversEdges.filter((e) => e.start === fromId).map((e) => e.end);

  // 2. The DocumentSection spine in reading order, each with its covers targets —
  //    nested sections included, each naming the `parent` it sits in.
  const sections = sectionSpine(raw, tlmId, coversTargets);

  // 3. Resolve the curriculum to render: the section spine when present (the union
  //    of the sections' covers targets, front-matter sections contributing none),
  //    otherwise the Course the TLM itself covers.
  let scope: DocumentScope["scope"];
  let curriculumRoots: string[];
  if (sections.length > 0) {
    scope = "sections";
    curriculumRoots = sections.flatMap((s) => s.covers);
  } else {
    curriculumRoots = coversTargets(tlmId);
    scope = curriculumRoots.length > 0 ? "course" : "none";
  }

  const curriculumIds = descendants(raw, curriculumRoots, CURRICULUM_EDGES);
  const curriculum = {
    nodes: raw.nodes.filter((n) => curriculumIds.has(n.id)).map(nodeOut),
    edges: raw.relationships.filter((e) => curriculumIds.has(e.start) && curriculumIds.has(e.end)).map(edgeOut),
  };

  // Self-bound: when inlining the curriculum pushes the scope over budget, return
  // its counts + a route to the bounded fetch instead of the nodes/edges, so the
  // caller gets an actionable response (and the section ids) rather than the hard
  // RESPONSE_TOO_LARGE cap. The small parts (guide, spine, document) always ride.
  const base = { tlm: tlmId, assemblyGuide: assemblyGuideOf(tlm), scope, sections, document };
  const budget = documentMaxBytes();
  if (byteLength({ ...base, curriculum }) > budget) {
    const approxBytes = byteLength(curriculum);
    return {
      ...base,
      curriculum: {
        tooLarge: true,
        counts: { nodes: curriculum.nodes.length, edges: curriculum.edges.length },
        approxBytes,
        softCapBytes: budget,
        message: curriculumTooLargeMessage(scope, sections, approxBytes, budget),
      },
    };
  }
  return { ...base, curriculum };
}

// ── walk_document_section ──────────────────────────────────────────────────────
// The per-section generation reader (docs/design-notes/walk-document-section.md) —
// the per-piece entry generation produces a document from, one slot at a time.
// Where documentSubgraph reads a WHOLE document, this is anchored on the
// DocumentSection — the one node that already IS the document↔curriculum binding: it
// hangs under exactly one TLM (hasPart) and `covers` the curriculum it renders, so
// nothing has to be reverse-searched. It answers "what goes in this slot of this
// document?" and is the unit generation produces a `.docx` section by section from.

const FORMATTER_LABELS = new Set(["Formatter", "FormatterSpec"]);
const ROUTINE_EDGE = "usesRoutine";
// A routine subtree hangs off its entry node by hasPart, like every other content
// subtree: the entry plus its ordered steps, each step carrying its own script in
// `description` (no Material children — see migrate-routine-materials-inline.mjs).
const ROUTINE_EDGE_CONTENT = "hasPart";

// The induced subgraph over `ids`: those nodes plus every edge of the given types
// whose endpoints are both inside the set.
function inducedSubgraph(raw: RawGraphSnapshot, ids: Set<string>, edgeTypes: Set<string>): { nodes: NodeOut[]; edges: EdgeOut[] } {
  return {
    nodes: raw.nodes.filter((n) => ids.has(n.id)).map(nodeOut),
    edges: raw.relationships.filter((e) => edgeTypes.has(e.type) && ids.has(e.start) && ids.has(e.end)).map(edgeOut),
  };
}

// Every containment ancestor of `roots`, nearest-first (level-order up hasPart +
// hasChild). Used to resolve the routine that a covered curriculum node inherits —
// a covered lesson reaches its Course-level routine by climbing this chain. Walks
// inbound edges (parent = edge.start, child = edge.end).
function ancestorsNearestFirst(raw: RawGraphSnapshot, roots: string[]): string[] {
  const parentsOf = new Map<string, string[]>();
  for (const e of raw.relationships) {
    if (!CURRICULUM_EDGES.has(e.type)) continue;
    (parentsOf.get(e.end) ?? parentsOf.set(e.end, []).get(e.end)!).push(e.start);
  }

  const ordered: string[] = [];
  const seen = new Set<string>(roots);
  let frontier = [...roots];
  while (frontier.length) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const parent of parentsOf.get(node) ?? []) {
        if (!seen.has(parent)) { seen.add(parent); ordered.push(parent); next.push(parent); }
      }
    }
    frontier = next;
  }
  return ordered;
}

// What sits ABOVE a section on the document axis, nearest first: the sections it is
// nested inside (a « Chapitre » inside a « Partie »), then the document itself.
// Climbing the whole chain — rather than jumping straight to the TLM — is what lets
// a nested section inherit its parent section's routine and formatters before the
// document's. `tlm` is null when the section hangs under no document yet.
type DocumentAncestry = { sections: string[]; tlm: RawNode | null };

function documentAncestry(raw: RawGraphSnapshot, sectionId: string): DocumentAncestry {
  const byId = new Map(raw.nodes.map((n) => [n.id, n]));
  const parentsOf = new Map<string, string[]>();
  for (const e of raw.relationships) {
    if (e.type !== DOCUMENT_EDGE) continue;
    (parentsOf.get(e.end) ?? parentsOf.set(e.end, []).get(e.end)!).push(e.start);
  }

  const sections: string[] = [];
  let tlm: RawNode | null = null;
  // Level order (shift, not pop) so the nearest ancestor is reported first.
  const queue = [...(parentsOf.get(sectionId) ?? [])];
  const seen = new Set<string>(queue);
  while (queue.length) {
    const parent = byId.get(queue.shift()!);
    if (!parent) continue;
    if (labelsOf(parent).includes(TLM_LABEL)) { tlm ??= parent; continue; }   // top of the chain
    if (labelsOf(parent).includes(SECTION_LABEL)) sections.push(parent.id);
    for (const grandparent of parentsOf.get(parent.id) ?? []) {
      if (!seen.has(grandparent)) { seen.add(grandparent); queue.push(grandparent); }
    }
  }
  return { sections, tlm };
}

// The Formatter/FormatterSpec ids belonging to ONE node's own stack: those reachable
// from `rootId` by hasPart WITHOUT descending into any DocumentSection. Sections are
// WALLS — a section's stack belongs to that section, not to the document above it
// nor to a sibling — so this is what "the TLM's doc-wide stack" and "this section's
// own stack" both mean, and applying it up the ancestry chain gives a nested section
// exactly the stacks on its own path.
function ownFormatterIds(raw: RawGraphSnapshot, rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const e of raw.relationships) {
    if (e.type !== DOCUMENT_EDGE) continue;
    (childrenOf.get(e.start) ?? childrenOf.set(e.start, []).get(e.start)!).push(e.end);
  }

  const found = new Set<string>();
  const stack = [...(childrenOf.get(rootId) ?? [])];
  const seen = new Set<string>(stack);
  while (stack.length) {
    const nodeId = stack.pop()!;
    const node = raw.nodes.find((n) => n.id === nodeId);
    if (!node) continue;
    if (labelsOf(node).includes(SECTION_LABEL)) continue;   // wall: a sibling section's own subtree
    if (labelsOf(node).some((l) => FORMATTER_LABELS.has(l))) found.add(node.id);
    for (const child of childrenOf.get(node.id) ?? []) {
      if (!seen.has(child)) { seen.add(child); stack.push(child); }
    }
  }
  return found;
}

// The routine that applies to a section, resolved NEAREST-WINS along a
// document-first chain: the section's own usesRoutine, else the sections it is
// nested in (nearest first), else the owning TLM's, else (compat with a spine-less
// Course) the nearest routine up the covered curriculum's ancestry.
// `resolvedFromScope` records which tier won — a parent section is still the
// "section" tier, and `resolvedFrom` names which node actually carried the edge.
// null when nothing in the chain uses a routine.
export type SectionRoutine = {
  entryId: string;                                     // the InstructionalRoutine the edge points at
  resolvedFrom: string;                                // the node that carried the usesRoutine edge
  resolvedFromScope: "section" | "document" | "curriculum";
  nodes: NodeOut[];                                    // the routine subtree (entry + its hasPart steps, text inline)
  edges: EdgeOut[];
};

function resolveSectionRoutine(
  raw: RawGraphSnapshot,
  sectionId: string,
  ancestry: DocumentAncestry,
  coversTargets: string[],
): SectionRoutine | null {
  const routineTargetOf = (nodeId: string): string | null =>
    raw.relationships.find((e) => e.type === ROUTINE_EDGE && e.start === nodeId)?.end ?? null;

  // The nearest-wins chain, document-first: the section, the sections it is nested
  // in, then its TLM, then the covered curriculum's ancestry (a covered lesson
  // climbs to its Course-level routine).
  const chain: Array<{ id: string; scope: SectionRoutine["resolvedFromScope"] }> = [
    ...[sectionId, ...ancestry.sections].map((id) => ({ id, scope: "section" as const })),
    ...(ancestry.tlm ? [{ id: ancestry.tlm.id, scope: "document" as const }] : []),
    ...ancestorsNearestFirst(raw, coversTargets).map((id) => ({ id, scope: "curriculum" as const })),
  ];

  for (const link of chain) {
    const entryId = routineTargetOf(link.id);
    if (entryId === null) continue;
    const routineIds = descendants(raw, [entryId], new Set([ROUTINE_EDGE_CONTENT]));
    const subtree = inducedSubgraph(raw, routineIds, new Set([ROUTINE_EDGE_CONTENT]));
    return { entryId, resolvedFrom: link.id, resolvedFromScope: link.scope, nodes: subtree.nodes, edges: subtree.edges };
  }
  return null;
}

// Everything a per-section generation composes: the section node, the owning
// document, the curriculum this slot renders, the applicable routine, and the
// formatters (doc-wide + this section's own).
export type DocumentSectionScope = {
  section: NodeOut;
  document: { id: string; assemblyGuide: string | null; node: NodeOut } | null;
  covers: string[];                                    // [] ⇒ front-matter (cover, TOC, intro)
  curriculum: { nodes: NodeOut[]; edges: EdgeOut[] };  // pure hasPart/hasChild from the covers targets
  routine: SectionRoutine | null;
  formatters: { nodes: NodeOut[]; edges: EdgeOut[] };  // the TLM's doc-wide stack ∪ this section's own
};

// The generation scope rooted at one DocumentSection. Returns null if `sectionId`
// is not a DocumentSection node in this graph.
export function documentSectionSubgraph(model: CurriculumModel, sectionId: string): DocumentSectionScope | null {
  const raw = model.rawGraph;
  if (!raw) return null;
  const section = raw.nodes.find((n) => n.id === sectionId);
  if (!section || !labelsOf(section).includes(SECTION_LABEL)) return null;

  // Everything above the section on the document axis: the sections it is nested
  // in (nearest first) and the document at the top.
  const ancestry = documentAncestry(raw, sectionId);
  const tlm = ancestry.tlm;
  const document = tlm
    ? { id: tlm.id, assemblyGuide: assemblyGuideOf(tlm), node: nodeOut(tlm) }
    : null;

  // The curriculum this slot renders: the section's covers targets and their pure
  // containment subtree. An empty covers marks a front-matter section.
  const covers = raw.relationships.filter((e) => e.type === "covers" && e.start === sectionId).map((e) => e.end);
  const curriculumIds = descendants(raw, covers, CURRICULUM_EDGES);
  const curriculum = inducedSubgraph(raw, curriculumIds, CURRICULUM_EDGES);

  const routine = resolveSectionRoutine(raw, sectionId, ancestry, covers);

  // Formatters: every stack on this section's OWN path — its own, those of the
  // sections it is nested in, and the owning TLM's doc-wide stack. Sibling sections'
  // stacks are excluded, because each walk walls at a section boundary.
  const formatterIds = new Set<string>(
    [sectionId, ...ancestry.sections, ...(tlm ? [tlm.id] : [])]
      .flatMap((id) => [...ownFormatterIds(raw, id)]),
  );
  const formatters = inducedSubgraph(raw, formatterIds, new Set([DOCUMENT_EDGE]));

  return { section: nodeOut(section), document, covers, curriculum, routine, formatters };
}
