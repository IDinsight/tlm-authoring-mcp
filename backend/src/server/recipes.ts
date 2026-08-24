/*
 * Module: server · tool group: the generic node verbs (edit_node, move_node)
 *
 * Two verbs over a node that already exists — one for its FIELDS, one for its
 * PLACE. edit_node changes a node's content, position and/or display title in one
 * atomic draft edit (it consolidated the separate set_content + reposition tools
 * and added title editing, which had no verb after upsert_property was removed).
 * move_node re-parents a node along ONE containment axis. Node CREATION is
 * add_nodes (server/authoring.ts).
 *
 * Why move_node is a verb and not two primitives: re-parenting by hand is
 * delete_edges (every current parent edge on that axis) + create_edges (the new
 * one) + edit_node (the ordinal) — three separate two-phase writes, so a caller
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
import { editNode, moveNode } from "../kg-recipes/index.js";
import { runCatalogWrite, type WriteOutcome } from "./catalog-target.js";
import { withNextSteps } from "./next-steps.js";
import type { SubjectAdapter } from "../types.js";

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
      // No storePayload, unlike edit_node: a move is three ids and a number, so
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

export function registerRecipeTools(server: McpServer) {
  server.registerTool(
    "edit_node",
    {
      title: "Edit a node's fields",
      description:
        "Edit a node IN PLACE in ONE atomic draft edit — the single field-edit verb (it replaced set_content + reposition and added title editing). Only `nodeId` is required. Every editable field is OPTIONAL and independent: supply just the ones you want to change (a single field is fine) — any unsupplied field is left untouched, never cleared. Provide AT LEAST ONE of: `content` (load-bearing text, canonical LC Material.content), `position` (ordinal among siblings — membership is the containment edge, so this NEVER cascades; only labels that carry a position in LC — LessonGrouping/Lesson/Activity/routine steps — have one), `title` (display name — normalized to the node's title/text field per its label), `title_en` (English mirror), `summary` (a routine/formatter's cross-cutting blurb → raw.metadata.summary, the field list_catalog / get_catalog_entry / walk_graph surface), `properties` (a freeform object amending ANY OTHER canonical LC prop → written under raw.<key>, nested-merge — e.g. {\"metadata.assemblyGuide\":\"…\"}; the same bag add_nodes takes at create time, so a raw prop can be amended later without a dedicated argument). `properties` REFUSES protected paths — LC identity (normalizedType / normalizedStatementType / metadata.role / identifier) and the mirrored fields that have their own argument (use `position` for the ordinal, `title` for the display name/description, `content` for the Material payload). A nonexistent `nodeId` is BLOCKED; to remove content, delete the node instead. Edit in place — do NOT delete + re-add (that cascades the subtree, drops every incident edge, and mints a new id). REQUIRES CONFIRMATION: the dry-run returns a diff + confirmationToken; confirm with confirm:true + the token. When the dry-run reports `payloadStored:true` (a large edit held server-side), confirm with ONLY confirm:true + the token — do NOT re-send `content`; otherwise re-send the same fields. DRAFT edit — publish_draft to make it live. " +
        "`catalog` (optional) edits a CATALOG LIBRARY entry instead of the active subject graph — use it to fix a stale master that use_routine / use_formatter would otherwise keep re-cloning. Pass 'workspace' (your own library), 'shared' (the cross-tenant one), or a workspace id; ids come from list_catalog / get_catalog_entry. Crossing into another workspace's or the shared library needs super_admin. TWO DIFFERENCES from a subject edit: confirming PUBLISHES the library live in one step (catalogs are not enterable contexts, so there is no publish_draft or diff_draft for them), and you must RE-SEND `catalog` on the confirm alongside the token. Note the copies already made from an entry are independent — fixing the master does not reach them; edit those in the subject graph separately.",
      inputSchema: {
        nodeId: z.string(),
        content: z.string().optional(),
        position: z.number().optional(),
        title: z.string().optional(),
        title_en: z.string().optional(),
        summary: z.string().optional(),
        properties: z.record(z.string(), z.unknown()).optional(),
        catalog: z.string().optional(),
        confirm: z.boolean().optional(),
        confirmationToken: z.string().optional(),
      },
    },
    guarded(async (a: { nodeId: string; content?: string; position?: number; title?: string; title_en?: string; summary?: string; properties?: Record<string, unknown>; catalog?: string; confirm?: boolean; confirmationToken?: string }) => {
      const editInNamespace = async (namespace: string): Promise<WriteOutcome> => {
        const result = await runGraphMutation({
          namespace,
          mutation: editNode,
          args: { namespace, nodeId: a.nodeId, content: a.content, position: a.position, title: a.title, title_en: a.title_en, summary: a.summary, properties: a.properties },
          confirm: a.confirm,
          token: a.confirmationToken,
          // edit_node passes its complete args straight through (no minting/rebuild
          // per phase), so a big content rewrite can be parked at dry-run and
          // confirmed with just the token — see runGraphMutation storePayload.
          storePayload: true,
        });
        return result as WriteOutcome;
      };

      // `catalog` redirects the edit to a catalog library, which also publishes on
      // confirm (catalogs have no publish_draft) — see catalog-target.ts.
      if (a.catalog) {
        return asJson(await runCatalogWrite(a.catalog, a.confirm, editInNamespace));
      }
      const result = await editInNamespace(bind(getActiveAdapter()).namespace);
      return asJson(withNextSteps(result as unknown as Record<string, unknown>, editNode.name));
    }),
  );

  server.registerTool(
    "move_node",
    {
      title: "Re-parent a node",
      description:
        "Move an EXISTING node under a different parent, in ONE atomic draft edit: it detaches the node from its current parent(s) on ONE containment axis, attaches it under `toParentId`, and sets its ordinal there — one diff, one token, one audit record. Use it whenever something is filed in the wrong place (a lesson under the wrong chapter, a step under the wrong routine). Move in place — do NOT delete + re-add (that cascades the subtree, drops every incident edge, and mints a new id), and prefer it over hand-rolling delete_edges + create_edges (three separate writes, each of which can be left half-done). " +
        "ONLY ONE AXIS MOVES, and there are only two: `hasPart` (content — Course/LessonGrouping/Lesson/Activity/Material, and the document layer) and `hasChild` (the standards hierarchy, including a derived LearningComponent under its frame). The axis is read off the graph — whichever of the two the node actually hangs from — so you rarely need `via`; a node hanging from BOTH falls back to the canonical edge for its label (`hasPart` for content). A node's OTHER axis is deliberately left intact: a CI-maths lesson sits under both a chapter (`hasPart`) and a week (`hasChild`), so moving it to another chapter leaves its week alone; move the schedule axis with a second call passing via:'hasChild'. `via` accepts ONLY those two edges — an alignment or reference edge (`hasEducationalAlignment`, `supports`, `usesRoutine`, `relatesTo`) is REFUSED, because detaching one of those would delete relationships (every lesson aligned to a standard, say) rather than move anything; rewire those with delete_edges + create_edges. " +
        "`position` (optional) is the ordinal among the new siblings; omit it to append at the end. Membership is the containment edge, so a move never cascades to the node's own children — they travel with it. " +
        "BLOCKED, rather than guessed at: a nonexistent `nodeId` or `toParentId`; a node made its own parent; a target parent that sits INSIDE the node being moved (that would cut the whole subtree out of the graph and leave it pointing at itself, where nothing — generation included — would reach it); and a node with no parent on the chosen axis (that one names the axis — pass `via` if you meant the other). It WARNS, without blocking, when the node has several parents on the axis and the move therefore detaches all of them. Ids come from find_node or walk_graph. " +
        "REQUIRES CONFIRMATION: the dry-run returns a diff + confirmationToken; confirm by calling again with the SAME arguments plus confirm:true + the token (a move is small enough that nothing is ever parked server-side). DRAFT edit — publish_draft to make it live. " +
        "`catalog` (optional) moves a node inside a CATALOG LIBRARY instead of the active subject graph — that is how a master entry's steps get re-filed without re-filing the whole entry. Pass 'workspace' (your own library), 'shared' (the cross-tenant one), or a workspace id; crossing libraries needs super_admin. Confirming PUBLISHES the library live in one step (catalogs are not enterable, so there is no publish_draft or diff_draft for them), and `catalog` must be RE-SENT on the confirm. That also means there is NO undo_last and no discard_draft for it: the only way back is an inverse move, so read the dry-run's diff — the edge it removes names the parent it came from — and keep that id before you confirm. Copies already made from an entry are independent — re-filing the master does not reach them.",
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
