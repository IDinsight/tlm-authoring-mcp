/*
 * Module: server · tool group: edge + deletion verbs
 *
 * The edge/deletion verbs — create_edges, delete_edges, delete_nodes. Node
 * CREATION is add_nodes (server/authoring.ts); create_edges is the escape hatch
 * for edges add_nodes doesn't set (usesRoutine, buildsTowards, relatesTo,
 * hasDependency, an extra hasEducationalAlignment). All share the pattern:
 *
 *   • Two-phase confirm (dry-run returns diff + confirmationToken; confirm
 *     applies to the DRAFT only).
 *   • Referential-integrity rules always fire (id-immutable, no dangling edge).
 *   • Every apply and every denial is audited; all gated on curator/approver.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { asJson, guarded } from "./shared.js";
import { getActiveAdapter } from "../adapters/index.js";
import { activeWorkspace } from "../context/index.js";
import { kgNamespace, deleteEdges, deleteNodes } from "../kg-store/index.js";
import { createEdges } from "../kg-recipes/index.js";
import { runBatchMutation, type ReturnMode } from "./batch.js";
import { idempotencyPayloadHash } from "./idempotency.js";
import { runCatalogWrite } from "./catalog-target.js";
import { PARKED_PAYLOAD_NOTE, IDEMPOTENCY_NOTE, RETURN_MODE_NOTE, CATALOG_REDIRECT_NOTE } from "./tool-notes.js";

function activeNamespace(): string {
  const a = getActiveAdapter();
  return kgNamespace(activeWorkspace(), a.grade, a.subject);
}

const JsonValue = z.any();

type CreateEdgesArgs = {
  edges?: Array<{ edgeType: string; fromId: string; toId: string; properties?: Record<string, unknown> }>;
  confirm?: boolean;
  confirmationToken?: string;
  returnMode?: ReturnMode;
  idempotencyKey?: string;
  catalog?: string;   // write to a catalog library instead of the active subject
};

// The create_edges core, exported so tests drive the real logic. Routes the batch
// to the active subject's namespace, or — when `catalog` is set — to a catalog
// library, which also publishes on confirm (see catalog-target.ts).
export async function runCreateEdges(a: CreateEdgesArgs): Promise<Record<string, unknown>> {
  const createInNamespace = (namespace: string) => createEdgesInNamespace(namespace, a);
  if (a.catalog) {
    return runCatalogWrite(a.catalog, a.confirm, createInNamespace);
  }
  return createInNamespace(activeNamespace());
}

// Normalizes each edge's properties, then delegates response shaping +
// idempotency to runBatchMutation (no minted ids for edges, so `extra` is empty).
// Namespace-agnostic so the same path serves a subject and a catalog write.
async function createEdgesInNamespace(namespace: string, a: CreateEdgesArgs): Promise<Record<string, unknown>> {
  // Token-only confirm: caller sends confirm+token with no `edges`. The parked
  // context (built on dry-run) holds the normalised list, so runBatchMutation
  // reconstructs from it — placeholder args/hash here are overwritten.
  if (a.confirm && !a.edges) {
    return runBatchMutation({
      namespace, mutation: createEdges,
      args: { namespace, edges: [] },
      confirm: true, token: a.confirmationToken,
      returnMode: a.returnMode ?? "summary",
      idempotencyKey: a.idempotencyKey,
      payloadHash: "",
      extra: {},
      storePayload: true,
    });
  }

  const normalizedEdges = (a.edges ?? []).map((edge) => ({ ...edge, properties: edge.properties ?? {} }));
  return runBatchMutation({
    namespace,
    mutation: createEdges,
    args: { namespace, edges: normalizedEdges },
    confirm: a.confirm,
    token: a.confirmationToken,
    returnMode: a.returnMode ?? "summary",
    idempotencyKey: a.idempotencyKey,
    payloadHash: idempotencyPayloadHash(normalizedEdges),
    extra: {},
    storePayload: true,
  });
}

type DeleteEdgesArgs = {
  edgeIds: string[];
  confirm?: boolean;
  confirmationToken?: string;
  returnMode?: ReturnMode;
  idempotencyKey?: string;
  catalog?: string;   // delete inside a catalog library instead of the active subject
};

// The delete_edges core, exported so tests drive the real logic. Removes one edge
// or many by id in one atomic batch; no minted ids, so `extra` is empty.
export async function runDeleteEdges(a: DeleteEdgesArgs): Promise<Record<string, unknown>> {
  const deleteInNamespace = (namespace: string) => deleteEdgesInNamespace(namespace, a);
  if (a.catalog) {
    // Destructive: a catalog write publishes on confirm, so this is live with no
    // draft and no undo — held at `admin` in the destination (catalog-target.ts).
    return runCatalogWrite(a.catalog, a.confirm, deleteInNamespace, { destructive: true });
  }
  return deleteInNamespace(activeNamespace());
}

// Namespace-agnostic so the same path serves a subject and a catalog write.
async function deleteEdgesInNamespace(namespace: string, a: DeleteEdgesArgs): Promise<Record<string, unknown>> {
  return runBatchMutation({
    namespace,
    mutation: deleteEdges,
    args: { edgeIds: a.edgeIds },
    confirm: a.confirm,
    token: a.confirmationToken,
    returnMode: a.returnMode ?? "summary",
    idempotencyKey: a.idempotencyKey,
    payloadHash: idempotencyPayloadHash(a.edgeIds),
    extra: {},
  });
}

type DeleteNodesArgs = {
  nodeIds: string[];
  confirm?: boolean;
  confirmationToken?: string;
  returnMode?: ReturnMode;
  idempotencyKey?: string;
  catalog?: string;   // delete inside a catalog library instead of the active subject
};

// The delete_nodes core, exported so tests drive the real logic. Removes one node
// or many — each with its dependent subtree (cascade) — in one atomic batch.
// Retiring a catalog ENTRY is exactly this: the entry node plus the steps and
// Materials hanging off it, which the cascade already takes.
export async function runDeleteNodes(a: DeleteNodesArgs): Promise<Record<string, unknown>> {
  const deleteInNamespace = (namespace: string) => deleteNodesInNamespace(namespace, a);
  if (a.catalog) {
    // Retiring a catalog entry — the only write with no draft, no undo, and
    // copies possibly live in other workspaces. Held at `admin` in the
    // destination workspace (catalog-target.ts / authz retireCatalogEntry).
    return runCatalogWrite(a.catalog, a.confirm, deleteInNamespace, { destructive: true });
  }
  return deleteInNamespace(activeNamespace());
}

// Namespace-agnostic so the same path serves a subject and a catalog write.
async function deleteNodesInNamespace(namespace: string, a: DeleteNodesArgs): Promise<Record<string, unknown>> {
  return runBatchMutation({
    namespace,
    mutation: deleteNodes,
    args: { nodeIds: a.nodeIds },
    confirm: a.confirm,
    token: a.confirmationToken,
    returnMode: a.returnMode ?? "summary",
    idempotencyKey: a.idempotencyKey,
    payloadHash: idempotencyPayloadHash(a.nodeIds),
    extra: {},
  });
}

export function registerStructuralTools(server: McpServer) {
  // ── create_edges ───────────────────────────────────────────────────────────
  server.registerTool(
    "create_edges",
    {
      title: "Create edges (one or many) in one batch",
      description:
        "Add ONE edge or MANY in one atomic draft edit — for the edges add_nodes does not set: `usesRoutine` (apply a routine to a Lesson/Course/Activity), `buildsTowards` / `relatesTo` / `hasDependency` (prerequisites), or an extra `hasEducationalAlignment`. Each `edges[i]`: `edgeType`, `fromId`, `toId`, optional `properties`. Both endpoints must already exist in the draft (ids from a prior committed add_nodes count). Edge ids are deterministic (`<type>:<from>-><to>`) and a duplicate triple is rejected — detection spans both the batch and the draft. ALL-OR-NOTHING: one confirmationToken; any item error blocks all of it. Edge-type legality across labels is a reviewer judgement at publish, not enforced here. " + PARKED_PAYLOAD_NOTE +
        RETURN_MODE_NOTE + IDEMPOTENCY_NOTE + " DRAFT edit. " +
        CATALOG_REDIRECT_NOTE,
      inputSchema: {
        // Required on dry-run; omitted on a token-only confirm (large batch
        // held server-side — the parked context reconstructs the list).
        edges: z.array(
          z.object({
            edgeType: z.string(),
            fromId: z.string(),
            toId: z.string(),
            properties: z.record(JsonValue).optional(),
          }),
        ).optional(),
        returnMode: z.enum(["summary", "full"]).optional(),
        idempotencyKey: z.string().optional(),
        catalog: z.string().optional(),
        confirm: z.boolean().optional(),
        confirmationToken: z.string().optional(),
      },
    },
    guarded(async (a: CreateEdgesArgs) => asJson(await runCreateEdges(a))),
  );

  // ── delete_edges ───────────────────────────────────────────────────────────
  server.registerTool(
    "delete_edges",
    {
      title: "Delete edges (one or many) in one batch",
      description:
        "Remove ONE edge or MANY by id in one atomic draft edit. Each `edgeIds[i]` is a deterministic edge id (`<type>:<from>-><to>`), from a create_edges preview, diff_draft, or the graph. Removing an edge cannot orphan a node — it just becomes less connected — so use this to DETACH a subtree you want to keep before delete_nodes. ALL-OR-NOTHING: a missing id, or one listed twice, blocks the batch. " +
        RETURN_MODE_NOTE + IDEMPOTENCY_NOTE + " DRAFT edit — publish_draft to make it live. " +
         CATALOG_REDIRECT_NOTE,
      inputSchema: {
        edgeIds: z.array(z.string()),
        returnMode: z.enum(["summary", "full"]).optional(),
        idempotencyKey: z.string().optional(),
        catalog: z.string().optional(),
        confirm: z.boolean().optional(),
        confirmationToken: z.string().optional(),
      },
    },
    guarded(async (a: DeleteEdgesArgs) => asJson(await runDeleteEdges(a))),
  );

  // ── delete_nodes ───────────────────────────────────────────────────────────
  server.registerTool(
    "delete_nodes",
    {
      title: "Delete nodes (one or many, each with its dependent subtree) in one batch",
      description:
        "Remove ONE node or MANY by id in one atomic draft edit — each with its dependent subtree (hasChild/hasPart descendants) and every edge touching a removed node. The cascade is computed over ALL the ids at once, so a child shared by two of them also vanishes. The dry-run diff shows the FULL set and WARNS with it; nothing is deleted until you confirm, so seeing the cascade IS the safety (no force flag). ALL-OR-NOTHING: a missing id, or one listed twice, blocks the batch. Referential integrity is re-checked after. " +
        RETURN_MODE_NOTE + IDEMPOTENCY_NOTE + " DRAFT edit — publish_draft to make it live. " +
         CATALOG_REDIRECT_NOTE + " Retiring a catalog entry is this call with `catalog` set: name the ENTRY id and its steps/Materials come along in the cascade. It needs ADMIN in the destination workspace — one tier above an ordinary catalog write — because it publishes immediately: no draft to review, no undo_last, and other workspaces may be using the entry. The dry-run carries `irreversible:true`; read the cascade to the user and get an explicit yes before confirming. The confirmed response carries `recovery`, naming the audit record that holds the deleted subtree in full.",
      inputSchema: {
        nodeIds: z.array(z.string()),
        returnMode: z.enum(["summary", "full"]).optional(),
        idempotencyKey: z.string().optional(),
        catalog: z.string().optional(),
        confirm: z.boolean().optional(),
        confirmationToken: z.string().optional(),
      },
    },
    guarded(async (a: DeleteNodesArgs) => asJson(await runDeleteNodes(a))),
  );
}
