/*
 * Module: server · tool group: graph reads (walk + stats)
 *
 * The two generic, subject-agnostic graph readers:
 *   • walk_graph — one directional, filtered, paginated BFS from any node. The
 *     single traversal primitive that replaced get_course: a course subtree is
 *     walk "out" over hasPart/hasChild; the whole standards spine is walk "out"
 *     over hasChild from the framework root; the framework root itself is walk
 *     "in" over hasChild from any standard. slot:"draft" walks the UNPUBLISHED
 *     draft (curator/approver only, same tier as diff_draft) so a curator can
 *     inspect staged edits before publishing.
 *   • namespace_stats — a cheap, argument-free orientation snapshot (node/edge
 *     counts, roots, draft state) to run before writing any query.
 *
 * Both are read-only and scoped to the active workspace/grade/subject.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { asJson, guarded } from "./shared.js";
import { getActiveAdapter } from "../adapters/index.js";
import { activeWorkspace, sessionState } from "../context/index.js";
import { getKgStore, kgNamespace, toAuditActor, diffGraphs, type GraphDiff, nextAuditSeq } from "../kg-store/index.js";
import { exportSubtree } from "../kg-export.js";
import { walkGraph, computeGraphStats, documentSubgraph, documentSectionSubgraph, findNodes, toFindable, PRELOADED_SLOT_KEY, type WalkDirection, type FindableGraph, type FoundNode } from "../curriculum/index.js";
import { resolveDraftModel } from "./preview.js";
import { authorize } from "../authz.js";
import { currentActor } from "../actor.js";
import type { CurriculumModel } from "../types.js";

function activeNamespace(): string {
  const adapter = getActiveAdapter();
  return kgNamespace(activeWorkspace(), adapter.grade, adapter.subject);
}

// The physical slot ("a"/"b") the session's published read model was hydrated
// from — stamped by activate.ts / refreshActiveContext. It is the true origin of
// a slot:"published" read, so reporting it lets a caller spot a read/write
// disagreement (e.g. reads still on the old slot after a publish flip). null
// before any context is activated.
function preloadedSlot(): string | null {
  return (sessionState().bag.get(PRELOADED_SLOT_KEY) as string | undefined) ?? null;
}

type WalkSlot = "published" | "draft";

// Draft reads are pre-publish working state, gated to the same tier as
// diff_draft / preview_generation (curator + approver). Returns a denial payload
// when blocked — and audits it, so an unauthorized draft peek is recorded — or
// null when allowed. Mirrors preview.ts's own denyIfNotDraftReader.
async function denyIfNotDraftReader(namespace: string): Promise<Record<string, unknown> | null> {
  const actor = currentActor();
  const authz = authorize(actor, "readDraft", namespace);
  if (authz.ok) {
    return null;
  }
  await getKgStore().appendAudit({
    id: randomUUID(),
    ts: new Date().toISOString(), seq: nextAuditSeq(),
    actor: toAuditActor(actor),
    namespace,
    eventType: "blocked",
    reason: `unauthorized: ${authz.reason}`,
  });
  return { phase: "unauthorized", action: "readDraft", reason: authz.reason };
}

// Resolve the model to walk: the published read model, or — for slot:"draft" —
// the draft-resolved model diff_draft/preview read from. Returns a notice
// payload (denial, or "no draft") instead of a model when the draft can't be read.
async function resolveWalkModel(
  namespace: string,
  slot: WalkSlot,
): Promise<{ model: CurriculumModel; physicalSlot: string | null } | { notice: Record<string, unknown> }> {
  if (slot === "published") {
    return { model: getActiveAdapter().model(), physicalSlot: preloadedSlot() };
  }

  const denied = await denyIfNotDraftReader(namespace);
  if (denied) {
    return { notice: denied };
  }

  const resolved = await resolveDraftModel(namespace);
  if (!resolved) {
    return {
      notice: {
        slot: "draft",
        noDraft: true,
        message: `No draft exists for '${namespace}' to walk. Stage an edit first (add_node / add_nodes / …), or walk slot:"published".`,
      },
    };
  }
  // resolveDraftModel read the pointer fresh, so draftSlot is the real slot.
  return { model: resolved.model, physicalSlot: resolved.draftSlot };
}

// The arguments walk_graph accepts, shared by the tool handler and the exported
// core so tests drive the real logic (slot resolution + gating included).
export type WalkToolArgs = {
  fromId: string;
  direction: WalkDirection;
  edgeTypes?: string[];
  nodeTypes?: string[];
  maxDepth?: number;
  includeEdges?: boolean;
  limit?: number;
  cursor?: string;
  slot?: WalkSlot;
};

// ── Core: walk_graph ──────────────────────────────────────────────────────────
// Resolve the slot (published, or a role-gated draft), then run the generic BFS.
// Exported so tests drive the real logic directly (like buildCapabilitiesReport).
export async function walkActiveGraph(args: WalkToolArgs): Promise<Record<string, unknown>> {
  const namespace = activeNamespace();
  const slot = args.slot ?? "published";

  const resolved = await resolveWalkModel(namespace, slot);
  if ("notice" in resolved) {
    return resolved.notice;
  }

  const result = walkGraph(resolved.model, {
    fromId: args.fromId,
    direction: args.direction,
    edgeTypes: args.edgeTypes,
    nodeTypes: args.nodeTypes,
    maxDepth: args.maxDepth,
    includeEdges: args.includeEdges,
    limit: args.limit,
    cursor: args.cursor,
  });
  return { slot, physicalSlot: resolved.physicalSlot, ...result };
}

// ── Core: walk_document ───────────────────────────────────────────────────────
// Resolve one TeachingLearningMaterial's full scope: its assembly guide, its
// rendering stack, and the curriculum it renders (section spine or Course
// fallback). The generation-side counterpart to walk_graph — where walk_graph
// reads the curriculum to teach, this reads the document to produce. Slot-aware
// (published default; role-gated draft) like walk_graph, so a curator can inspect
// a document they are authoring before publishing. Exported so tests drive the
// real logic directly.
export async function walkDocument(args: { tlmId: string; slot?: WalkSlot }): Promise<Record<string, unknown>> {
  const namespace = activeNamespace();
  const slot = args.slot ?? "published";

  const resolved = await resolveWalkModel(namespace, slot);
  if ("notice" in resolved) {
    return resolved.notice;
  }

  const document = documentSubgraph(resolved.model, args.tlmId);
  if (!document) {
    return { error: `TeachingLearningMaterial '${args.tlmId}' not found in the ${slot} graph. Call namespace_stats (its roots, filtered by labels including 'TeachingLearningMaterial') for available document ids.` };
  }
  return { slot, physicalSlot: resolved.physicalSlot, ...document };
}

/**
 * What to tell a caller whose walk_document response was withheld for size.
 *
 * The generic oversize hint offers a limit, a cursor and node filters; this tool
 * takes `tlmId` and `slot` and nothing else, so a caller following that advice has
 * no move to make. A section-spined document has a real answer — read it a section
 * at a time — but the withheld payload took the section ids down with it, so the
 * remedy has to say how to get them back.
 */
export function documentOversizeRemedy(payload: Record<string, unknown>): string | undefined {
  const sections = payload.sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    return undefined;
  }

  const tlmId = String(payload.tlm ?? "");
  return (
    `This document is too large to read whole; it has ${sections.length} sections. ` +
    `Read it one section at a time: call walk_graph(fromId:'${tlmId}', direction:'out', edgeTypes:['hasPart'], nodeTypes:['DocumentSection']) ` +
    `for the section ids, then walk_document_section for each. ` +
    `Do NOT retry walk_document — it has no limit or cursor to narrow.`
  );
}

// ── Core: walk_document_section ───────────────────────────────────────────────
// Resolve one DocumentSection's full generation scope: the owning document, the
// curriculum this slot renders, the routine that applies (section → document →
// covered-curriculum, nearest-wins), and the formatters (the TLM's doc-wide stack
// plus the section's own). The per-section counterpart to walk_document — the unit
// generation produces a document from, section by section. Slot-aware (published
// default; role-gated draft) like the other walk_* readers. Exported so tests drive
// the real logic directly.
export async function walkDocumentSection(args: { sectionId: string; slot?: WalkSlot }): Promise<Record<string, unknown>> {
  const namespace = activeNamespace();
  const slot = args.slot ?? "published";

  const resolved = await resolveWalkModel(namespace, slot);
  if ("notice" in resolved) {
    return resolved.notice;
  }

  const section = documentSectionSubgraph(resolved.model, args.sectionId);
  if (!section) {
    return { error: `DocumentSection '${args.sectionId}' not found in the ${slot} graph. Call walk_document (its 'sections' spine) or walk_graph (nodeTypes ['DocumentSection']) to find section ids.` };
  }
  return { slot, physicalSlot: resolved.physicalSlot, ...section };
}

// ── Core: find_node ───────────────────────────────────────────────────────────
// Turn a name a person would type ("Chapitre 5") into node ids. The expert never
// pastes a UUID: client-side completion was measured and does not render, so the
// server does the resolution (self-serve-authoring.md, D9). Exported so tests
// drive the real logic.

// What one query resolved to, plus the guidance that goes with the outcome.
// Shared by the single-query and batched shapes so a batch entry says exactly
// what a lone call would.
type QueryResult = { matches: FoundNode[]; ambiguous?: true; note?: string };

const AMBIGUOUS_NOTE =
  "Several elements carry this name. Ask the user which one — each candidate's `path` says which document or course it sits in — rather than picking one.";
const NO_MATCH_NOTE =
  "Nothing carries this name. Try fewer words, or call namespace_stats to see the graph's roots.";

// Resolve ONE name against an already-loaded graph. Several equally-good matches
// is the NORMAL case here (both Courses of a subject hold a "Chapitre 5"), so the
// ambiguity is stated out loud rather than resolved by guessing.
function resolveOneQuery(graph: FindableGraph, query: string, args: { labels?: string[]; limit?: number }): QueryResult {
  const matches = findNodes(graph, { query, labels: args.labels, limit: args.limit });

  if (matches.length > 1) {
    return { matches, ambiguous: true, note: AMBIGUOUS_NOTE };
  }
  if (matches.length === 0) {
    return { matches, note: NO_MATCH_NOTE };
  }
  return { matches };
}

export type FindNodeArgs = {
  query?: string;
  /** Batch form: resolve many names against ONE graph load (WP2c). */
  queries?: string[];
  labels?: string[];
  limit?: number;
  slot?: WalkSlot;
};

export async function findActiveNodes(args: FindNodeArgs): Promise<Record<string, unknown>> {
  const namespace = activeNamespace();
  const slot = args.slot ?? "published";

  if (args.query === undefined && (args.queries === undefined || args.queries.length === 0)) {
    return { error: "find_node needs a `query` (one name) or `queries` (several names). Ask the user for the NAME — never for an id." };
  }

  const resolved = await resolveWalkModel(namespace, slot);
  if ("notice" in resolved) {
    return resolved.notice;
  }

  // Loading + flattening the model is the expensive half, so a batch pays it
  // once for every name. That is the whole point of `queries`: resolving 60
  // lesson names cost 60 round-trips and 60 graph loads.
  const graph = toFindable(resolved.model);
  const envelope = { slot, physicalSlot: resolved.physicalSlot };

  if (args.queries !== undefined && args.queries.length > 0) {
    // Keyed by the query the caller sent, so a caller matching results back to
    // its own list never depends on array order. Duplicates collapse onto one
    // key — the same name cannot resolve two ways in one graph.
    const results: Record<string, QueryResult> = {};
    for (const query of args.queries) {
      results[query] = resolveOneQuery(graph, query, args);
    }

    const unresolved = Object.entries(results)
      .filter(([, result]) => result.matches.length !== 1)
      .map(([query]) => query);

    return {
      ...envelope,
      results,
      count: Object.keys(results).length,
      // One place to look before acting on a batch: every name that did NOT
      // land on exactly one node still needs a person's answer.
      ...(unresolved.length > 0 ? { unresolved } : {}),
    };
  }

  return { ...envelope, query: args.query, ...resolveOneQuery(graph, args.query!, args) };
}

// ── Core: namespace_stats ─────────────────────────────────────────────────────
// Exported so tests drive the real logic directly (like buildCapabilitiesReport).
export async function namespaceStats(): Promise<Record<string, unknown>> {
  const adapter = getActiveAdapter();
  const namespace = kgNamespace(activeWorkspace(), adapter.grade, adapter.subject);
  const stats = computeGraphStats(adapter.model());
  const draft = await draftState(namespace);

  // "no draft open" is the one flag that needs live draft state; the rest are
  // the model-derived structural hints. Orientation only — never authoritative.
  const draftFlags = draft.open ? [] : ["no draft open"];
  const coverageFlags = [...draftFlags, ...stats.structuralFlags];

  // `roots` is capped for orientation (interesting kinds first); `rootsTotal` is
  // the true count, and a note fires when the tail was dropped so the caller knows
  // to walk_graph for the rest rather than assume `roots` is exhaustive.
  const rootsNote = stats.rootsTotal > stats.roots.length
    ? `Showing ${stats.roots.length} of ${stats.rootsTotal} roots (interesting kinds first). Walk the graph for the rest.`
    : undefined;

  // Say plainly that these are attached, not stranded. The old response counted
  // them as roots and called the tail "leaf nodes with no containment parent",
  // which reads as ~100 orphans to clean up — they are ci/maths' MOHEBS
  // illustrative Activities, reached by reverse lookup from the standard they
  // align to, and deleting them would silently strip lessons of their examples.
  const alignmentNote = stats.attachedByAlignment.count > 0
    ? `${stats.attachedByAlignment.count} node(s) are attached to a standard by their own hasEducationalAlignment/supports edge rather than being contained. They are NOT orphans and are excluded from \`roots\` — reach them by walking 'in' from the standard.`
    : undefined;

  return {
    namespace,
    physicalSlot: preloadedSlot(),
    nodeCounts: stats.nodeCounts,
    edgeCounts: stats.edgeCounts,
    roots: stats.roots,
    rootsTotal: stats.rootsTotal,
    ...(rootsNote ? { rootsNote } : {}),
    attachedByAlignment: stats.attachedByAlignment,
    ...(alignmentNote ? { alignmentNote } : {}),
    isolatedCount: stats.isolatedCount,
    draft,
    coverageFlags,
  };
}

// ── Core: export_graph_view ────────────────────────────────────────────────────
// Export a scoped, self-contained slice of the published graph (the containment
// subtree of `fromId`) in the explorer's DisplayGraph shape, so a caller can
// render it as an interactive visualization artifact. Read-only, published slot
// only; exportSubtree self-bounds the payload to stay under the response cap.
// Exported so tests drive the real logic directly (like walkActiveGraph).
export async function exportGraphView(args: { fromId: string; maxDepth?: number; detail?: boolean }): Promise<Record<string, unknown>> {
  const namespace = activeNamespace();
  const result = await exportSubtree(namespace, args.fromId, { maxDepth: args.maxDepth, detail: args.detail });
  if (result === null) {
    return { error: `No published graph for '${namespace}'. The namespace has never been seeded/published.` };
  }
  return result as unknown as Record<string, unknown>;
}

// Live draft state: whether a draft is open and, if so, how many nodes/edges it
// changes vs published (a cheap diff over two small slots, no traversal).
async function draftState(namespace: string): Promise<{ open: boolean; editsStaged?: number }> {
  const store = getKgStore();
  const pointer = await store.readPointer(namespace);
  if (!pointer || !pointer.draftSlot) {
    return { open: false };
  }

  const draftSlot = pointer.draftSlot;
  const publishedSlot = pointer.publishedSlot;
  const [draftNodes, draftEdges, publishedNodes, publishedEdges] = await Promise.all([
    store.listNodes(namespace, draftSlot),
    store.listEdges(namespace, draftSlot),
    store.listNodes(namespace, publishedSlot),
    store.listEdges(namespace, publishedSlot),
  ]);

  const diff = diffGraphs(
    { nodes: publishedNodes, edges: publishedEdges },
    { nodes: draftNodes, edges: draftEdges },
  );
  return { open: true, editsStaged: countDiff(diff) };
}

const countDiff = (diff: GraphDiff): number => {
  const nodeChanges = diff.nodes.added.length + diff.nodes.removed.length + diff.nodes.changed.length;
  const edgeChanges = diff.edges.added.length + diff.edges.removed.length + diff.edges.changed.length;
  return nodeChanges + edgeChanges;
};

export function registerGraphTools(server: McpServer) {
  server.registerTool(
    "walk_graph",
    {
      title: "Walk the graph from a node",
      description:
        "The single generic read for every 'list / find / enumerate / traverse' need: a paginated BFS over the active subject's graph. Keep the defaults (limit:50, includeEdges:false) and narrow `nodeTypes` on top of them; page via `cursor` until nextCursor is null. Do NOT raise `limit` to fit a big result — the most common misuse, and it overflows the client. `direction:'both'` with no `nodeTypes` reaches the whole graph; narrow first. " +
        "`direction`: 'out' follows edges from→to (a Course down to its parts), 'in' follows to→from (a standard up to its framework root), 'both' either. `edgeTypes` filters which edges to FOLLOW (empty ⇒ all); `nodeTypes` which nodes to RETURN — non-matching nodes are still traversed through, so filters compose. `maxDepth` default 3, max 10. `includeEdges` (default false) adds the traversed edges when you need the wiring; they dominate a page's size. `limit` max 500. `slot`: 'published' (default) or 'draft' (UNPUBLISHED staged edits — curators/approvers only). Read-only. " +
        "Three independent flags say why a page stopped: `truncatedByLimit` (more nodes on further pages — call again with the cursor), `truncated` (the maxDepth cap hid deeper nodes — raise it), `truncatedBySize` (a BYTE budget trimmed the page below `limit` — raising limit will NOT help; set includeEdges:false, narrow nodeTypes, and page). `physicalSlot` names the slot ('a'/'b') the data came from, so you can confirm reads and writes agree after a publish. " +
        "Examples: framework root → (fromId=<any standard>, direction='in', edgeTypes=['hasChild'], nodeTypes=['StandardsFramework']); the SFI spine → (fromId=<root>, direction='out', edgeTypes=['hasChild'], nodeTypes=['StandardsFrameworkItem']) paged to the end; a course subtree → (fromId=<courseId>, direction='out', edgeTypes=['hasPart','hasChild']).",
      inputSchema: {
        fromId: z.string(),
        direction: z.enum(["out", "in", "both"]),
        edgeTypes: z.array(z.string()).optional(),
        nodeTypes: z.array(z.string()).optional(),
        maxDepth: z.number().int().optional(),
        includeEdges: z.boolean().optional(),
        limit: z.number().int().optional(),
        cursor: z.string().optional(),
        slot: z.enum(["published", "draft"]).optional(),
      },
    },
    guarded(async (a: WalkToolArgs) => asJson(await walkActiveGraph(a))),
  );

  server.registerTool(
    "walk_document",
    {
      title: "Resolve a document's generation scope",
      description:
        "The document-side counterpart to walk_graph: walk_graph reads the curriculum to TEACH, this reads the document to PRODUCE. Pass a TeachingLearningMaterial (TLM) id — a document root, from namespace_stats `roots`. Returns `assemblyGuide` (the document's authored 'how to build me' markdown, or null); `scope` — how the curriculum resolved: 'sections' (a DocumentSection spine), 'course' (the TLM→covers→Course fallback) or 'none'; `sections` (the spine in reading order, each naming the `parent` it hangs under — sections nest — and its `covers` targets, an EMPTY covers marking front matter or a pure grouping section); `document` (the TLM subtree: its Formatter/FormatterSpec stack and DocumentSections, with the covers edges); and `curriculum` (what it renders — pure hasPart/hasChild containment, NOT usesRoutine: formatting reaches generation through the TLM, not the curriculum). " +
        "SELF-BOUNDED: a whole-Course document's curriculum is the whole graph, so when it would overflow, `curriculum` returns `{ tooLarge, counts, message }` while the guide, scope, spine and document subtree still ride. Do NOT retry — follow the message: with a section spine, call walk_document_section per `sections` id; otherwise page with walk_graph. Read-only. `slot`: 'published' (default) or 'draft' (UNPUBLISHED staged edits — curators/approvers only).",
      inputSchema: {
        tlmId: z.string(),
        slot: z.enum(["published", "draft"]).optional(),
      },
    },
    guarded(async (a: { tlmId: string; slot?: WalkSlot }) => {
      const payload = await walkDocument(a);
      return asJson(payload, documentOversizeRemedy(payload));
    }),
  );

  server.registerTool(
    "walk_document_section",
    {
      title: "Resolve one document section's generation scope",
      description:
        "The PER-PIECE generation entry: everything needed to produce ONE slot of a document, which is the unit a `.docx` is produced from section by section. Section ids come from walk_document's `sections` spine, or walk_graph (nodeTypes ['DocumentSection']). A DocumentSection already IS the document↔curriculum binding — it hangs under exactly one document and `covers` its curriculum — so its document, routine and formatters are unambiguous, never reverse-searched. " +
        "Returns `section` (its position + any per-section assemblyGuide); `document` (the owning TLM: id, assemblyGuide, audience/mediumType — null if not under one yet); `covers` (the curriculum id(s) it renders; EMPTY marks front matter); `curriculum` (the covered subtree, pure hasPart/hasChild); `routine` (the one that APPLIES, nearest-wins document-first — the section's own usesRoutine, else its parent sections' nearest-first, else the TLM's, else up the covered curriculum's ancestry — with `resolvedFrom` and `resolvedFromScope`; null when nothing in the chain uses one); and `formatters` (every stack on this section's own path — its own, its parent sections', the TLM's doc-wide one; sibling sections' stacks excluded). Read-only. `slot`: 'published' (default) or 'draft' (curators/approvers only).",
      inputSchema: {
        sectionId: z.string(),
        slot: z.enum(["published", "draft"]).optional(),
      },
    },
    guarded(async (a: { sectionId: string; slot?: WalkSlot }) => asJson(await walkDocumentSection(a))),
  );

  server.registerTool(
    "find_node",
    {
      title: "Find a node by name",
      description:
        "Turn a NAME into node ids — the way to get an id when the user says « chapter 5 » or « le guide de l'enseignant ». NEVER ask the user for a node id or a UUID: ask for the name, in their own language, and resolve it here. Matching ignores case and accents, so « chapitre 5 les nombres jusqu'a 20 » finds « Chapitre 5 : Les nombres jusqu'à 20 ». " +
        "`query` is what the user typed; `labels` narrows to LC labels (e.g. ['LessonGrouping'] for a chapter/week, ['Course'], ['TeachingLearningMaterial'] for a document, ['Lesson']); `limit` caps the list (default 10). Each match carries `id`, `title`, `labels`, `path` (its containment ancestors — what tells two « Chapitre 5 » apart) and `match` (exact | prefix | contains | words). " +
        "`queries` (an array) resolves MANY names in ONE call against a single graph load — use it whenever you have a list (60 lesson names is 1 call, not 60). It returns `results` keyed by each query string, every entry carrying the same `matches`/`ambiguous` fields a single call would, plus `unresolved`: the names that did NOT land on exactly one node and so still need the user's answer. Pass `query` OR `queries`. " +
        "When several match, the response sets `ambiguous`: ASK the user which one, quoting the `path`, and do not guess — picking wrong silently writes against another document. `slot`: 'published' (default) or 'draft' (unpublished staged edits — curators/approvers only), so a chapter you just created is findable before publishing. Read-only.",
      inputSchema: {
        query: z.string().optional(),
        queries: z.array(z.string()).optional(),
        labels: z.array(z.string()).optional(),
        limit: z.number().int().optional(),
        slot: z.enum(["published", "draft"]).optional(),
      },
    },
    guarded(async (a: FindNodeArgs) => asJson(await findActiveNodes(a))),
  );

  server.registerTool(
    "namespace_stats",
    {
      title: "Namespace orientation snapshot",
      description:
        "A cheap, argument-free snapshot of the active workspace/grade/subject: `nodeCounts` (per LC label), `edgeCounts` (per edge type), `roots` (genuinely unplaced nodes — Course/StandardsFramework/stranded groupings, each with id + labels + description; a node that aligns itself to a standard, or that a lesson attaches by usesRoutine, is NOT a root and is summarised under `attachedByAlignment` instead), `isolatedCount` (nodes NO edge touches in any direction — unlike a root, this is unambiguously wrong and is the number to act on), `draft` (whether one is open and how many edits it stages), and `coverageFlags` (high-level orientation hints). Run this FIRST, before writing any walk_graph query, to see the shape of the graph — and this is where you find the subject's Course content roots (id + name) to walk from (it replaced list_courses; filter `roots` by labels including 'Course'). Also carries `physicalSlot` — the slot ('a'/'b') these counts were read from. Read-only; no audit event.",
      inputSchema: {},
    },
    guarded(async () => asJson(await namespaceStats())),
  );

  server.registerTool(
    "export_graph_view",
    {
      title: "Export a scoped graph slice for a visualization artifact",
      description:
        "A SELF-CONTAINED slice of the published graph — the containment subtree rooted at `fromId` — in the explorer's DisplayGraph shape (`nodes`, `edges`, `meta.taxonomy`, `meta.viewConfig`, `meta.counts`). Feed the JSON into a self-contained HTML artifact to render the same interactive tree the live KG explorer shows. " +
        "Scope it to ONE thing: take a root id from namespace_stats or walk_graph, then export its subtree. `maxDepth` default 4, max 12. `detail` (default false) adds each node's full raw LC property bag — turn it on only for a small subtree. Self-bounded to the response cap: an oversized detailed slice auto-drops `detail`, and a still-too-big slice returns `{ tooLarge, counts, message }` telling you to lower maxDepth or pick a deeper root. Read-only, published slot only. This returns DATA; render the visual from it.",
      inputSchema: {
        fromId: z.string(),
        maxDepth: z.number().int().optional(),
        detail: z.boolean().optional(),
      },
    },
    guarded(async (a: { fromId: string; maxDepth?: number; detail?: boolean }) => asJson(await exportGraphView(a))),
  );
}
