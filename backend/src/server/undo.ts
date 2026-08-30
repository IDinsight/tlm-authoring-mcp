/*
 * Module: server · tool group: undo_last
 *
 * "I can try it, and take it back" (docs/design-notes/self-serve-authoring.md,
 * phase 4). `discard_draft` throws away the whole draft; this takes back the
 * LAST edit and leaves the rest standing, so a curator can experiment without
 * betting the session on every call.
 *
 * The whole tool is a thin resolver over kg-store/undo.ts: find the apply record
 * to invert, then run its inverse through the SAME two-phase framework every
 * other write uses — dry-run diff + token, confirm applies to the draft. An undo
 * is an ordinary staged edit, not a privileged rewind: it is audited, it is role
 * gated, and it does not reach generation until the draft is published.
 *
 * `auditId` is deliberately NOT a caller argument. It is resolved server-side on
 * both phases, which is both what keeps the two-phase args hash stable without
 * the caller echoing anything back, and the honest surface: an expert says "take
 * that back", not "invert audit record 7f3c…".
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { asJson, guarded } from "./shared.js";
import { getActiveAdapter } from "../adapters/index.js";
import { activeWorkspace } from "../context/index.js";
import { kgNamespace, findUndoTarget, undoApply, type UndoLastArgs } from "../kg-store/index.js";
import { runBatchMutation, type ReturnMode } from "./batch.js";
import { idempotencyPayloadHash } from "./idempotency.js";

function activeNamespace(): string {
  const a = getActiveAdapter();
  return kgNamespace(activeWorkspace(), a.grade, a.subject);
}

export type UndoLastToolArgs = {
  confirm?: boolean;
  confirmationToken?: string;
  returnMode?: ReturnMode;
  idempotencyKey?: string;
};

// What the caller is told they are about to take back, so the model can name the
// edit to the expert instead of quoting an id at them.
const describeTarget = (record: { id: string; ts: string; mutation?: string; actor: { id: string } }) => ({
  auditId: record.id,
  mutation: record.mutation ?? "unknown",
  at: record.ts,
  by: record.actor.id,
});

/**
 * The undo_last core, exported so tests drive the real logic. Both phases
 * re-resolve the target: between a dry-run and its confirm nothing can change it
 * without also moving the draft, which the token's base-version check already
 * rejects as STALE.
 */
export async function runUndoLast(a: UndoLastToolArgs): Promise<Record<string, unknown>> {
  const namespace = activeNamespace();

  const target = await findUndoTarget(namespace);
  if (!target) {
    // No envelope phase: nothing was staged, nothing was refused, and there is
    // nothing to confirm — the same shape preview_generation uses for "no draft".
    return {
      nothingToUndo: true,
      message:
        `There is no staged edit to take back in '${namespace}' — either the draft is empty, or every edit on it has already been undone. ` +
        `undo_last only reaches edits on the CURRENT draft: once a draft is published, taking a change back is a new edit.`,
    };
  }

  const args: UndoLastArgs = { auditId: target.id };
  const shaped = await runBatchMutation({
    namespace,
    mutation: undoApply(target),
    args,
    confirm: a.confirm,
    token: a.confirmationToken,
    returnMode: a.returnMode ?? "summary",
    idempotencyKey: a.idempotencyKey,
    payloadHash: idempotencyPayloadHash(args),
    extra: {},
    undoOf: target.id,
  });
  return { ...shaped, undoing: describeTarget(target) };
}

export function registerUndoTools(server: McpServer) {
  server.registerTool(
    "undo_last",
    {
      title: "Take back the last staged edit",
      description:
        "Take back the MOST RECENT edit staged on the draft, leaving every other staged edit in place — the per-edit counterpart to discard_draft, which throws away the whole draft. It works by replaying that edit's recorded diff BACKWARDS (adding back what it removed, removing what it added, restoring what it changed), so nothing is lost or guessed. Takes no arguments: the edit is resolved server-side, and the dry-run reports it in `undoing` {auditId, mutation, at, by} so you can name it to the user before they agree. Calling it repeatedly PEELS BACK — undo, then the edit before that — it does not toggle. SCOPE: only edits on the CURRENT draft. A published change is not reachable this way; taking one back is a fresh edit. REFUSES rather than merges when a later edit touched the same node (the response says which node and why) — undo the later edit first, or fix the node directly with edit_nodes. " +
        "REQUIRES CONFIRMATION: the dry-run returns the diff summary + a confirmationToken and changes nothing; confirm by calling again with confirm:true and that token. " +
        "`returnMode` (default 'summary') returns `counts` instead of the whole diff; 'full' attaches the diff too. `idempotencyKey` (optional, a UUID) makes a retried confirm a safe replay. DRAFT edit — the draft is what generation sees only after publish_draft.",
      inputSchema: {
        returnMode: z.enum(["summary", "full"]).optional(),
        idempotencyKey: z.string().optional(),
        confirm: z.boolean().optional(),
        confirmationToken: z.string().optional(),
      },
    },
    guarded(async (a: UndoLastToolArgs) => asJson(await runUndoLast(a))),
  );
}
