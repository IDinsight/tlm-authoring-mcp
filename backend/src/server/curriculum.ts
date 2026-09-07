/*
 * Module: server · tool group: curriculum (local sources)
 *
 * Read-only access to the active subject's curriculum graph and terminology.
 *
 * `get_standards` is a thin generic graph reader: it surfaces raw Learning-Commons
 * nodes (labels + properties) and their edges, and does NO projection — no
 * chapter/week/lesson vocabulary, no cooked slice. The caller (the LLM) reads the
 * nodes and assembles materials itself; keeping the logic out of the tool is the
 * point (see docs/design-notes/logic-in-the-graph.md). To find a subject's Course
 * content roots, use namespace_stats (its `roots`); to read a course's SUBTREE,
 * use walk_graph (server/graph.ts) — the generic traversal that replaced get_course.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { asJson, guarded } from "./shared.js";
import { withContextOverride, type WithContext } from "./context-override.js";
import { getActiveAdapter } from "../adapters/index.js";
import { standardsFor } from "../curriculum/index.js";
import { effectiveTerms, filterByQuery } from "./glossary-read.js";

/**
 * One or many nodes' standards neighbourhoods, against ONE graph load.
 *
 * The batch exists for the same reason find_node's `queries` does: a caller
 * assembling a week of teaching material asked for 22 sessions' objectives one
 * id at a time, and every call re-read and re-parsed the whole graph. Keyed by
 * the id sent, so the caller can join without positional bookkeeping.
 *
 * Exported so tests drive the real logic rather than a copy of it.
 */
export function readStandards(args: { nodeId?: string; nodeIds?: string[] }): Record<string, unknown> {
  const model = getActiveAdapter().model();

  if (args.nodeIds !== undefined) {
    const results: Record<string, unknown> = {};
    const notFound: string[] = [];
    // Deduplicated: the same lesson named twice is one lookup and one entry.
    for (const nodeId of [...new Set(args.nodeIds)]) {
      const standards = standardsFor(model, nodeId);
      if (standards) results[nodeId] = standards;
      else notFound.push(nodeId);
    }
    return { count: Object.keys(results).length, results, ...(notFound.length > 0 ? { notFound } : {}) };
  }

  if (args.nodeId === undefined) {
    return { error: "get_standards needs `nodeId` (one node) or `nodeIds` (an array). Node ids come from walk_graph or find_node." };
  }

  const standards = standardsFor(model, args.nodeId);
  return standards ?? { error: `Node '${args.nodeId}' not found in the graph.` };
}

// The per-call context override, offered on every read here — see
// server/context-override.ts for why a caller needs to be able to be stateless.
const CONTEXT_SCHEMA = z.object({ workspace: z.string(), grade: z.string(), subject: z.string() }).optional();

export function registerCurriculumTools(server: McpServer) {
  server.registerTool("get_standards", { title: "Get the standards a node teaches", description: "Given a content node id (e.g. a Lesson found via walk_graph), return the standards-spine neighborhood it teaches: the StandardsFrameworkItem(s) it aligns to via hasEducationalAlignment — carrying the objective (OS) text — plus each SFI's LearningComponents, the illustrative Activities aligning to it, and its parent SFI for context, as raw nodes + edges. A plain walk_graph over hasPart/hasChild does NOT include this (alignment fans out across most of the graph), so this is the per-node bridge from the content tree to the spine. `nodes` is empty if the node aligns to nothing (a placeholder not yet wired to the spine). " +
    "`nodeIds` (an array) resolves MANY nodes in ONE call against a single graph load — use it whenever you have a list, the way find_node's `queries` does: a week's 22 sessions is 1 call, not 22. It returns `results` keyed by node id, each entry the same { nodes, edges } a lone call gives, plus `notFound` for any id that is not in the graph. Pass `nodeId` OR `nodeIds`. " +
    "`context` (optional {workspace, grade, subject}) reads against THAT namespace for this one call, leaving the session's active context untouched — the active context belongs to the CONNECTION, not to you, so anything sharing the connection (a subagent, a parallel call) can move it under you. Pass `context` whenever you fan out or cannot be sure you are alone; omit it to use the active context.", inputSchema: { nodeId: z.string().optional(), nodeIds: z.array(z.string()).optional(), context: CONTEXT_SCHEMA } },
    guarded(async (a: { nodeId?: string; nodeIds?: string[] } & WithContext) =>
      asJson(await withContextOverride(a.context, async () => readStandards(a)))));

  server.registerTool("get_terminology", { title: "Get terminology (FR/Wolof)", description: "Search the workspace's French/Wolof lexicon for a term's established wording (from the store-backed glossary, or the on-disk MOHEBS terminology when a workspace has no glossary yet). Each result carries `francais`/`wolof` plus the full `renderings` map. Returns [] if nothing matches — then say the wording is missing rather than invent it.", inputSchema: { query: z.string(), limit: z.number().int().optional() } },
    guarded(async (a: { query: string; limit?: number }) => asJson({ query: a.query, results: filterByQuery(await effectiveTerms(), a.query, a.limit ?? 20) })));
}
