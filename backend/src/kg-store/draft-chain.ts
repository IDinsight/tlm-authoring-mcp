/*
 * Module: kg-store · internal
 *
 * The audit records belonging to the CURRENT open draft.
 *
 * Several features need the same question answered — "what has happened on the
 * draft that is open right now?": `undo_last` needs the edits it may take back,
 * the review handoff needs whether review was requested on THIS draft, and the
 * orientation read needs how much unpublished work is standing.
 *
 * The answer is derived from the append-only audit log rather than from a stamp
 * anyone has to remember to clear. Walk newest-first to the first event that
 * OPENS or CLOSES a draft; if that boundary is a `createDraft`, everything after
 * it belongs to the draft the store is holding, and if it is a `publish` or a
 * `discard` there is no open chain at all. Publishing or discarding therefore
 * clears every derived fact at once, because those events ARE the boundary —
 * there is no second place to forget.
 *
 * Note this is deliberately NOT the chain publish uses. Publish computes "the
 * applies since the last createDraft" while standing before its own boundary
 * record, so it must not stop at a publish; undo and review run after one, and
 * for them a publish means the work is out of reach.
 */

import { getKgStore } from "./adapter.js";
import type { AuditEventType, AuditRecord } from "./types.js";

// The events that open or close a draft.
const DRAFT_BOUNDARY: ReadonlySet<AuditEventType> = new Set<AuditEventType>(["createDraft", "publish", "discard"]);

/**
 * Every audit record since the current draft was opened, newest-first — or null
 * when no draft is open (nothing was ever created, or the newest boundary is a
 * publish/discard).
 */
export async function currentDraftEvents(namespace: string): Promise<AuditRecord[] | null> {
  const events = await getKgStore().listAudit({ namespace });   // newest-first
  const boundary = events.find((record) => DRAFT_BOUNDARY.has(record.eventType));
  if (!boundary || boundary.eventType !== "createDraft") return null;
  return events.filter((record) => record.ts >= boundary.ts);
}

/**
 * The edits STANDING on the current draft, newest-first: the applies that are
 * neither an undo nor already undone. This is the set an expert means by "what
 * have I changed" — an edit and its undo cancel out rather than counting twice —
 * and its newest member is what `undo_last` takes back.
 */
export function standingEdits(events: AuditRecord[]): AuditRecord[] {
  const applies = events.filter((record) => record.eventType === "apply");
  const alreadyUndone = new Set(applies.map((record) => record.undoOf).filter((id): id is string => id != null));
  return applies.filter((record) => record.undoOf == null && !alreadyUndone.has(record.id));
}
