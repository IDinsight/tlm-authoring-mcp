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
import { nodeOut, edgeOut, nodeSkeleton, type NodeOut, type EdgeOut } from "./read-projection.js";
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


// walk_document assembles a whole document, and EVERY part of it can be too big
// to inline — so, exactly as exportSubtree bounds a visualization slice, the
// payload self-bounds here rather than letting the ~100 KB response cap withhold
// it whole.
//
// The parts are shed in order of how REPLACEABLE each one is elsewhere, so what
// survives is what only this tool can answer:
//   1. `curriculum` — a whole-Course document's curriculum is essentially the
//      entire graph. Reachable per-section via walk_document_section.
//   2. `document` — the TLM subtree. Measured on live ci/maths, its 579
//      DocumentSections are 2,276 KB of a 2,707 KB payload (~4 KB of authored
//      assemblyGuide each) and its 9 FormatterSpecs another 55 KB. Every one of
//      those nodes is returned by walk_document_section, which also carries the
//      TLM's doc-wide formatter stack, so nothing here is lost — only relocated.
//   3. `sections` — trimmed to the budget with a `nextCursor`, because even the
//      LEAN spine of that document is 88.8 KB at 579 entries (three UUIDs each).
//      This is the one part nothing else provides: it is the fan-out list.
// The assembly guide and `scope` are small and always ride.
//
// Budget sits under the response cap with headroom for the envelope; tunable via
// TLM_DOCUMENT_MAX_BYTES.
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

// The TLM subtree inlined when it fits, or the same self-bounding marker shape
// when it would blow the cap. Separate type from CurriculumTooLarge only so its
// `message` can route to the document-side remedy.
export type DocumentTooLarge = {
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
  sections: DocumentSectionOut[];              // this PAGE of the spine, in reading order; [] when there is no spine
  sectionsTotal: number;                       // how many the document has in all, however many this page holds
  sectionsTruncated?: true;                    // this page is not the whole spine — page on with nextCursor
  nextCursor?: string;                          // opaque; pass back as `cursor` for the next page of sections
  spineNote?: string;                           // present only when the BUDGET (not `limit`) trimmed the spine
  document: { nodes: NodeOut[]; edges: EdgeOut[] } | DocumentTooLarge;   // the TLM subtree: TLM + hasPart(sections/formatters/specs) + covers edges
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

// How to fetch the document subtree once it is too big to inline. Every node in it
// — each DocumentSection, and the TLM's doc-wide Formatter/FormatterSpec stack —
// comes back from walk_document_section, so this is a redirect, not a loss.
function documentTooLargeMessage(sections: number, bytes: number, budget: number): string {
  return (
    `This document's own subtree (its DocumentSections and its Formatter/FormatterSpec stack) is ` +
    `~${Math.round(bytes / 1024)} KB, over the ~${Math.round(budget / 1024)} KB budget for one document payload. ` +
    `Nothing is lost: call walk_document_section on each of the ${sections} ids in \`sections\` — each returns that ` +
    `section in full ALONG WITH this document's doc-wide formatter stack, which is what you would have read here.`
  );
}

// How to page on when even the lean spine does not fit. Said only when it happens,
// so a document whose spine fits whole never reads about a cursor.
function spineTruncatedMessage(shown: number, total: number): string {
  return (
    `This page holds ${shown} of the document's ${total} sections — the spine is too large for one response. ` +
    `Call walk_document again with cursor:<nextCursor> for the next page; the assemblyGuide and scope repeat on every page.`
  );
}

// ── Section-spine paging ──────────────────────────────────────────────────────
// The spine is recomputed identically on every call (a deterministic depth-first
// walk), so resuming needs only the id the previous page stopped at — the same
// stateless-cursor approach walk_graph and read_audit use. No frontier state, and
// a garbage cursor decodes to null so the caller gets a clear error, not a wrong
// page.
const encodeSpineCursor = (lastId: string): string => Buffer.from(lastId, "utf8").toString("base64");

/**
 * Decode a spine cursor, or null if it was not one we issued.
 *
 * The validity check is a ROUND-TRIP, not a try/catch: Node's base64 decoder is
 * lenient — `Buffer.from("!!!not-base64!!!", "base64")` throws nothing and yields
 * garbage bytes — so a malformed cursor would otherwise sail through and be
 * reported as "section not in this spine", pointing the caller at the wrong
 * problem. Re-encoding the decoded id and comparing rejects anything that is not
 * the canonical encoding of some id. (walk.ts's cursor gets this for free because
 * it JSON.parses the payload, which does throw.)
 */
const decodeSpineCursor = (cursor: string): string | null => {
  try {
    const id = Buffer.from(cursor, "base64").toString("utf8");
    if (id.length === 0 || encodeSpineCursor(id) !== cursor) return null;
    return id;
  } catch {
    return null;
  }
};

/**
 * Largest prefix of `sections` whose serialized size fits `budget`. Binary search
 * over prefix length — the same size-monotonic-window trick walk.ts uses — so it
 * costs O(log n) measurements rather than n. Always yields at least one section
 * when there is any: a caller must be able to make progress, even one section per
 * page, and truncating a section's own fields would corrupt the shape.
 */
function fitSpineToBudget(sections: DocumentSectionOut[], budget: number): number {
  if (sections.length === 0) return 0;
  const bytesForPrefix = (count: number): number => byteLength(sections.slice(0, count));
  if (bytesForPrefix(sections.length) <= budget) return sections.length;

  let low = 1;
  let high = sections.length;
  let best = 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (bytesForPrefix(mid) <= budget) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

/** Paging over the section spine; both optional, both caller-supplied. */
export type DocumentScopeOptions = { limit?: number; cursor?: string };

// The document rooted at one TLM. Returns null if `tlmId` is not a
// TeachingLearningMaterial node in this graph, or { error } for a bad cursor —
// the one caller mistake that must not silently return the wrong page.
export function documentSubgraph(
  model: CurriculumModel,
  tlmId: string,
  options: DocumentScopeOptions = {},
): DocumentScope | { error: string } | null {
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

  // 4. Resolve the caller's page of the spine before measuring anything, so the
  //    budget is spent on the sections actually being returned.
  const sectionsTotal = sections.length;
  const cursorId = options.cursor ? decodeSpineCursor(options.cursor) : null;
  if (options.cursor && !cursorId) {
    return { error: "Invalid cursor — pass a cursor returned by a prior walk_document page, unmodified." };
  }
  if (cursorId && !sections.some((section) => section.id === cursorId)) {
    return { error: `Cursor points at section '${cursorId}', which is not in this document's spine. Start a fresh walk_document without a cursor.` };
  }
  const resumeIndex = cursorId ? sections.findIndex((section) => section.id === cursorId) + 1 : 0;
  const requested = options.limit !== undefined
    ? sections.slice(resumeIndex, resumeIndex + Math.max(1, options.limit))
    : sections.slice(resumeIndex);

  // 5. Self-bound: shed the replaceable parts in order until the payload fits,
  //    then trim the spine itself. Each step is measured, never estimated, so the
  //    result is bounded by what the response will actually carry.
  const budget = documentMaxBytes();
  const guide = assemblyGuideOf(tlm);
  const curriculumMarker = (): CurriculumTooLarge => {
    const approxBytes = byteLength(curriculum);
    return {
      tooLarge: true,
      counts: { nodes: curriculum.nodes.length, edges: curriculum.edges.length },
      approxBytes,
      softCapBytes: budget,
      message: curriculumTooLargeMessage(scope, sections, approxBytes, budget),
    };
  };
  const documentMarker = (): DocumentTooLarge => {
    const approxBytes = byteLength(document);
    return {
      tooLarge: true,
      counts: { nodes: document.nodes.length, edges: document.edges.length },
      approxBytes,
      softCapBytes: budget,
      message: documentTooLargeMessage(sectionsTotal, approxBytes, budget),
    };
  };

  const assemble = (
    parts: { document: DocumentScope["document"]; curriculum: DocumentScope["curriculum"]; sections: DocumentSectionOut[] },
  ): DocumentScope => {
    const truncated = parts.sections.length < requested.length
      || resumeIndex + parts.sections.length < sectionsTotal;
    const last = parts.sections[parts.sections.length - 1];
    return {
      tlm: tlmId,
      assemblyGuide: guide,
      scope,
      sections: parts.sections,
      sectionsTotal,
      ...(truncated && last ? { sectionsTruncated: true as const, nextCursor: encodeSpineCursor(last.id) } : {}),
      document: parts.document,
      curriculum: parts.curriculum,
    };
  };

  // Tier 1-3: everything, then without the curriculum, then without the subtree.
  const tiers: Array<{ document: DocumentScope["document"]; curriculum: DocumentScope["curriculum"] }> = [
    { document, curriculum },
    { document, curriculum: curriculumMarker() },
    { document: documentMarker(), curriculum: curriculumMarker() },
  ];
  for (const tier of tiers) {
    const candidate = assemble({ ...tier, sections: requested });
    if (byteLength(candidate) <= budget) {
      return candidate;
    }
  }

  // Tier 4: even the lean spine does not fit. Trim it against the budget left
  // once the envelope and guide are accounted for, and hand back a cursor.
  const shed = { document: documentMarker(), curriculum: curriculumMarker() };
  const envelopeBytes = byteLength(assemble({ ...shed, sections: [] }));
  const fitCount = fitSpineToBudget(requested, Math.max(budget - envelopeBytes, 0));
  const page = assemble({ ...shed, sections: requested.slice(0, Math.max(fitCount, 1)) });
  return { ...page, spineNote: spineTruncatedMessage(page.sections.length, sectionsTotal) };
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
// `description` — no Material children, since a 2026-08 migration folded each
// step's script onto the step itself.
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
/*
 * One owner's formatters, in the order they should be APPLIED.
 *
 * Depth-first through the document edge, siblings by position, walling at a
 * walling at a nested DocumentSection — so a Formatter's FormatterSpec children
 * come back in the order the author put them in, and a sibling section's own
 * stack stays out of it.
 *
 * The order is not cosmetic. Each spec carries a `render` bag and the bags MERGE,
 * nearest wins; a set has no order, so resolving a stack out of it would let two
 * specs that disagree resolve differently from one read to the next.
 */
function ownFormattersInOrder(raw: RawGraphSnapshot, rootId: string): string[] {
  const childrenOf = new Map<string, RawNode[]>();
  for (const e of raw.relationships) {
    if (e.type !== DOCUMENT_EDGE) continue;
    const child = raw.nodes.find((n) => n.id === e.end);
    if (!child) continue;
    (childrenOf.get(e.start) ?? childrenOf.set(e.start, []).get(e.start)!).push(child);
  }

  const found: string[] = [];
  const seen = new Set<string>();
  const visit = (parentId: string): void => {
    const children = [...(childrenOf.get(parentId) ?? [])].sort((a, b) => positionOf(a) - positionOf(b));
    for (const node of children) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      if (labelsOf(node).includes(SECTION_LABEL)) continue;   // wall: a sibling section's own subtree
      if (labelsOf(node).some((l) => FORMATTER_LABELS.has(l))) found.push(node.id);
      visit(node.id);
    }
  };
  visit(rootId);
  return found;
}

/*
 * The formatter stack for a section, in APPLICATION ORDER: the owning document's
 * doc-wide formatters first, then each section it is nested in from outermost
 * in, then its own last.
 *
 * That order IS the "nearest wins" rule, spelled as a sequence so whoever merges
 * the bags does not have to know the document's shape. `ancestry.sections` runs
 * nearest-first, which is the opposite of what applying them needs, so it is
 * reversed here rather than at every call site.
 */
function formatterStackIds(
  raw: RawGraphSnapshot, sectionId: string, ancestrySections: string[], tlmId: string | null,
): string[] {
  const owners = [...(tlmId ? [tlmId] : []), ...[...ancestrySections].reverse(), sectionId];
  const seen = new Set<string>();
  const stack: string[] = [];
  for (const owner of owners) {
    for (const id of ownFormattersInOrder(raw, owner)) {
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(id);
    }
  }
  return stack;
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

/*
 * The formatter stack for whatever a caller names — a DocumentSection or the
 * document itself — in application order, or null if it is neither.
 *
 * A section's stack runs from the document's own formatters down to its; a TLM
 * has only its doc-wide ones. Both are the same question, and a renderer should
 * not have to ask it two ways.
 */
export function formatterStackFor(model: CurriculumModel, nodeId: string): RawNode[] | null {
  const raw = model.rawGraph;
  if (!raw) return null;
  const node = raw.nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const labels = labelsOf(node);
  // RAW nodes, not the read projection: this feeds the renderer, which needs
  // every declared property. `nodeOut` exists to trim a tool RESPONSE, and
  // trimming an internal read is how a formatter silently loses its `render`.
  const byId = new Map(raw.nodes.map((n) => [n.id, n]));
  const pick = (ids: string[]) => ids.map((id) => byId.get(id)!);

  if (labels.includes(SECTION_LABEL)) {
    const ancestry = documentAncestry(raw, nodeId);
    return pick(formatterStackIds(raw, nodeId, ancestry.sections, ancestry.tlm?.id ?? null));
  }
  if (labels.includes(TLM_LABEL)) {
    return pick(ownFormattersInOrder(raw, nodeId));
  }
  return null;
}

// Everything a per-section generation composes: the section node, the owning
// document, the curriculum this slot renders, the applicable routine, and the
// formatters (doc-wide + this section's own).
export type DocumentSectionScope = {
  section: NodeOut;
  /*
   * The owning document. When `include` leaves the document out, the IDENTITY
   * survives (`id`, and `assemblyGuideOmitted`) and only the weight goes — a
   * caller still needs to know which TLM this section belongs to, and on the
   * live ci/maths spine the assembly guide alone is most of a page's bytes.
   */
  document: { id: string; assemblyGuide?: string | null; node?: NodeOut; assemblyGuideOmitted?: true } | null;
  covers: string[];                                    // [] ⇒ front-matter (cover, TOC, intro)
  curriculum?: { nodes: NodeOut[]; edges: EdgeOut[] };  // pure hasPart/hasChild from the covers targets
  routine?: SectionRoutine | null;
  formatters?: { nodes: NodeOut[]; edges: EdgeOut[] };  // the TLM's doc-wide stack ∪ this section's own
  /*
   * The parts `include` left out.
   *
   * Stated explicitly because absence is AMBIGUOUS in this shape and the two
   * meanings matter: `routine: null` means no routine applies to this section,
   * while a missing `routine` means you did not ask for it. A caller that read
   * the second as the first would compose a section with no routine at all.
   */
  omitted?: SectionPart[];
  // The formatters' PRECEDENCE ORDER as ids — doc-wide first, this section's own
  // last. Merging their `render` bags in this order is what "nearest wins" means;
  // `formatters` above is the subgraph, which has no order. Ids rather than nodes:
  // this used to repeat every node in full, and on the live ce1/reading Guide those
  // 18 formatters were 44.8 KB served twice — 92 KB of a 118 KB payload, which put
  // ALL 21 of that document's sections over the response cap. Look each id up in
  // `formatters.nodes`.
  formatterStackOrder: string[];
  // Present only when the byte budget paged the stack — the remaining ids, in
  // order, and the cursor that fetches them.
  formattersTruncated?: true;
  nextCursor?: string;
  stackNote?: string;
};

/*
 * The parts of a section's scope a caller can ask for.
 *
 * WHY AN ALLOWLIST. Every part here is document-level except the section itself:
 * the assembly guide, the formatter stack and the covered curriculum are
 * IDENTICAL across all of a document's sections. A caller producing a document
 * section by section therefore re-receives them once per section — measured at
 * ~78 KB a section on the live ce1/reading Guide, of which the parts that change
 * are a small fraction. Fetch the document once, then ask for the section alone.
 *
 * `detail:"skeleton"` already trims the same parts, but trimming is not the same
 * as not sending: a caller who HAS the formatters wants them gone, not smaller.
 */
export const SECTION_PARTS = ["document", "curriculum", "routine", "formatters"] as const;
export type SectionPart = (typeof SECTION_PARTS)[number];

/** Paging + verbosity + which parts to send, for one section's scope. */
export type SectionScopeOptions = {
  detail?: "skeleton" | "full";
  cursor?: string;
  /** Parts to include. Omitted ⇒ all of them, which is the previous behaviour. */
  include?: SectionPart[];
};

/*
 * Why this reader bounds itself DIFFERENTLY from documentSubgraph.
 *
 * walk_document can shed parts because walk_document_section sits below it. This
 * is the bottom — there is no finer read to redirect to — so nothing here may be
 * dropped with a "fetch it over there" marker. Measured on the live ce1/reading
 * Guide, every one of its 21 sections came to ~121 KB and so was refused WHOLE,
 * with the error text admitting it had "no limit or cursor" to narrow. That made
 * the routed-to tool the dead end.
 *
 * Three levers, in the order they are applied:
 *   1. Stop repeating the formatters (see formatterStackOrder) — 92 KB → 45 KB on
 *      that document, with nothing lost. This alone fits every reading section.
 *   2. `detail:"skeleton"` trims the CONTEXT parts — the covered curriculum and the
 *      owning TLM's node — and never the two things this tool exists to deliver:
 *      the section's own node (which carries its assemblyGuide) and the formatter
 *      stack. Trimming those would defeat the read.
 *   3. Only if it still does not fit, the formatter stack PAGES, nearest-last order
 *      preserved, with a cursor. A caller always makes progress.
 */
export function documentSectionSubgraph(
  model: CurriculumModel,
  sectionId: string,
  options: SectionScopeOptions = {},
): DocumentSectionScope | { error: string } | null {
  const raw = model.rawGraph;
  if (!raw) return null;
  const section = raw.nodes.find((n) => n.id === sectionId);
  if (!section || !labelsOf(section).includes(SECTION_LABEL)) return null;

  const skeleton = options.detail === "skeleton";
  const projectContext = skeleton ? nodeSkeleton : nodeOut;

  // No `include` means every part, so an existing caller is unaffected.
  const wanted = new Set<SectionPart>(options.include ?? SECTION_PARTS);
  const omitted = SECTION_PARTS.filter((part) => !wanted.has(part));

  // Everything above the section on the document axis: the sections it is nested
  // in (nearest first) and the document at the top.
  const ancestry = documentAncestry(raw, sectionId);
  const tlm = ancestry.tlm;
  const document = tlm
    ? wanted.has("document")
      ? { id: tlm.id, assemblyGuide: assemblyGuideOf(tlm), node: projectContext(tlm) }
      : { id: tlm.id, assemblyGuideOmitted: true as const }
    : null;

  // The curriculum this slot renders: the section's covers targets and their pure
  // containment subtree. An empty covers marks a front-matter section. `covers`
  // itself is always sent — it is a handful of ids, and it is what tells a
  // front-matter section from one that renders curriculum.
  const covers = raw.relationships.filter((e) => e.type === "covers" && e.start === sectionId).map((e) => e.end);
  const curriculumIds = descendants(raw, covers, CURRICULUM_EDGES);
  const curriculum = !wanted.has("curriculum")
    ? undefined
    : skeleton
      ? { nodes: raw.nodes.filter((n) => curriculumIds.has(n.id)).map(nodeSkeleton), edges: [] }
      : inducedSubgraph(raw, curriculumIds, CURRICULUM_EDGES);

  const routine = wanted.has("routine") ? resolveSectionRoutine(raw, sectionId, ancestry, covers) : undefined;

  // Formatters: every stack on this section's OWN path — its own, those of the
  // sections it is nested in, and the owning TLM's doc-wide stack. Sibling sections'
  // stacks are excluded, because each walk walls at a section boundary.
  const stackIds = formatterStackIds(raw, sectionId, ancestry.sections, tlm?.id ?? null);

  const cursorId = options.cursor ? decodeSpineCursor(options.cursor) : null;
  if (options.cursor && !cursorId) {
    return { error: "Invalid cursor — pass a cursor returned by a prior walk_document_section page, unmodified." };
  }
  if (cursorId && !stackIds.includes(cursorId)) {
    return { error: `Cursor points at formatter '${cursorId}', which is not in this section's stack. Start a fresh walk_document_section without a cursor.` };
  }
  const remainingIds = cursorId ? stackIds.slice(stackIds.indexOf(cursorId) + 1) : stackIds;

  // The section's own node and the stack are never trimmed, so they are built once
  // and the only thing the budget can move is HOW MANY formatters ride this page.
  const base = {
    section: nodeOut(section),   // always full: it carries this slot's assemblyGuide
    document,
    covers,
    ...(curriculum ? { curriculum } : {}),
    ...(routine !== undefined ? { routine } : {}),
    ...(omitted.length ? { omitted } : {}),
  };
  // `formatterStackOrder` survives even when the formatters themselves are
  // omitted: it is a list of ids, and it is the PRECEDENCE a caller needs to
  // merge the `render` bags it already holds. Dropping it would make the saving
  // useless — you would have the bags and no idea which one wins.
  const assemble = (ids: string[]): DocumentSectionScope => {
    const truncated = wanted.has("formatters") && ids.length < remainingIds.length;
    const last = ids[ids.length - 1];
    return {
      ...base,
      ...(wanted.has("formatters") ? { formatters: inducedSubgraph(raw, new Set(ids), new Set([DOCUMENT_EDGE])) } : {}),
      formatterStackOrder: ids,
      ...(truncated && last
        ? {
            formattersTruncated: true as const,
            nextCursor: encodeSpineCursor(last),
            stackNote: sectionStackTruncatedMessage(ids.length, stackIds.length),
          }
        : {}),
    };
  };

  const whole = assemble(remainingIds);
  const budget = documentMaxBytes();
  if (byteLength(whole) <= budget) {
    return whole;
  }

  // Trim the stack against what is left once the un-trimmable parts are counted.
  const envelopeBytes = byteLength(assemble([]));
  const fitCount = fitStackToBudget(raw, remainingIds, Math.max(budget - envelopeBytes, 0));
  return assemble(remainingIds.slice(0, Math.max(fitCount, 1)));
}

// Said only when the stack was actually paged, so a section whose formatters all
// fit never reads about a cursor.
function sectionStackTruncatedMessage(shown: number, total: number): string {
  return (
    `This page carries ${shown} of the section's ${total} formatters, in precedence order — the stack is too large for one ` +
    `response. Call walk_document_section again with cursor:<nextCursor> for the rest; merge their \`render\` bags in the ` +
    `order received, across pages, so nearest still wins. Try detail:'skeleton' to fit more per page.`
  );
}

/**
 * Largest prefix of `ids` whose formatter subgraph fits `budget`. Binary search
 * over prefix length, like the spine's — the stack is small (18 on the live
 * reading Guide), but a formatter spec runs to 10 KB, so measuring beats guessing.
 */
function fitStackToBudget(raw: RawGraphSnapshot, ids: string[], budget: number): number {
  if (ids.length === 0) return 0;
  const bytesForPrefix = (count: number): number =>
    byteLength(inducedSubgraph(raw, new Set(ids.slice(0, count)), new Set([DOCUMENT_EDGE])));
  if (bytesForPrefix(ids.length) <= budget) return ids.length;

  let low = 1;
  let high = ids.length;
  let best = 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (bytesForPrefix(mid) <= budget) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}
