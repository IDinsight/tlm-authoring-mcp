/*
 * Module: server · tool group: the generic node verbs (edit_nodes, move_node)
 *
 * Two verbs over nodes that already exist — one for their FIELDS, one for a
 * node's PLACE. edit_nodes changes content, position and/or display title on ONE
 * node or MANY in a single atomic draft edit (it replaced the single-node
 * edit_node, which had itself consolidated set_content + reposition and added
 * title editing). move_node re-parents a node along ONE containment axis. Node
 * CREATION is add_nodes (server/authoring.ts).
 *
 * Why move_node is a verb and not two primitives: re-parenting by hand is
 * delete_edges (every current parent edge on that axis) + create_edges (the new
 * one) + edit_nodes (the ordinal) — three separate two-phase writes, so a caller
 * who stops after the first leaves the node detached, and one who forgets the
 * third leaves its `position` field disagreeing with its slot. Doing it wrong
 * also means touching the WRONG AXIS: a CI-maths lesson hangs off both a chapter
 * (hasPart) and a week (hasChild), and only one of those should move. That is the
 * multi-element invariant a primitive can silently violate — the same test
 * create_document and add_section pass (self-serve-authoring.md, D3).
 *
 * Both share the graph-mutation envelope: a dry-run returns a diff + warnings +
 * confirmationToken (no state change); the confirm re-checks the token and
 * applies to the DRAFT only.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { asJson, guarded } from "./shared.js";
import { getActiveAdapter } from "../adapters/index.js";
import { activeWorkspace } from "../context/index.js";
import { runGraphMutation, kgNamespace } from "../kg-store/index.js";
import { editNodes, moveNode, type EditNodesItem } from "../kg-recipes/index.js";
import { runBatchMutation, type ReturnMode } from "./batch.js";
import { idempotencyPayloadHash } from "./idempotency.js";
import { runCatalogWrite, type WriteOutcome } from "./catalog-target.js";
import { withNextSteps } from "./next-steps.js";
import type { SubjectAdapter } from "../types.js";
import { PARKED_PAYLOAD_NOTE, IDEMPOTENCY_NOTE, RETURN_MODE_NOTE, CATALOG_REDIRECT_NOTE } from "./tool-notes.js";

function bind(adapter: SubjectAdapter): { namespace: string } {
  return { namespace: kgNamespace(activeWorkspace(), adapter.grade, adapter.subject) };
}

type MoveNodeToolArgs = {
  nodeId: string;
  toParentId: string;
  via?: string;
  position?: number;
  catalog?: string;
  confirm?: boolean;
  confirmationToken?: string;
};

// The move_node core, exported so tests drive the registered tool's real logic
// (the same shape runAddNodes uses). Routes the move to the active subject's
// namespace, or — when `catalog` is set — to a catalog library, which also
// publishes on confirm (catalogs have no publish_draft; see catalog-target.ts).
export async function runMoveNode(a: MoveNodeToolArgs): Promise<Record<string, unknown>> {
  const moveInNamespace = async (namespace: string): Promise<WriteOutcome> => {
    const result = await runGraphMutation({
      namespace,
      mutation: moveNode,
      args: { namespace, nodeId: a.nodeId, toParentId: a.toParentId, via: a.via, position: a.position },
      confirm: a.confirm,
      token: a.confirmationToken,
      // No storePayload, unlike edit_nodes: a move is three ids and a number, so
      // re-sending it on confirm is free — the parking mechanism exists for
      // prose-heavy payloads (see kg-mutations/token-only-confirm.md).
    });
    return result as WriteOutcome;
  };

  if (a.catalog) {
    return runCatalogWrite(a.catalog, a.confirm, moveInNamespace);
  }
  const result = await moveInNamespace(bind(getActiveAdapter()).namespace);
  return withNextSteps(result, moveNode.name);
}

type EditNodesToolArgs = {
  items?: EditNodesItem[];
  returnMode?: ReturnMode;
  idempotencyKey?: string;
  catalog?: string;   // edit inside a catalog library instead of the active subject
  confirm?: boolean;
  confirmationToken?: string;
};

// The edit_nodes core, exported so tests drive the registered tool's real logic
// (the same shape runAddNodes uses). Routes the batch to the active subject's
// namespace, or — when `catalog` is set — to a catalog library, which also
// publishes on confirm (catalogs have no publish_draft; see catalog-target.ts).
export async function runEditNodes(a: EditNodesToolArgs): Promise<Record<string, unknown>> {
  const editInNamespace = (namespace: string) => editNodesInNamespace(namespace, a);
  if (a.catalog) {
    return runCatalogWrite(a.catalog, a.confirm, editInNamespace);
  }
  return editInNamespace(bind(getActiveAdapter()).namespace);
}

// Delegates response shaping + idempotency to runBatchMutation. Namespace-agnostic
// so the same path serves both a subject write and a catalog write.
async function editNodesInNamespace(namespace: string, a: EditNodesToolArgs): Promise<Record<string, unknown>> {
  // Token-only confirm: caller sends confirm+token with NO items. The context
  // parked at dry-run holds them — a rewritten chapter's prose is exactly the
  // payload the parking mechanism exists for (kg-mutations/token-only-confirm.md)
  // — so the placeholder args/hash here are overwritten from it.
  if (a.confirm && !a.items) {
    return runBatchMutation({
      namespace, mutation: editNodes,
      args: { namespace, items: [] },
      confirm: true, token: a.confirmationToken,
      returnMode: a.returnMode ?? "summary",
      idempotencyKey: a.idempotencyKey,
      payloadHash: "",
      extra: {},
      storePayload: true,
    });
  }

  const items = a.items ?? [];
  return runBatchMutation({
    namespace,
    mutation: editNodes,
    args: { namespace, items },
    confirm: a.confirm,
    token: a.confirmationToken,
    returnMode: a.returnMode ?? "summary",
    idempotencyKey: a.idempotencyKey,
    payloadHash: idempotencyPayloadHash(items),
    extra: {},   // no minted ids: every item names a node that already exists
    storePayload: true,
  });
}

export function registerRecipeTools(server: McpServer) {
  server.registerTool(
    "edit_nodes",
    {
      title: "Edit nodes' fields (one or many) in one batch",
      description:
        "The field-edit tool — edit ONE node in place or MANY in one atomic draft edit. Each `items[i]` names an existing `nodeId` and carries ITS OWN values, so one batch can retitle one node and rewrite another's content. Every field is OPTIONAL and independent (an unsupplied field is left untouched, never cleared), but each item must set AT LEAST ONE of: `content` (load-bearing text, canonical LC Material.content), `position` (ordinal among siblings — membership is the containment edge, so this NEVER cascades; only LessonGrouping/Lesson/Activity/routine steps carry one), `title` (display name → the node's title/text field per its label), `title_en` (English mirror), `summary` (a routine/formatter blurb → raw.metadata.summary, what list_catalog surfaces), `properties` (a freeform object amending ANY OTHER canonical LC prop → raw.<key>, nested-merge — e.g. {\"metadata.assemblyGuide\":\"…\"} — the same bag add_nodes takes at create time). `properties` REFUSES protected paths: LC identity (normalizedType / normalizedStatementType / metadata.role / identifier) and the mirrored fields that have their own argument (use `position`, `title`, `content`). BLOCKED: a nonexistent `nodeId`, and naming the SAME node in two items (merge them). To remove content, delete the node. Edit in place — do NOT delete + re-add: that cascades the subtree, drops every incident edge, and mints a new id. ALL-OR-NOTHING: one confirmationToken for the batch; any item error blocks all of it. " + PARKED_PAYLOAD_NOTE +
        RETURN_MODE_NOTE + IDEMPOTENCY_NOTE + " DRAFT edit — publish_draft to make it live. " +
        "Use it to fix a stale master that use_routine / use_formatter would otherwise keep re-cloning. " + CATALOG_REDIRECT_NOTE,
      inputSchema: {
        // Required on a dry-run; omitted on a token-only confirm (large batch
        // held server-side — the parked context reconstructs the items).
        items: z.array(
          z.object({
            nodeId: z.string(),
            content: z.string().optional(),
            position: z.number().optional(),
            title: z.string().optional(),
            title_en: z.string().optional(),
            summary: z.string().optional(),
            properties: z.record(z.string(), z.unknown()).optional(),
          }),
        ).optional(),
        returnMode: z.enum(["summary", "full"]).optional(),
        idempotencyKey: z.string().optional(),
        catalog: z.string().optional(),
        confirm: z.boolean().optional(),
        confirmationToken: z.string().optional(),
      },
    },
    guarded(async (a: EditNodesToolArgs) => asJson(await runEditNodes(a))),
  );

  server.registerTool(
    "move_node",
    {
      title: "Re-parent a node",
      description:
        "Move an EXISTING node under a different parent in ONE atomic draft edit: detach from its current parent(s) on ONE containment axis, attach under `toParentId`, set its ordinal there. Use it whenever something is filed in the wrong place. Move in place — do NOT delete + re-add (that cascades the subtree, drops every incident edge, mints a new id), and prefer it over hand-rolling delete_edges + create_edges (three writes, each leavable half-done). " +
        "ONLY ONE AXIS MOVES, and there are two: `hasPart` (content, and the document layer) and `hasChild` (the standards hierarchy). The axis is read off the graph, so you rarely need `via`; a node hanging from both falls back to the canonical edge for its label. The OTHER axis is deliberately left intact — a CI-maths lesson sits under both a chapter (hasPart) and a week (hasChild), so moving it between chapters leaves its week alone; move that with a second call passing via:'hasChild'. `via` accepts ONLY those two: an alignment or reference edge (hasEducationalAlignment / supports / usesRoutine / relatesTo) is REFUSED, because detaching one would delete relationships rather than move anything — rewire those with delete_edges + create_edges. " +
        "`position` (optional) is the ordinal among the new siblings; omit to append. A move never cascades — the node's own children travel with it. " +
        "BLOCKED rather than guessed at: a nonexistent `nodeId`/`toParentId`; a node made its own parent; a target parent INSIDE the node being moved (that cuts the subtree out of the graph entirely); and a node with no parent on the chosen axis (the error names the axis — pass `via` if you meant the other). WARNS without blocking when several parents on the axis are all detached. Ids come from find_node or walk_graph. " +
        "Two-phase: the dry-run returns a diff + confirmationToken; confirm with the SAME arguments plus confirm:true + the token. DRAFT edit — publish_draft to make it live. " +
        "In a catalog, this re-files a master entry's steps. " + CATALOG_REDIRECT_NOTE +
        " There is NO undo_last for it — the only way back is an inverse move, so note the parent named in the dry-run's removed edge before confirming.",
      inputSchema: {
        nodeId: z.string(),
        toParentId: z.string(),
        via: z.string().optional(),
        position: z.number().optional(),
        catalog: z.string().optional(),
        confirm: z.boolean().optional(),
        confirmationToken: z.string().optional(),
      },
    },
    guarded(async (a: MoveNodeToolArgs) => asJson(await runMoveNode(a))),
  );
}
