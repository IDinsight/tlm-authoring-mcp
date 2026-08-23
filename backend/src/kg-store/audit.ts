/*
 * Module: kg-store · internal
 *
 * Runtime helpers for the append-only audit log. Types live in types.ts
 * (leaf, no cycles); this file holds only the small functions that operate
 * on records — used by both the memory and firestore backends.
 *
 * An audit record captures one event on the graph:
 *
 *   apply       — a graph mutation was applied to the draft. Carries the #5
 *                 diff inline so the record is self-contained.
 *   createDraft — a draft was created from published (byte-for-byte copy).
 *   publish     — the draft was promoted to published. References the apply
 *                 record ids it promoted; no whole-draft diff (that's #10).
 *   discard     — the draft was thrown away. References the apply record ids
 *                 that got discarded.
 *   blocked     — a mutation was rejected (structural rule, custom validate,
 *                 or a confirm-time token mismatch). No state change; the
 *                 record exists so "who tried what" is auditable.
 *
 * Records are written APPEND-ONLY: the store exposes `appendAudit` and
 * `listAudit`, never update or delete. The backends never emit an update()
 * on a record either — writes go through `set` on a fresh doc id only.
 *
 * Atomicity: for events that come with a state change (apply, createDraft,
 * publish, discard), the audit doc is committed in the SAME Firestore
 * transaction as the state write (see firestore.ts). For `blocked` there is
 * no state change to join — plain append.
 */

import type { Actor } from "../actor.js";
import type { AuditActor, AuditQuery, AuditRecord } from "./types.js";

// Build the audit-friendly projection of an Actor. Coerces `undefined` to
// `null` on the optional identity/role fields so the doc is Firestore-safe
// (Firestore rejects `undefined` values). Every audit-write site MUST go
// through this — do not spread actor fields inline.
export function toAuditActor(actor: Actor): AuditActor {
  return {
    id: actor.id,
    email: actor.email ?? null,
    tokenIssuer: actor.tokenIssuer ?? null,
    role: actor.role ?? null,
    superAdmin: !!actor.superAdmin,
    unknown: actor.unknown,
  };
}

// True if the record satisfies every set field in the filter. Used by both
// memory and firestore backends after the coarse cursor read.
export function matchesAuditQuery(r: AuditRecord, q: AuditQuery): boolean {
  if (q.namespace != null && r.namespace !== q.namespace) return false;
  if (q.actorId != null && r.actor.id !== q.actorId) return false;
  if (q.eventType != null && r.eventType !== q.eventType) return false;
  if (q.sinceTs != null && r.ts < q.sinceTs) return false;
  if (q.untilTs != null && r.ts > q.untilTs) return false;
  return true;
}

// Write order within one millisecond. `ts` alone cannot order two records
// written in the same millisecond, and the old tiebreak — a random UUID — put
// them in an arbitrary order. That is load-bearing now: undo_last reads "the
// newest edit" off this log, and the review handoff reads "the newest request or
// withdrawal", so a coin-flip between two same-millisecond records is a wrong
// answer, not a cosmetic one.
//
// A counter, rather than nudging `ts` forward, because this is an audit trail:
// a record must say when the thing actually happened, even by a millisecond. It
// is process-local and restarts at 0, so it orders a burst correctly (the only
// case that produces a tie in the first place) and never claims more than that.
let writeSequence = 0;
export const nextAuditSeq = (): number => ++writeSequence;
export const __resetAuditSeqForTest = (): void => { writeSequence = 0; };

// Sort newest-first by timestamp, then by write order within the millisecond,
// then by id so the result is total and stable regardless of storage order.
// `seq` is absent on records written before it existed; those sort as 0, which
// keeps them behind same-millisecond records from this process — the only
// ordering an old record can be given, and the same one it has today.
export const sortAuditNewestFirst = (rs: AuditRecord[]): AuditRecord[] =>
  [...rs].sort((a, b) =>
    b.ts.localeCompare(a.ts) || (b.seq ?? 0) - (a.seq ?? 0) || b.id.localeCompare(a.id));
