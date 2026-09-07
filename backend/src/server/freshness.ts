/*
 * Layer: app · module: server · is what I am about to compose FROM still current?
 *
 * THE DEFECT, reported from a real authoring session. A CE1 Guide was composed
 * against a pupil render that was at its 1-September state while the lesson's
 * decisions ran to 6 September. Nothing anywhere flagged it. It was found only
 * because someone opened the drawings for an unrelated reason.
 *
 * The machinery to catch it already existed and nothing ASKED. `check_stale`
 * answers a stronger question than any timestamp could — it compares each
 * document's recorded source wording against the graph's wording now, read out
 * of the file's own anchors — but it is a separate, deliberate call, and the
 * composition path never made it. A precondition nobody is prompted to check is
 * a precondition in name only. So the verdict rides the production READ.
 *
 * THE HALF ANCHORS CANNOT ANSWER, and the one the reported case fell into. A
 * document produced any other way than through `render_document` carries no
 * anchors, so its verdict is `unknown` — correctly never "current", but also not
 * actionable. For those we ask the AUDIT instead: was there any graph edit to
 * the node this file covers AFTER the file was written? That is precisely the
 * `{pupilRenderUpdated, lessonGraphUpdated}` comparison the report asked for,
 * and it needs no new stored field — the audit already carries a timestamp and
 * the per-node diff.
 *
 * The audit read is bounded by `sinceTs = the file's own mtime`, because the
 * question is only ever "anything after this?". On a fresh file that returns
 * nothing and costs nothing; there is no scan of the namespace's whole history.
 * And it is attempted ONLY for `unknown` documents — an anchored verdict is
 * already better than a timestamp and must not be second-guessed by one.
 */
import { currentActor } from "../actor.js";
import { authorize } from "../authz.js";
import { getKgStore } from "../kg-store/index.js";
import { listEntries } from "../storage/index.js";
import { staleness } from "../render/index.js";
import type { CurriculumModel, HistoryEntry } from "../types.js";
import { applyTouchesNode } from "./audit.js";
import type { AuditRecord } from "../kg-store/index.js";

/** One already-produced document covering something this read is about. */
export type DocumentFreshness = {
  relPath: string;
  nodeId: string;
  updated: string | null;
  documentId?: string;
  variant?: string;
  state: "current" | "stale" | "unknown";
  /** stale: the covered nodes whose wording moved / that are gone. */
  changed?: string[];
  removed?: string[];
  /** unknown only: the newest graph edit to what this file covers, if any. */
  lastGraphEdit?: string;
  /** unknown only: set when that edit is NEWER than the file itself. */
  olderThanGraph?: true;
};

type Counts = { current: number; stale: number; unknown: number };

export type Freshness = {
  counts: Counts;
  /** Only the documents needing attention — a list of "all fine" is noise. */
  documents: DocumentFreshness[];
  note?: string;
} | { unavailable: string };

/*
 * The newest graph edit to `nodeId` after `since`, or null.
 *
 * `since` bounds the query rather than filtering afterwards: the only thing
 * being asked is whether anything happened AFTER the file was written, so a
 * current file reads almost no records.
 */
async function lastEditAfter(namespace: string, nodeId: string, since: string): Promise<string | null> {
  const records: AuditRecord[] = await getKgStore().listAudit({ namespace, sinceTs: since });
  const touching = records.filter((record) => applyTouchesNode(record, nodeId));
  if (touching.length === 0) return null;
  return touching.reduce((newest, record) => (record.ts > newest ? record.ts : newest), touching[0].ts);
}

/** The wording the graph carries now, per node — what an anchor is compared to. */
function contentByNode(model: CurriculumModel): Map<string, string> {
  const out = new Map<string, string>();
  for (const node of model.rawGraph?.nodes ?? []) {
    const content = (node.properties as Record<string, unknown> | undefined)?.content;
    if (typeof content === "string") out.set(node.id, content);
  }
  return out;
}

function summarise(rows: DocumentFreshness[], counts: Counts): string | undefined {
  const stale = rows.filter((row) => row.state === "stale").length;
  const behind = rows.filter((row) => row.olderThanGraph).length;
  const unknown = counts.unknown;
  if (!stale && !behind && !unknown) return undefined;

  const parts: string[] = [];
  if (stale) {
    parts.push(`${stale} document(s) covering this material quote curriculum that has CHANGED since they were produced`);
  }
  if (behind) {
    parts.push(`${behind} document(s) predate the last graph edit to what they cover (see lastGraphEdit) — they record no sources, so this is a timestamp, not a content comparison`);
  }
  if (unknown - behind > 0) {
    parts.push(`${unknown - behind} document(s) record no sources and show no later edit, so their state cannot be established`);
  }
  return (
    `${parts.join("; ")}. Do not compose against one of these without checking it first: a document that is behind the graph ` +
    `will quote decisions that have been superseded, and nothing in its own text says so. Re-render it (render_document), or ` +
    `read it (get_document_text) and confirm the part you are relying on.`
  );
}

/*
 * The freshness of every produced document covering any of `nodeIds`.
 *
 * Gated on `readDocuments` because that is what it reads. It uses `authorize`
 * directly rather than `denyUnlessMember`: a non-member doing an OPEN curriculum
 * read has done nothing wrong, and writing a "blocked" audit record on every
 * such read would bury the real refusals.
 */
export async function freshnessFor(
  namespace: string, model: CurriculumModel, nodeIds: readonly string[],
): Promise<Freshness | undefined> {
  if (nodeIds.length === 0) return undefined;   // front matter covers nothing

  if (!authorize(currentActor(), "readDocuments", namespace).ok) {
    return {
      unavailable:
        "Whether the documents covering this material are out of date needs a ROLE in this workspace — the published curriculum is open, its generated documents are not.",
    };
  }

  const wanted = new Set(nodeIds);
  let entries: HistoryEntry[];
  try {
    entries = (await listEntries()).filter((entry) => wanted.has(entry.nodeId));
  } catch {
    return undefined;   // no history to read is not a reason to fail the read
  }
  if (entries.length === 0) return undefined;

  const content = contentByNode(model);
  const counts = { current: 0, stale: 0, unknown: 0 };
  const rows: DocumentFreshness[] = [];

  for (const entry of entries) {
    const state = staleness(entry.sources, content);
    const base: DocumentFreshness = {
      relPath: entry.relPath,
      nodeId: entry.nodeId,
      updated: entry.updated,
      ...(entry.documentId !== undefined ? { documentId: entry.documentId } : {}),
      ...(entry.variant !== undefined ? { variant: entry.variant } : {}),
      state: state.state,
    };

    if (state.state === "current") { counts.current += 1; continue; }   // reported only in the counts

    if (state.state === "stale") {
      counts.stale += 1;
      rows.push({ ...base, changed: state.changed, removed: state.removed });
      continue;
    }

    counts.unknown += 1;
    // The audit fallback, for this bucket only. A file with no mtime cannot be
    // compared to anything, so it stays a plain unknown.
    const lastEdit = entry.updated ? await lastEditAfter(namespace, entry.nodeId, entry.updated) : null;
    rows.push(lastEdit ? { ...base, lastGraphEdit: lastEdit, olderThanGraph: true } : base);
  }

  return { counts, documents: rows, note: summarise(rows, counts) };
}
