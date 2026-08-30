/*
 * Module: kg-store · internal
 *
 * undo_last — take back ONE staged edit without losing the others.
 *
 * Until now `discard_draft` was the only way back, so six edits and one regret
 * cost all six. That is a strong deterrent to exactly the experimentation the
 * draft slot exists to encourage (docs/design-notes/self-serve-authoring.md,
 * phase 4).
 *
 * The mechanism is already paid for: every apply record carries its GraphDiff
 * inline, so undoing an edit is REPLAYING THAT DIFF BACKWARDS — add what it
 * removed, remove what it added, restore what it changed. No new state, no
 * snapshots, no inverse recorded at write time.
 *
 * Two rules keep it honest:
 *
 *   • SCOPE — only edits on the CURRENT open draft can be undone (the applies
 *     since the newest draft boundary, when that boundary is a createDraft).
 *     Published work is not reachable: publishing is the commitment, and taking
 *     it back is a fresh edit that says so.
 *
 *   • CONFLICT — the inverse is applied only when the draft still LOOKS the way
 *     that edit left it. If a later edit touched the same node, we refuse and
 *     say which node, rather than merging (self-serve-authoring.md, risk 4: a
 *     half-undone node nobody asked for is worse than a clear refusal).
 *
 * Repeated calls PEEL BACK rather than toggle: each undo's own apply record
 * carries `undoOf`, so the next call skips both the undo and the edit it undid,
 * and lands on the one before.
 */

import { currentDraftEvents, standingEdits } from "./draft-chain.js";
import { stableStringify, type GraphMutation } from "./mutations.js";
import type { AuditRecord, GraphDiff, MutationEdge, MutationGraph, MutationNode } from "./types.js";

export type UndoLastArgs = {
  // The apply record to invert. Resolved by findUndoTarget on BOTH phases (the
  // dry-run and the confirm), never typed by a caller — which is what keeps the
  // two-phase args hash stable without the caller echoing anything back.
  auditId: string;
};

// ── Which edit comes back ────────────────────────────────────────────────────

/**
 * The edit `undo_last` would take back: the newest edit STANDING on the current
 * draft — neither an undo itself nor already undone (see kg-store/draft-chain).
 * Returns null when there is nothing left to take back: no open draft, or every
 * edit on it already undone.
 */
export async function findUndoTarget(namespace: string): Promise<AuditRecord | null> {
  const events = await currentDraftEvents(namespace);
  if (!events) return null;
  return standingEdits(events)[0] ?? null;
}

// ── Preconditions: does this edit still look the way it left the draft? ───────

const byId = <T extends { id: string }>(xs: T[]): Map<string, T> => new Map(xs.map((x) => [x.id, x]));
const same = (a: unknown, b: unknown): boolean => stableStringify(a) === stableStringify(b);

/**
 * The reasons this edit can no longer be inverted, in the expert's terms. Empty
 * when the inverse applies cleanly.
 *
 * The check is against the CURRENT draft, not against the records in between:
 * an edit is undoable exactly when everything it touched is still as it left it.
 * That is what makes peeling work — undoing edit B restores A's end state, so A
 * becomes undoable again — with no reasoning about intervening records at all.
 */
export function undoConflicts(base: MutationGraph, diff: GraphDiff): string[] {
  const conflicts: string[] = [];

  // One diff side (added/removed/changed) — the same shape for nodes and edges.
  type DiffSide = GraphDiff["nodes"];

  const check = <T extends { id: string }>(kind: "node" | "edge", present: Map<string, T>, side: DiffSide) => {
    for (const entry of side.added) {
      const now = present.get(entry.id);
      if (!now) conflicts.push(`the ${kind} '${entry.id}' this edit created has already been removed by a later edit`);
      else if (!same(now, entry.after)) conflicts.push(`the ${kind} '${entry.id}' this edit created was modified by a later edit`);
    }
    for (const entry of side.removed) {
      if (present.has(entry.id)) conflicts.push(`the ${kind} '${entry.id}' this edit deleted has since been re-created`);
    }
    for (const entry of side.changed) {
      const now = present.get(entry.id);
      if (!now) conflicts.push(`the ${kind} '${entry.id}' this edit modified has since been deleted`);
      else if (!same(now, entry.after)) conflicts.push(`the ${kind} '${entry.id}' this edit modified was modified again by a later edit`);
    }
  };

  check("node", byId(base.nodes), diff.nodes);
  check("edge", byId(base.edges), diff.edges);

  // Taking back a creation means removing the node — which a later edit may have
  // wired something onto. Caught here so the refusal names the connection, rather
  // than surfacing as Rule 2's generic dangling-edge error.
  const removedByUndo = new Set(diff.nodes.added.map((e) => e.id));
  const edgesGoingToo = new Set(diff.edges.added.map((e) => e.id));
  for (const edge of base.edges) {
    if (edgesGoingToo.has(edge.id)) continue;
    const touches = removedByUndo.has(edge.from) ? edge.from : removedByUndo.has(edge.to) ? edge.to : null;
    if (touches) conflicts.push(`the node '${touches}' this edit created was connected to something else by a later edit (edge '${edge.id}')`);
  }

  return conflicts;
}

// ── The mutation ─────────────────────────────────────────────────────────────

/**
 * The mutation that inverts one apply record. Built per call with the record
 * captured, because the diff comes from the audit trail rather than from the
 * caller's args — the args carry only the record's id, which is what keeps the
 * dry-run and the confirm hashing identically.
 */
export function undoApply(record: AuditRecord): GraphMutation<UndoLastArgs> {
  const diff = record.diff;

  return {
    name: "undoLast",

    describe: () =>
      `take back the edit '${record.mutation ?? "unknown"}' made at ${record.ts} by ${record.actor.id} (audit ${record.id})`,

    validate: (base) => {
      // A record from before diffs were stored inline has nothing to invert.
      if (!diff) {
        return {
          errors: [`Audit record '${record.id}' carries no diff, so there is nothing to invert. Use discard_draft to drop the whole draft instead.`],
          warnings: [],
        };
      }
      const conflicts = undoConflicts(base, diff);
      if (conflicts.length === 0) return { errors: [], warnings: [] };
      return {
        errors: [
          `This edit can no longer be taken back on its own — a later edit touched the same thing: ${conflicts.join("; ")}. ` +
          `Undo the later edit(s) first, or fix the node directly with edit_nodes; discard_draft drops the whole draft.`,
        ],
        warnings: [],
      };
    },

    // Replay the diff backwards. validate has already established that every
    // element is where the record left it, so this is a straight substitution.
    apply: (base) => {
      if (!diff) return base;
      const nodes = byId(base.nodes);
      const edges = byId(base.edges);

      for (const entry of diff.nodes.added) nodes.delete(entry.id);
      for (const entry of diff.nodes.removed) nodes.set(entry.id, entry.before as MutationNode);
      for (const entry of diff.nodes.changed) nodes.set(entry.id, entry.before as MutationNode);

      for (const entry of diff.edges.added) edges.delete(entry.id);
      for (const entry of diff.edges.removed) edges.set(entry.id, entry.before as MutationEdge);
      for (const entry of diff.edges.changed) edges.set(entry.id, entry.before as MutationEdge);

      return { nodes: [...nodes.values()], edges: [...edges.values()] };
    },
  };
}
