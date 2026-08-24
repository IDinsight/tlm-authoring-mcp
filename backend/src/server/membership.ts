/*
 * Layer: app · module: server · the membership gate
 *
 * Entering a workspace is open (see server/context.ts): anyone signed in may
 * set_context anywhere and read the published curriculum, because the same
 * graphs are already served anonymously by the public KG explorer.
 *
 * What is NOT open is the workspace's live assets — the documents bucket, the
 * generation history, and the metered translation backend. Those used to be
 * protected only by the fact that you could not get through the door; with the
 * door open they need a gate of their own, and this is it.
 *
 * One helper, called at the top of every tool in that set, so the boundary is
 * a single line per tool rather than a policy re-derived in six places.
 */
import { randomUUID } from "node:crypto";
import { currentActor } from "../actor.js";
import { authorize, type AuthAction } from "../authz.js";
import { getKgStore, toAuditActor, nextAuditSeq } from "../kg-store/index.js";
import { asJson, type ToolResult } from "../utils/index.js";

/** The actions this gate covers — the lowest tier, i.e. "a member at all". */
export type MemberAction = Extract<AuthAction, "readDocuments" | "writeDocuments" | "translate">;

// What each action means in the refusal, in the caller's terms. A tool name
// would go stale; what the person was trying to DO does not.
const WHAT: Record<MemberAction, string> = {
  readDocuments: "read this workspace's generated documents",
  writeDocuments: "write to this workspace's documents or generation history",
  translate: "use this workspace's translation backend",
};

/**
 * Refuse unless the caller holds a role in `namespace`'s workspace.
 *
 * @returns a ToolResult to return as-is when denied, or null when allowed.
 */
export async function denyUnlessMember(action: MemberAction, namespace: string): Promise<ToolResult | null> {
  const actor = currentActor();
  const authz = authorize(actor, action, namespace);
  if (authz.ok) return null;

  // Audited like every other denial in the codebase, so an attempt on the live
  // bucket leaves a trace even though nothing changed.
  await getKgStore().appendAudit({
    id: randomUUID(),
    ts: new Date().toISOString(), seq: nextAuditSeq(),
    actor: toAuditActor(actor),
    namespace,
    eventType: "blocked",
    reason: `unauthorized: ${authz.reason}`,
  }).catch(() => undefined);   // the refusal stands even if the trail write fails

  return asJson({
    phase: "unauthorized",
    action,
    reason: authz.reason,
    message: `You may read this workspace's published curriculum without a role, but to ${WHAT[action]} you need one. Ask a workspace admin to add you.`,
  });
}
