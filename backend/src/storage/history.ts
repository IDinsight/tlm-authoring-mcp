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

const EMPTY: HistoryFile = { version: 4, entries: [] };

// A v3 history was keyed by the covered node, one entry per node. Every field it
// held survives the move to file-keyed: the entry keeps its relPath, its covered
// nodeId and its whole content record, and only its `id` changes. So v3 is
// MIGRATED, never ignored — dropping it would discard 60 content records of real
// authored work, which is the loss this whole change exists to prevent.
//
// documentId and variant are left UNSET on a migrated entry. They could only be
// guessed from the file's path, and classifying documents by filename is exactly
// what this module moved away from; they fill in when a file is next recorded.
function migrateFromNodeKeyed(raw: { entries: HistoryEntry[] }): HistoryFile {
  // The v3 key was the covered node, so nothing stopped two nodes recording the
  // SAME file — one teacher sheet linked to a lesson and to its chapter, say.
  // Re-keying by relPath would then mint two entries sharing one key: upsert
  // would reach only the first, listEntries would report the file twice, and
  // getEntry would answer with whichever happened to be first. Collapse them,
  // keeping the most recently recorded, so the new key is genuinely unique.
  const byPath = new Map<string, HistoryEntry>();
  for (const entry of raw.entries) {
    const existing = byPath.get(entry.relPath);
    if (!existing || entry.recordedAt > existing.recordedAt) {
      byPath.set(entry.relPath, entry);
    }
  }
  const dropped = raw.entries.length - byPath.size;
  if (dropped > 0) {
    console.error(`[history] ${dropped} migrated entry/entries shared a relPath with another; kept the most recently recorded of each`);
  }
  return {
    version: 4,
    entries: [...byPath.values()].map((entry) => ({ ...entry, id: entry.relPath })),
  };
}

async function histLoad(): Promise<HistoryFile> {
  const cached = getHistCache();
  if (cached) return cached;
  const raw = await getStorageAdapter().readHistory();

  let loaded: HistoryFile;
  if (raw != null && raw.version === 4) {
    loaded = raw;
  } else if (raw != null && (raw as { version: number }).version === 3) {
    loaded = migrateFromNodeKeyed(raw as unknown as { entries: HistoryEntry[] });
    console.error(`[history] migrated ${loaded.entries.length} node-keyed entries to file-keyed; each keeps its content record`);
  } else {
    // A v2 history was keyed by (unit, deliverable) and cannot be mapped to the
    // graph at all. Its objects re-surface through reconcile as untracked.
    if (raw != null) console.error("[history] ignoring a legacy (pre-nodeId) history file — run reconcile to re-link documents");
    loaded = { ...EMPTY, entries: [] };
  }

  setHistCache(loaded);
  return loaded;
}

async function histSave() { await getStorageAdapter().writeHistory(await histLoad()); }

// Ordered by relPath — a stable total order storage can produce without knowing
// graph ordinals. Callers that want ordinal order (list_documents) resolve each
// covered node's ordinal from the active model and re-sort.
export async function listEntries() {
  return [...(await histLoad()).entries].sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/** One recorded file, by the path that identifies it. */
export async function getEntry(relPath: string) {
  return (await histLoad()).entries.find((e) => e.relPath === relPath);
}

/** Every file recorded against one curriculum node — four, on a CI-maths lesson. */
export async function entriesForNode(nodeId: string) {
  return (await histLoad()).entries.filter((e) => e.nodeId === nodeId);
}

async function histUpsert(entry: HistoryEntry) {
  const h = await histLoad();
  const i = h.entries.findIndex((e) => e.relPath === entry.relPath);
  if (i >= 0) h.entries[i] = entry; else h.entries.push(entry);
  await histSave();
}

/*
 * Refuse to silently re-point a recorded file at a DIFFERENT curriculum node.
 *
 * Now that an entry is identified by its file, recording a second file against a
 * node simply adds — the collision that used to destroy content records is gone.
 * What remains worth refusing is the other direction: re-recording an existing
 * FILE against a different node. That is a correction, not an addition, and it
 * silently moves the file out from under whatever was reading it there.
 *
 * Re-recording the same file against the same node is an ordinary update — that
 * is how a changed document is re-read after an edit — and stays allowed.
 */
async function repointRefusal(relPath: string, nodeId: string): Promise<{ error: string } | null> {
  const existing = await getEntry(relPath);
  if (!existing || existing.nodeId === nodeId) {
    return null;
  }
  return {
    error:
      `'${relPath}' is already recorded against node '${existing.nodeId}' (recorded ${existing.recordedAt}, source '${existing.source}'). ` +
      `Recording it against '${nodeId}' would MOVE it, not add it, and there is no undo. ` +
      `If this file really does cover a different node than was recorded, call again with replace: true. ` +
      `If you meant to record a DIFFERENT file, pass its own relPath — several files on one node is normal and no longer collides.`,
  };
}

export async function recordContent(
  source: "pipeline" | "parsed",
  input: {
    nodeId: string;
    relPath: string;
    content: DocumentContent;
    documentId?: string;
    variant?: string;
    replace?: boolean;
  },
) {
  if (!input.replace) {
    const refusal = await repointRefusal(input.relPath, input.nodeId);
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
    id: input.relPath, relPath: input.relPath, nodeId: input.nodeId, md5,
    updated: now, source, recordedAt: now, content: input.content,
    // Only carried when the caller knows them; a migrated entry has neither.
    ...(input.documentId !== undefined ? { documentId: input.documentId } : {}),
    ...(input.variant !== undefined ? { variant: input.variant } : {}),
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
    dropped: [] as string[],   // relPaths whose object is gone
  };

  const knownPaths = new Set<string>();
  const survivors: HistoryEntry[] = [];
  for (const e of h.entries) {
    const obj = byPath.get(e.relPath);
    if (!obj) { result.dropped.push(e.relPath); continue; }   // object gone → drop the stale entry
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
