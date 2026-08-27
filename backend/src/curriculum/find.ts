/*
 * Module: curriculum · find a node by the name a person would type
 *
 * The server-side half of "the expert never pastes a UUID"
 * (docs/design-notes/self-serve-authoring.md, D9). An expert says
 * "Chapitre 5", not "a3f2-…"; client-side completion was measured and does not
 * render, so the resolution has to happen here.
 *
 * Two entry points over the same scoring:
 *   • findNodes  — a ranked list, for the find_node tool.
 *   • resolveRef — one id, or the CANDIDATES that made it ambiguous, so the
 *     caller asks "chapter 5 of the teacher's guide or of the pupil manual?"
 *     instead of guessing. Ambiguity is the common case here: two Courses in one
 *     subject each hold a "Chapitre 5".
 *
 * Matching is accent- and case-insensitive because the graphs are French: an
 * expert types "chapitre 5 les nombres jusqu'a 20" for a node titled
 * "Chapitre 5 : Les nombres jusqu'à 20", and that must be an exact match, not a
 * near miss.
 */
import type { CurriculumModel } from "../types.js";
import { displayName } from "../utils/index.js";

/**
 * The least a graph must look like to be searched: nodes with labels + display
 * properties, and typed edges. Both shapes we hold satisfy it — the read model's
 * raw envelope (via `toFindable`) and the store's MutationGraph (directly) — so
 * a name resolves the same way on a read path and on a write path.
 */
export type FindableGraph = {
  nodes: Array<{ id: string; labels?: string[]; properties?: Record<string, unknown> }>;
  edges: Array<{ type: string; from: string; to: string }>;
};

type FindableNode = FindableGraph["nodes"][number];

/** The read model's raw envelope as a searchable graph. */
export const toFindable = (model: CurriculumModel): FindableGraph => ({
  nodes: model.rawGraph?.nodes ?? [],
  edges: (model.rawGraph?.relationships ?? []).map((edge) => ({ type: edge.type, from: edge.start, to: edge.end })),
});

// Containment edges — the ones that give a node its place in a tree, and so its
// disambiguating path ("Guide de l'enseignant › Chapitre 5").
const CONTAINMENT_EDGES = new Set(["hasPart", "hasChild"]);

// How well a node's title answers the typed query, best first. The tiers exist so
// resolveRef can tell "one obvious answer" from "several equally good ones": an
// exact title beats a title that merely contains the words, however many.
export type MatchQuality = "exact" | "prefix" | "contains" | "words";

const QUALITY_RANK: Record<MatchQuality, number> = { exact: 0, prefix: 1, contains: 2, words: 3 };

export type FoundNode = {
  id: string;
  labels: string[];
  title: string;
  match: MatchQuality;
  /** Containment ancestors' titles, outermost first — what tells two "Chapitre 5"s apart. */
  path: string[];
};

export type FindArgs = {
  query: string;
  /** Restrict to nodes carrying one of these LC labels (e.g. ["LessonGrouping"]). */
  labels?: string[];
  limit?: number;
};

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

// Fold accents and case, drop punctuation, collapse runs of whitespace — so
// "Chapitre 5 : Les nombres jusqu'à 20" and "chapitre 5 les nombres jusqu'a 20"
// compare equal.
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Best-effort display title, across BOTH node shapes this searches: the read
// model's raw envelope carries the LC props flat (`description`), while a stored
// node carries normalized fields plus a `raw` bag. Trying all of them is what
// lets one implementation serve a read path and a write path.
function displayTitle(node: FindableNode): string {
  const properties = (node.properties ?? {}) as Record<string, unknown>;
  const raw = (properties.raw ?? {}) as Record<string, unknown>;
  for (const candidate of [properties.title, properties.text, properties.description, raw.description]) {
    // Line 1 only: a routine's description carries its name there and its whole
    // authored text below, and an expert searches by the name.
    if (typeof candidate === "string" && candidate.length > 0) return displayName(candidate);
  }
  return "";
}

// How the query matches this title, or null when it doesn't. "words" is the
// loosest tier: every word of the query appears somewhere in the title, in any
// order ("nombres chapitre 5" finds "Chapitre 5 : Les nombres…").
function qualityOf(normalizedQuery: string, normalizedTitle: string): MatchQuality | null {
  if (!normalizedTitle) return null;
  if (normalizedTitle === normalizedQuery) return "exact";
  if (normalizedTitle.startsWith(normalizedQuery)) return "prefix";
  if (normalizedTitle.includes(normalizedQuery)) return "contains";
  const words = normalizedQuery.split(" ").filter(Boolean);
  return words.length > 1 && words.every((word) => normalizedTitle.includes(word)) ? "words" : null;
}

// Parent-of index over containment edges only, so a path never wanders through
// an alignment or `covers` edge.
function buildParentIndex(graph: FindableGraph): Map<string, string> {
  const parentOf = new Map<string, string>();
  for (const edge of graph.edges) {
    if (!CONTAINMENT_EDGES.has(edge.type)) continue;
    // First containment parent wins — a maths Lesson has two (its grouping and
    // its week), and either one names the branch well enough to disambiguate.
    if (!parentOf.has(edge.to)) parentOf.set(edge.to, edge.from);
  }
  return parentOf;
}

// The node's ancestors' titles, outermost first. Bounded so a deep chain can't
// produce an unreadable path, and cycle-guarded because the graph is authored data.
function pathOf(id: string, parentOf: Map<string, string>, titleOf: Map<string, string>): string[] {
  const path: string[] = [];
  const seen = new Set<string>([id]);
  let current = parentOf.get(id);
  while (current && !seen.has(current) && path.length < 4) {
    seen.add(current);
    const title = titleOf.get(current);
    if (title) path.unshift(title);
    current = parentOf.get(current);
  }
  return path;
}

/**
 * Rank the nodes whose title answers `query`, best match first (ties broken by
 * shorter title, then id, so the order is stable across calls).
 */
export function findNodes(graph: FindableGraph, args: FindArgs): FoundNode[] {
  const normalizedQuery = normalize(args.query);
  if (!normalizedQuery) return [];

  const wanted = args.labels?.length ? new Set(args.labels) : null;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(args.limit ?? DEFAULT_LIMIT)));

  const titleOf = new Map<string, string>(graph.nodes.map((node) => [node.id, displayTitle(node)]));
  const parentOf = buildParentIndex(graph);

  const hits: FoundNode[] = [];
  for (const node of graph.nodes) {
    if (wanted && !(node.labels ?? []).some((label) => wanted.has(label))) continue;
    const title = titleOf.get(node.id) ?? "";
    const match = qualityOf(normalizedQuery, normalize(title));
    if (!match) continue;
    hits.push({ id: node.id, labels: node.labels ?? [], title, match, path: pathOf(node.id, parentOf, titleOf) });
  }

  hits.sort((a, b) =>
    QUALITY_RANK[a.match] - QUALITY_RANK[b.match] ||
    a.title.length - b.title.length ||
    a.id.localeCompare(b.id));
  return hits.slice(0, limit);
}

export type ResolvedRef =
  | { ok: true; id: string; node?: FoundNode }
  | { ok: false; reason: "none"; candidates: [] }
  | { ok: false; reason: "ambiguous"; candidates: FoundNode[] };

/**
 * Turn what the expert typed — an id OR a name — into one node id.
 *
 * A literal node id always wins (a caller that already holds one should not be
 * re-matched by text). Otherwise the best match resolves ONLY when it is
 * strictly better than the runner-up; equally-good matches come back as
 * candidates rather than a guess, because guessing here silently writes the
 * document against the wrong chapter.
 */
export function resolveRef(graph: FindableGraph, ref: string, args: { labels?: string[] } = {}): ResolvedRef {
  if (graph.nodes.some((node) => node.id === ref)) return { ok: true, id: ref };

  const hits = findNodes(graph, { query: ref, labels: args.labels, limit: 6 });
  if (hits.length === 0) return { ok: false, reason: "none", candidates: [] };
  if (hits.length === 1 || QUALITY_RANK[hits[0].match] < QUALITY_RANK[hits[1].match]) {
    return { ok: true, id: hits[0].id, node: hits[0] };
  }
  return { ok: false, reason: "ambiguous", candidates: hits };
}
