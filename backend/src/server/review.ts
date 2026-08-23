/*
 * Module: server · tool group: the review handoff (request_review)
 *
 * "This is a workflow, not a box of tools" (docs/design-notes/self-serve-authoring.md,
 * phase 5). A curator finishes a batch of work and needs the approver to look at
 * it. Today that message travels on WhatsApp, outside every trace the system
 * keeps — so nobody can answer "is anything waiting on me?" from inside the
 * product, and a draft can sit finished for a week because the message was
 * missed.
 *
 * The tool is deliberately small: it records that the draft is ready (with the
 * curator's own note, which is the part WhatsApp was actually carrying), and
 * `start_here` / `diff_draft` surface it. It is NOT a notification — nobody is
 * emailed. That was the note's third bullet and it stays unbuilt until the team
 * asks: email is a real dependency for what may be five people in one room.
 *
 * NOT two-phase. Every other write here stages a graph change worth stopping
 * over; this changes no curriculum, is undone by calling it again with
 * `withdraw`, and is cleared automatically when the draft publishes. A confirm
 * gate on it would train callers to click through gates that don't matter.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { asJson, guarded } from "./shared.js";
import { getActiveAdapter } from "../adapters/index.js";
import { activeWorkspace } from "../context/index.js";
import { getKgStore, kgNamespace, toAuditActor, readDraftStanding, nextAuditSeq } from "../kg-store/index.js";
import { authorize } from "../authz.js";
import { currentActor } from "../actor.js";

function activeNamespace(): string {
  const a = getActiveAdapter();
  return kgNamespace(activeWorkspace(), a.grade, a.subject);
}

export type RequestReviewArgs = {
  note?: string;
  withdraw?: boolean;
};

// A note is a message between two people, not a payload. Long enough for "the
// chapters 1-3 are done, 4 still needs its bilan", short enough that nobody
// mistakes it for the document.
const MAX_NOTE = 1000;

/**
 * The request_review core, exported so tests drive the real logic. Marks the
 * open draft as ready for someone to read — or takes that back with
 * `withdraw` — by appending one `review` event to the audit trail.
 */
export async function runRequestReview(a: RequestReviewArgs): Promise<Record<string, unknown>> {
  const namespace = activeNamespace();
  const actor = currentActor();

  // Same gate as editing: whoever may change the draft may say it is ready.
  // Blocked attempts are audited like every other denial.
  const authz = authorize(actor, "apply", namespace);
  if (!authz.ok) {
    await getKgStore().appendAudit({
      id: randomUUID(), ts: new Date().toISOString(), seq: nextAuditSeq(), actor: toAuditActor(actor),
      namespace, eventType: "blocked", reason: `unauthorized: ${authz.reason}`,
    });
    return { phase: "unauthorized", action: "apply", reason: authz.reason };
  }

  if (a.note && a.note.length > MAX_NOTE) {
    return { error: `The note is ${a.note.length} characters; keep it under ${MAX_NOTE}. It is a message to the person reading the draft, not the work itself.` };
  }

  const standing = await readDraftStanding(namespace);
  if (!standing) {
    return {
      noDraft: true,
      message:
        `There is no open draft in '${namespace}' to put up for review. Either nothing has been changed yet, or the last draft was already published or discarded. ` +
        `Stage an edit first, then ask for a review.`,
    };
  }

  const withdrawing = a.withdraw === true;
  if (withdrawing && !standing.review) {
    return { alreadyClear: true, message: "This draft was not waiting for a review, so there is nothing to take back." };
  }

  await getKgStore().appendAudit({
    id: randomUUID(),
    ts: new Date().toISOString(), seq: nextAuditSeq(),
    actor: toAuditActor(actor),
    namespace,
    eventType: "review",
    reviewState: withdrawing ? "withdrawn" : "requested",
    ...(a.note && !withdrawing ? { reviewNote: a.note } : {}),
  });

  const activity = standing.activity;
  if (withdrawing) {
    return {
      ok: true,
      reviewRequested: false,
      message: "The draft is no longer waiting for a review. It is untouched — only the request was taken back.",
      nextSteps: ["Keep editing, then ask for a review again when it is ready: request_review."],
    };
  }

  return {
    ok: true,
    reviewRequested: true,
    requestedBy: actor.id,
    draft: activity,
    ...(a.note ? { note: a.note } : {}),
    // Said plainly because it is the one thing a curator will assume wrongly.
    message:
      `The draft is marked ready for review: ${activity.edits} edit(s) touching ${activity.elementsTouched} element(s). ` +
      `Nobody is notified — an approver sees this when they call start_here or diff_draft on this subject, so tell them it is waiting if they are not already looking.`,
    nextSteps: [
      "Summarise for the approver what changed and what is left: diff_draft, then check_draft.",
      "Changed your mind? request_review with withdraw:true takes the request back (the draft is untouched).",
      "An approver publishes it: publish_draft.",
    ],
  };
}

export function registerReviewTools(server: McpServer) {
  server.registerTool(
    "request_review",
    {
      title: "Mark the draft ready for review",
      description:
        "Record that the open draft is FINISHED and waiting for someone to read it before publishing — the handoff from a curator to an approver, which otherwise happens outside the system entirely. Pass an optional `note` (up to 1000 characters): the message you would have sent by hand, e.g. what you changed and what is still missing. Pass `withdraw:true` to take the request back if you want to keep editing; the draft itself is untouched either way. " +
        "It does NOT notify anyone — an approver sees it when they call start_here or diff_draft on this subject, so say so out loud if they are not already looking. It is cleared automatically when the draft is published or discarded, so a request can never be left standing on work that already went live. Single call — no confirmation step, because nothing about the curriculum changes. Curators and approvers only, and recorded in the audit trail (who asked, when, and what they said).",
      inputSchema: {
        note: z.string().optional(),
        withdraw: z.boolean().optional(),
      },
    },
    guarded(async (a: RequestReviewArgs) => asJson(await runRequestReview(a))),
  );
}
