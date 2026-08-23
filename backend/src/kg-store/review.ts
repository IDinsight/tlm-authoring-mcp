/*
 * Module: kg-store · internal
 *
 * The review handoff — a curator says "this is ready", and the approver who has
 * to publish it can see that without being told on WhatsApp
 * (docs/design-notes/self-serve-authoring.md, phase 5).
 *
 * There is NO stored flag. The state is derived from the audit log: the newest
 * `review` event on the current draft chain (see draft-chain.ts). That buys
 * three things a pointer field would not:
 *
 *   • Publishing or discarding CLEARS it, because those events are the chain's
 *     boundary — a stale "waiting for review" on a published draft is exactly
 *     the failure this feature exists to prevent, and it cannot happen.
 *   • Every request and withdrawal is already, permanently, in the trail: who
 *     asked, when, and what they said about it.
 *   • Nothing new to keep in sync, which is the same principle start_here is
 *     built on.
 *
 * The cost is one audit read on the surfaces that show it. They already read the
 * store, and the query is bounded by the draft chain.
 */

import { currentDraftEvents, standingEdits } from "./draft-chain.js";
import type { AuditRecord } from "./types.js";

/** A draft that a curator has asked someone to read. */
export type ReviewRequest = {
  requestedAt: string;
  requestedBy: string;
  note?: string;
};

/** How much unpublished work is standing on the draft, in an expert's terms. */
export type DraftActivity = {
  /** Edits standing on the draft — an edit and its undo cancel, they don't count twice. */
  edits: number;
  /** How many distinct nodes/edges those edits touched. */
  elementsTouched: number;
  lastEditAt: string | null;
  lastEditBy: string | null;
};

/** The review request standing on the current draft, or null if none is. */
export function reviewRequestIn(events: AuditRecord[]): ReviewRequest | null {
  const latest = events.find((record) => record.eventType === "review");
  if (!latest || latest.reviewState !== "requested") return null;
  return {
    requestedAt: latest.ts,
    requestedBy: latest.actor.id,
    ...(latest.reviewNote ? { note: latest.reviewNote } : {}),
  };
}

/** What is standing on the current draft, counted from the edits' own diffs. */
export function draftActivityIn(events: AuditRecord[]): DraftActivity {
  const edits = standingEdits(events);
  const touched = new Set<string>();
  for (const edit of edits) {
    const diff = edit.diff;
    if (!diff) continue;
    for (const side of [diff.nodes, diff.edges]) {
      for (const entry of [...side.added, ...side.removed, ...side.changed]) touched.add(entry.id);
    }
  }
  return {
    edits: edits.length,
    elementsTouched: touched.size,
    lastEditAt: edits[0]?.ts ?? null,
    lastEditBy: edits[0]?.actor.id ?? null,
  };
}

/**
 * Both derived facts about the open draft in ONE audit read — the surfaces that
 * show them (start_here, diff_draft) want them together. Returns null when no
 * draft is open.
 */
export async function readDraftStanding(
  namespace: string,
): Promise<{ review: ReviewRequest | null; activity: DraftActivity } | null> {
  const events = await currentDraftEvents(namespace);
  if (!events) return null;
  return { review: reviewRequestIn(events), activity: draftActivityIn(events) };
}
