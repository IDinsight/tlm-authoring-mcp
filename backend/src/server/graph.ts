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
import { withContextOverride, contextField, type WithContext } from "./context-override.js";
import { SECTION_PARTS, type SectionPart } from "../curriculum/index.js";
import { freshnessFor } from "./freshness.js";
import { getActiveAdapter } from "../adapters/index.js";
import { activeWorkspace, sessionState } from "../context/index.js";
import { getKgStore, kgNamespace, toAuditActor, diffGraphs, type GraphDiff, nextAuditSeq } from "../kg-store/index.js";
import { exportSubtree } from "../kg-export/index.js";
import { walkGraph, computeGraphStats, documentSubgraph, documentSectionSubgraph, findNodes, toFindable, PRELOADED_SLOT_KEY, type WalkDirection, type WalkDetail, type FindableGraph, type FoundNode } from "../curriculum/index.js";
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
export type WalkToolArgs = WithContext & {
  fromId: string;
  direction: WalkDirection;
  edgeTypes?: string[];
  nodeTypes?: string[];
  maxDepth?: number;
  includeEdges?: boolean;
  detail?: WalkDetail;
  limit?: number;
  cursor?: string;
  slot?: WalkSlot;
};

// The arguments walk_document_section accepts. `cursor` pages the FORMATTER STACK
// (the only part that can outgrow a response here), `detail` trims the context,
// and `include` drops the document-level parts a caller already holds.
export type SectionToolArgs = WithContext & {
  sectionId: string;
  detail?: WalkDetail;
  cursor?: string;
  slot?: WalkSlot;
  include?: SectionPart[];
  freshness?: boolean;
};

// The arguments walk_document accepts. `limit`/`cursor` page the SECTION SPINE —
// the only unbounded-length part of a document payload once the subtree and the
// curriculum can self-bound.
export type DocumentToolArgs = WithContext & {
  tlmId: string;
  limit?: number;
  cursor?: string;
  slot?: WalkSlot;
  freshness?: boolean;
};

// ── Core: walk_graph ──────────────────────────────────────────────────────────
// Resolve the slot (published, or a role-gated draft), then run the generic BFS.
// Exported so tests drive the real logic directly (like buildCapabilitiesReport).
export async function walkActiveGraph(args: WalkToolArgs): Promise<Record<string, unknown>> {
  return withContextOverride(args.context, () => walkResolved(args)) as Promise<Record<string, unknown>>;
}

async function walkResolved(args: WalkToolArgs): Promise<Record<string, unknown>> {
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
    detail: args.detail,
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
export async function walkDocument(args: DocumentToolArgs): Promise<Record<string, unknown>> {
  return withContextOverride(args.context, () => documentResolved(args)) as Promise<Record<string, unknown>>;
}

async function documentResolved(args: DocumentToolArgs): Promise<Record<string, unknown>> {
  const namespace = activeNamespace();
  const slot = args.slot ?? "published";

  const resolved = await resolveWalkModel(namespace, slot);
  if ("notice" in resolved) {
    return resolved.notice;
  }

  const document = documentSubgraph(resolved.model, args.tlmId, { limit: args.limit, cursor: args.cursor });
  if (!document) {
    return { error: `TeachingLearningMaterial '${args.tlmId}' not found in the ${slot} graph. Call namespace_stats (its roots, filtered by labels including 'TeachingLearningMaterial') for available document ids.` };
  }
  if ("error" in document) {
    return document;
  }

  /*
   * At the document level the question is narrower, on purpose: the state of the
   * files already produced FOR THIS DOCUMENT.
   *
   * Not a fan-out over its sections' covers. The spine here is one PAGE, so a
   * fan-out would report a different set depending on where the caller was in
   * the pagination — a freshness field that changes meaning per page is worse
   * than none. The per-section read is where the production question is asked,
   * and it asks it for exactly the section in hand.
   */
  const freshness = args.freshness === false
    ? undefined
    : await freshnessFor(namespace, resolved.model, [document.tlm]);

  return { slot, physicalSlot: resolved.physicalSlot, ...document, ...(freshness ? { sourceFreshness: freshness } : {}) };
}

/**
 * What to tell a caller whose walk_document response was withheld for size.
 *
 * A LAST-RESORT backstop. documentSubgraph self-bounds — it sheds the curriculum,
 * then the TLM subtree, then trims the section spine to a cursor — so a payload
 * reaching this point means the envelope alone overflowed (a single enormous
 * assemblyGuide, say), which no paging of the spine can fix. The generic oversize
 * hint would offer node filters this tool does not have, so name the moves it does:
 * shrink the page with `limit`, or skip the whole-document read.
 */
export function documentOversizeRemedy(payload: Record<string, unknown>): string | undefined {
  const sections = payload.sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    return undefined;
  }

  const tlmId = String(payload.tlm ?? "");
  const total = payload.sectionsTotal ?? sections.length;
  return (
    `This document overflowed even after self-bounding; it has ${total} sections. ` +
    `Retry with a small \`limit\` (e.g. limit:20) and page with \`cursor\` to walk the spine, ` +
    `or skip it: walk_graph(fromId:'${tlmId}', direction:'out', edgeTypes:['hasPart'], nodeTypes:['DocumentSection'], detail:'skeleton') ` +
    `gives the section ids, then walk_document_section reads each one.`
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
export async function walkDocumentSection(args: SectionToolArgs): Promise<Record<string, unknown>> {
  return withContextOverride(args.context, () => sectionResolved(args)) as Promise<Record<string, unknown>>;
}

async function sectionResolved(args: SectionToolArgs): Promise<Record<string, unknown>> {
  const namespace = activeNamespace();
  const slot = args.slot ?? "published";

  const resolved = await resolveWalkModel(namespace, slot);
  if ("notice" in resolved) {
    return resolved.notice;
  }

  const section = documentSectionSubgraph(resolved.model, args.sectionId, { detail: args.detail, cursor: args.cursor, include: args.include });
  if (!section) {
    return { error: `DocumentSection '${args.sectionId}' not found in the ${slot} graph. Call walk_document (its 'sections' spine) or walk_graph (nodeTypes ['DocumentSection']) to find section ids.` };
  }
  if ("error" in section) {
    return section;
  }

  /*
   * Whether the documents already covering this section's curriculum are still
   * current. This is the production read, so it is where the question has to be
   * answered: a CE1 Guide was once composed against a pupil render five days
   * behind the lesson, and the machinery to notice had existed the whole time
   * as a separate call nobody was prompted to make (see server/freshness.ts).
   * Opt out with freshness:false when composing something new from scratch.
   */
  // Only the FIRST page asks the freshness question — a continuation page covers the
  // same curriculum, so the answer would repeat, and it is bytes on the very page we
  // page in order to keep thin.
  const freshness = args.freshness === false || args.cursor
    ? undefined
    : await freshnessFor(namespace, resolved.model, section.covers);

  return { slot, physicalSlot: resolved.physicalSlot, ...section, ...(freshness ? { sourceFreshness: freshness } : {}) };
}

/**
 * What to tell a caller whose walk_document_section FIRST page was withheld for size.
 *
 * A first page carries the section's own context — its guide, the document, the
 * routine, the covered curriculum. That is a fixed pile, and on a handful of the
 * fattest sections it alone exceeds the response cap, so no paging of the formatter
 * stack (which pages fine) can rescue it. The generic hint offers node filters this
 * tool does not take; name the two levers that DO shrink the context.
 */
export function sectionOversizeRemedy(sectionId: string): string {
  return (
    `Section '${sectionId}' carries more context than the response cap allows even after self-bounding — its own guide, ` +
    `the document, the routine and the covered curriculum. Retry with detail:'skeleton' to trim the covered curriculum and ` +
    `the owning document's node, or — if you already read another section of this document in full — include:[] ` +
    `(add 'curriculum' when this section covers something you have not read yet) to drop the parts you already hold. ` +
    `The formatter stack itself still pages with cursor.`
  );
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

export type FindNodeArgs = WithContext & {
  query?: string;
  /** Batch form: resolve many names against ONE graph load (WP2c). */
  queries?: string[];
  labels?: string[];
  limit?: number;
  slot?: WalkSlot;
};

export async function findActiveNodes(args: FindNodeArgs): Promise<Record<string, unknown>> {
  return withContextOverride(args.context, () => findResolved(args)) as Promise<Record<string, unknown>>;
}

async function findResolved(args: FindNodeArgs): Promise<Record<string, unknown>> {
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
export async function namespaceStats(args: WithContext = {}): Promise<Record<string, unknown>> {
  return withContextOverride(args.context, () => statsResolved()) as Promise<Record<string, unknown>>;
}

async function statsResolved(): Promise<Record<string, unknown>> {
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
        "`direction`: 'out' follows edges from→to (a Course down to its parts), 'in' follows to→from (a standard up to its framework root), 'both' either. `edgeTypes` filters which edges to FOLLOW (empty ⇒ all); `nodeTypes` which nodes to RETURN — non-matching nodes are still traversed through, so filters compose. `maxDepth` default 3, max 10. `includeEdges` (default false) adds the traversed edges when you need the wiring; they dominate a page's size. `limit` max 500. `detail`: 'full' (default) returns each node's whole property bag; **'skeleton' returns identity, ordinal and kind only** (id, labels, description, position, and the LC kind fields normalizedType/normalizedStatementType/statementType/groupName/educationalUse), dropping every authored-prose field. USE 'skeleton' FOR ANY STRUCTURAL QUESTION — what is here, in what order, how many, which id is which. Authored prose is where the bytes are: a ci/maths DocumentSection carries several KB of assemblyGuide, so a full page returns ~4 of them where a skeleton page returns ~180. Read the handful of nodes you actually need in full detail afterwards, or via walk_document_section, which always returns full content. `slot`: 'published' (default) or 'draft' (UNPUBLISHED staged edits — curators/approvers only). Read-only. " +
        "`context` (optional {workspace, grade, subject}) reads against THAT namespace for this one call, leaving the session's active context untouched — the active context belongs to the CONNECTION, not to you, so anything sharing the connection (a subagent, a parallel call) can move it under you. Pass `context` whenever you fan out or cannot be sure you are alone; omit it to use the active context. " +
        "Three independent flags say why a page stopped: `truncatedByLimit` (more nodes on further pages — call again with the cursor), `truncated` (the maxDepth cap hid deeper nodes — raise it), `truncatedBySize` (a BYTE budget trimmed the page below `limit` — raising limit will NOT help; switch to detail:'skeleton', set includeEdges:false, narrow nodeTypes, and page). `physicalSlot` names the slot ('a'/'b') the data came from, so you can confirm reads and writes agree after a publish. " +
        "Examples: framework root → (fromId=<any standard>, direction='in', edgeTypes=['hasChild'], nodeTypes=['StandardsFramework']); the SFI spine → (fromId=<root>, direction='out', edgeTypes=['hasChild'], nodeTypes=['StandardsFrameworkItem']) paged to the end; a course subtree → (fromId=<courseId>, direction='out', edgeTypes=['hasPart','hasChild']).",
      inputSchema: {
        fromId: z.string(),
        direction: z.enum(["out", "in", "both"]),
        edgeTypes: z.array(z.string()).optional(),
        nodeTypes: z.array(z.string()).optional(),
        maxDepth: z.number().int().optional(),
        includeEdges: z.boolean().optional(),
        detail: z.enum(["skeleton", "full"]).optional(),
        limit: z.number().int().optional(),
        cursor: z.string().optional(),
        slot: z.enum(["published", "draft"]).optional(),
        ...contextField,
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
        "SELF-BOUNDED, so it answers rather than refusing. Parts are shed in order of how reachable they are elsewhere, each replaced by `{ tooLarge, counts, message }`: first `curriculum` (a whole-Course document's is the whole graph), then `document` (on live ci/maths its 579 DocumentSections are 2.3 MB — every one of them, plus the doc-wide formatter stack, comes back from walk_document_section, so this is a redirect and not a loss). `sections` is the part nothing else provides, so it is never dropped — only PAGED: `sectionsTotal` is the document's real count, and when a page is trimmed you get `sectionsTruncated`, a `nextCursor` to pass back as `cursor`, and a `spineNote`. `limit` caps the page yourself. The assemblyGuide and `scope` ride on every page. Do NOT retry a shed part — follow its message: call walk_document_section per `sections` id. Read-only. `slot`: 'published' (default) or 'draft' (UNPUBLISHED staged edits — curators/approvers only). " +
        "`context` (optional {workspace, grade, subject}) reads against THAT namespace for this one call, leaving the session's active context untouched — the active context belongs to the CONNECTION, not to you, so anything sharing the connection (a subagent, a parallel call) can move it under you. Pass `context` whenever you fan out or cannot be sure you are alone; omit it to use the active context.",
      inputSchema: {
        tlmId: z.string(),
        limit: z.number().int().optional(),
        cursor: z.string().optional(),
        slot: z.enum(["published", "draft"]).optional(),
        freshness: z
          .boolean()
          .optional()
          .describe(
            "Report whether the documents already produced here are out of date (default true). `sourceFreshness` gives counts plus a row per document needing attention: `stale` means it quotes curriculum that has CHANGED since (compared against the anchors the renderer wrote into the file, so this is a content comparison, not a timestamp), `unknown` means it records no sources — and for those, `olderThanGraph` + `lastGraphEdit` say whether the graph moved after the file was written. Composing against a document that is behind the graph reproduces decisions that have been superseded, and nothing in its own text says so. Pass false when composing something new and the existing files are irrelevant."
          ),
        ...contextField,
      },
    },
    guarded(async (a: DocumentToolArgs) => {
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
        "Returns `section` (its position + any per-section assemblyGuide); `pictures` (the images attached to the covered curriculum with attach_image — each with the `name` a page places it by, its `id` for a render `media` entry {name, nodeId}, and `description`, what it shows); `document` (the owning TLM: id, assemblyGuide, audience/mediumType — null if not under one yet; a `metadata.journal`, the dated decision history a document keeps for its rules and a section for its own page, is never part of a generation read — read it on the node with walk_graph when someone asks WHY a rule is so); `covers` (the curriculum id(s) it renders; EMPTY marks front matter); `curriculum` (the covered subtree, pure hasPart/hasChild); `routine` (the one that APPLIES, nearest-wins document-first — the section's own usesRoutine, else its parent sections' nearest-first, else the TLM's, else up the covered curriculum's ancestry — with `resolvedFrom` and `resolvedFromScope`; null when nothing in the chain uses one); and `formatters` (every stack on this section's own path — its own, its parent sections', the TLM's doc-wide one; sibling sections' stacks excluded), with `formatterStackOrder` giving their PRECEDENCE as ids: merge their `render` bags in that order, so nearest wins. Look each id up in `formatters.nodes`. " +
        "SELF-BOUNDS THE FORMATTER STACK, which is the only part that can page: when it does not fit one response you get `formattersTruncated` + `nextCursor` + `stackNote`, and a CONTINUATION page (one fetched with `cursor`) carries ONLY the remaining formatters — the section guide, document, routine and covered curriculum came on the first page, and re-sending them is what once stopped the loop converging — so it arrives thin and `continued:true`, with `omitted` naming the shed parts. Merge the `render` bags in the order received ACROSS pages and nearest still wins. The FIRST page's own context is not paged, so on a few of the fattest sections it alone exceeds the cap and the read is refused with a remedy: pass `detail:'skeleton'` (trims the covered curriculum and the owning TLM's node, never the section's node or the stack) and/or `include` to drop parts you already hold. Read-only. `slot`: 'published' (default) or 'draft' (curators/approvers only). " +
        "`context` (optional {workspace, grade, subject}) reads against THAT namespace for this one call, leaving the session's active context untouched — the active context belongs to the CONNECTION, not to you, so anything sharing the connection (a subagent, a parallel call) can move it under you. Pass `context` whenever you fan out or cannot be sure you are alone; omit it to use the active context.",
      inputSchema: {
        sectionId: z.string(),
        detail: z.enum(["skeleton", "full"]).optional(),
        cursor: z.string().optional(),
        slot: z.enum(["published", "draft"]).optional(),
        freshness: z
          .boolean()
          .optional()
          .describe(
            "Report whether the documents already produced here are out of date (default true). `sourceFreshness` gives counts plus a row per document needing attention: `stale` means it quotes curriculum that has CHANGED since (compared against the anchors the renderer wrote into the file, so this is a content comparison, not a timestamp), `unknown` means it records no sources — and for those, `olderThanGraph` + `lastGraphEdit` say whether the graph moved after the file was written. Composing against a document that is behind the graph reproduces decisions that have been superseded, and nothing in its own text says so. Pass false when composing something new and the existing files are irrelevant."
          ),
        include: z
          .array(z.enum(SECTION_PARTS))
          .optional()
          .describe(
            "Which parts to return. Omit for all of them. The document's assembly guide, its formatter stack, the routine and the covered curriculum are the SAME for every section of a document, so producing one section at a time re-receives them per section — on live ci/maths about 100 KB of shared context around 6 KB of section text, ten times per lesson. Read the FIRST section of a document in full (follow nextCursor until the formatter stack is complete), then pass include:[] for every further section, adding 'curriculum' only when that section covers something you have not read yet. walk_document is NOT a substitute for that first read: on a large document it sheds the TLM subtree, formatters included. What always comes back: the section's own node, its `covers` ids, and `formatterStackOrder` — the stack's precedence, which you need to merge `render` bags you already hold. `omitted` lists what you left out, so a missing `routine` is never mistaken for a section that has none.",
          ),
        ...contextField,
      },
    },
    guarded(async (a: SectionToolArgs) => asJson(await walkDocumentSection(a), sectionOversizeRemedy(a.sectionId))),
  );

  server.registerTool(
    "find_node",
    {
      title: "Find a node by name",
      description:
        "Turn a NAME into node ids — the way to get an id when the user says « chapter 5 » or « le guide de l'enseignant ». NEVER ask the user for a node id or a UUID: ask for the name, in their own language, and resolve it here. Matching ignores case and accents, so « chapitre 5 les nombres jusqu'a 20 » finds « Chapitre 5 : Les nombres jusqu'à 20 ». " +
        "`query` is what the user typed; `labels` narrows to LC labels (e.g. ['LessonGrouping'] for a chapter/week, ['Course'], ['TeachingLearningMaterial'] for a document, ['Lesson']); `limit` caps the list (default 10). Each match carries `id`, `title`, `labels`, `path` (its containment ancestors — what tells two « Chapitre 5 » apart) and `match` (exact | prefix | contains | words). " +
        "`queries` (an array) resolves MANY names in ONE call against a single graph load — use it whenever you have a list (60 lesson names is 1 call, not 60). It returns `results` keyed by each query string, every entry carrying the same `matches`/`ambiguous` fields a single call would, plus `unresolved`: the names that did NOT land on exactly one node and so still need the user's answer. Pass `query` OR `queries`. " +
        "When several match, the response sets `ambiguous`: ASK the user which one, quoting the `path`, and do not guess — picking wrong silently writes against another document. `slot`: 'published' (default) or 'draft' (unpublished staged edits — curators/approvers only), so a chapter you just created is findable before publishing. Read-only. " +
        "`context` (optional {workspace, grade, subject}) reads against THAT namespace for this one call, leaving the session's active context untouched — the active context belongs to the CONNECTION, not to you, so anything sharing the connection (a subagent, a parallel call) can move it under you. Pass `context` whenever you fan out or cannot be sure you are alone; omit it to use the active context.",
      inputSchema: {
        query: z.string().optional(),
        queries: z.array(z.string()).optional(),
        labels: z.array(z.string()).optional(),
        limit: z.number().int().optional(),
        slot: z.enum(["published", "draft"]).optional(),
        ...contextField,
      },
    },
    guarded(async (a: FindNodeArgs) => asJson(await findActiveNodes(a))),
  );

  server.registerTool(
    "namespace_stats",
    {
      title: "Namespace orientation snapshot",
      description:
        "A cheap, argument-free snapshot of the active workspace/grade/subject: `nodeCounts` (per LC label), `edgeCounts` (per edge type), `roots` (genuinely unplaced nodes — Course/StandardsFramework/stranded groupings, each with id + labels + description; a node that aligns itself to a standard, or that a lesson attaches by usesRoutine, is NOT a root and is summarised under `attachedByAlignment` instead), `isolatedCount` (nodes NO edge touches in any direction — unlike a root, this is unambiguously wrong and is the number to act on), `draft` (whether one is open and how many edits it stages), and `coverageFlags` (high-level orientation hints). Run this FIRST, before writing any walk_graph query, to see the shape of the graph — and this is where you find the subject's Course content roots (id + name) to walk from (it replaced list_courses; filter `roots` by labels including 'Course'). Also carries `physicalSlot` — the slot ('a'/'b') these counts were read from. Read-only; no audit event. " +
        "`context` (optional {workspace, grade, subject}) reads against THAT namespace for this one call, leaving the session's active context untouched — the active context belongs to the CONNECTION, not to you, so anything sharing the connection (a subagent, a parallel call) can move it under you. Pass `context` whenever you fan out or cannot be sure you are alone; omit it to use the active context.",
      inputSchema: {
        ...contextField,
      },
    },
    guarded(async (a: WithContext) => asJson(await namespaceStats(a))),
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
