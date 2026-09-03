/*
 * Module: storage · internal
 *
 * The history is the cache of record: one entry per generated document, keyed by
 * the graph node it covers (`nodeId`). It stores the md5 and the extracted
 * content so a tracked document is never re-parsed. This file owns
 * loading/saving it, upserts (record_document_content / log_generation), and
 * reconcile() — the diff of the bucket against history. reconcile no longer
 * classifies filenames: it diffs by relPath and reports untracked docs for the
 * curator to link to a node (see docs/design-notes/graph-linked-documents.md).
 */
import { getStorageAdapter, getHistCache, setHistCache } from "./adapter.js";
import { discoverDocuments } from "./documents.js";
import type { HistoryFile, HistoryEntry, DocumentContent } from "../types.js";

const EMPTY: HistoryFile = { version: 3, entries: [] };

async function histLoad(): Promise<HistoryFile> {
  const cached = getHistCache();
  if (cached) return cached;
  const raw = await getStorageAdapter().readHistory();
  // A pre-node-keyed (v2) history was keyed by (unit, deliverable); it can't be
  // mapped to node ids without the graph, so we ignore it and start fresh — the
  // bucket objects then re-surface via reconcile as untracked for re-linking.
  const isCurrent = raw != null && raw.version === 3;
  if (raw != null && !isCurrent) console.error("[history] ignoring a legacy (pre-nodeId) history file — run reconcile to re-link documents to their nodes");
  const loaded = isCurrent ? raw : { ...EMPTY, entries: [] };
  setHistCache(loaded);
  return loaded;
}

async function histSave() { await getStorageAdapter().writeHistory(await histLoad()); }

// Ordered by node id — a stable total order storage can produce without knowing
// graph ordinals. Callers that want ordinal order (list_documents) resolve each
// node's ordinal from the active model and re-sort.
export async function listEntries() {
  return [...(await histLoad()).entries].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
}

export async function getEntry(nodeId: string) {
  return (await histLoad()).entries.find((e) => e.nodeId === nodeId);
}

async function histUpsert(entry: HistoryEntry) {
  const h = await histLoad();
  const i = h.entries.findIndex((e) => e.nodeId === entry.nodeId);
  if (i >= 0) h.entries[i] = entry; else h.entries.push(entry);
  await histSave();
}

/*
 * Refuse to REPLACE a different document silently.
 *
 * History holds one entry per node, so recording a second FILE against a node
 * that already has one does not add — it overwrites, content record and all,
 * with no draft and no undo. And `reconcile` walks a caller straight into it:
 * it reports every unrecorded object and says to link each one, which on this
 * graph means 152 objects against nodes that already hold an entry. Each CI
 * maths lesson has four files (pupil FR, pupil WO, illustration dossier,
 * teacher sheet) and room for one.
 *
 * Re-recording the SAME relPath is an update, not a replacement, and stays
 * allowed — that is how a changed document is re-linked after an edit.
 *
 * This does not decide how a node should hold several documents; it stops the
 * unrecoverable write while that is decided. See docs/design-notes/
 * graph-linked-documents.md.
 */
async function replacementRefusal(nodeId: string, relPath: string): Promise<{ error: string } | null> {
  const existing = await getEntry(nodeId);
  if (!existing || existing.relPath === relPath) {
    return null;
  }
  return {
    error:
      `This node already has a recorded document: '${existing.relPath}' (recorded ${existing.recordedAt}, source '${existing.source}'). ` +
      `History keeps ONE entry per node, so recording '${relPath}' here would REPLACE it — including its stored content record — and there is no undo. ` +
      `If '${relPath}' is a different document (another language, another kind of sheet), it needs its own scope node or its own entry; do not overwrite. ` +
      `If it genuinely supersedes the recorded one, call again with replace: true.`,
  };
}

export async function recordContent(
  source: "pipeline" | "parsed",
  input: { nodeId: string; relPath: string; content: DocumentContent; replace?: boolean },
) {
  if (!input.replace) {
    const refusal = await replacementRefusal(input.nodeId, input.relPath);
    if (refusal) {
      return refusal;
    }
  }

  const md5 = await getStorageAdapter().getObjectMd5(input.relPath);
  if (md5 == null) {
    return { error: `Object not found in the bucket at documents/${input.relPath}. Upload it first via create_upload_url, then call this again.` };
  }
  const now = new Date().toISOString();
  const entry: HistoryEntry = {
    id: input.nodeId, nodeId: input.nodeId, relPath: input.relPath, md5,
    updated: now, source, recordedAt: now, content: input.content,
  };
  await histUpsert(entry);
  return entry;
}

// Discover-only reconcile: list the bucket's .docx objects and diff against
// history BY relPath. An entry is tracked when its object is present + unchanged,
// dropped when its object is gone, and reported as untracked (changed) when the
// object's bytes differ. Any bucket object with no history entry is untracked
// (new) — the curator links it to a node via record_document_content.
export async function reconcile() {
  const h = await histLoad();
  const discovered = await discoverDocuments();
  const byPath = new Map(discovered.map((d) => [d.relPath, d]));

  const result = {
    tracked: [] as { nodeId: string; relPath: string }[],
    untracked: [] as { relPath: string; md5: string | null; reason: "new" | "changed" }[],
    dropped: [] as string[],   // nodeIds whose object is gone
  };

  const knownPaths = new Set<string>();
  const survivors: HistoryEntry[] = [];
  for (const e of h.entries) {
    const obj = byPath.get(e.relPath);
    if (!obj) { result.dropped.push(e.nodeId); continue; }   // object gone → drop the stale entry
    survivors.push(e);
    knownPaths.add(e.relPath);
    if (obj.md5 && obj.md5 === e.md5) result.tracked.push({ nodeId: e.nodeId, relPath: e.relPath });
    else result.untracked.push({ relPath: e.relPath, md5: obj.md5, reason: "changed" });
  }
  for (const d of discovered) {
    if (!knownPaths.has(d.relPath)) result.untracked.push({ relPath: d.relPath, md5: d.md5, reason: "new" });
  }

  if (survivors.length !== h.entries.length) { h.entries = survivors; await histSave(); }
  return result;
}
