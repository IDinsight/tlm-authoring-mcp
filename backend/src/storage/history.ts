/*
 * Module: storage · internal
 *
 * What is known about every produced file: which curriculum node it covers,
 * which document and language it is, what it was made from — and where it
 * stands (current, replaced, approved, sent back).
 *
 * The records live one per file in the record store (file-records.ts). This
 * file is the logic on top: reading them (with a copy kept while nothing has
 * changed), recording a file and marking the ones it replaces, recording a
 * person's verdict, reconciling against the bucket, and the ONE-TIME import of
 * a namespace's legacy history.json.
 *
 * Full rationale: docs/design-notes/file-status.md.
 */
import { activeNamespaceKey } from "../context/index.js";
import type { DocumentContent, FilePerson, FileStatus, FileVerdict, HistoryEntry } from "../types.js";
import { getStorageAdapter } from "./adapter.js";
import { discoverDocuments } from "./documents.js";
import { getFileRecordStore, type FileRecordStore } from "./file-records.js";
import { replacedByRecording, statusOf, verdictRefusal } from "./file-status.js";

// ── The one-time import of a legacy history.json ─────────────────────────────

// A v3 history was keyed by the covered node, one entry per node. Every field it
// held survives the move to file-keyed: the entry keeps its relPath, its covered
// nodeId and its whole content record, and only its `id` changes. So v3 is
// MIGRATED, never ignored — dropping it would discard content records of real
// authored work.
//
// documentId and variant are left UNSET on a migrated entry. They could only be
// guessed from the file's path, and classifying documents by filename is exactly
// what this module moved away from; such a file reads as "unfiled" until it is
// recorded again.
function entriesFromNodeKeyed(raw: { entries: HistoryEntry[] }): HistoryEntry[] {
  // The v3 key was the covered node, so nothing stopped two nodes recording the
  // SAME file — one teacher sheet linked to a lesson and to its chapter, say.
  // A file is one record now, so keep the most recently recorded of each.
  const byPath = new Map<string, HistoryEntry>();
  for (const entry of raw.entries) {
    const existing = byPath.get(entry.relPath);
    if (!existing || entry.recordedAt > existing.recordedAt) {
      byPath.set(entry.relPath, entry);
    }
  }

  const dropped = raw.entries.length - byPath.size;
  if (dropped > 0) {
    console.error(`[history] ${dropped} legacy entry/entries shared a relPath with another; kept the most recently recorded of each`);
  }
  return [...byPath.values()].map((entry) => ({ ...entry, id: entry.relPath }));
}

/** The entries a namespace recorded in its history.json before records moved to the store. */
async function legacyEntries(): Promise<HistoryEntry[]> {
  const raw = await getStorageAdapter().readHistory();
  if (raw == null) {
    return [];
  }
  if (raw.version === 4) {
    return raw.entries;
  }
  if ((raw as { version: number }).version === 3) {
    return entriesFromNodeKeyed(raw as unknown as { entries: HistoryEntry[] });
  }
  // A v2 history was keyed by (unit, deliverable) and cannot be mapped to the
  // graph at all. Its objects re-surface through reconcile as untracked.
  console.error("[history] ignoring a legacy (pre-nodeId) history file — run reconcile to re-link documents");
  return [];
}

// Imports in progress, per store. Two calls arriving together for a namespace
// that has never been imported must share ONE import: if each ran its own, the
// slower one would overwrite a verdict recorded just after the faster finished.
const importsInFlight = new WeakMap<FileRecordStore, Map<string, Promise<void>>>();

async function importLegacyHistory(store: FileRecordStore, namespace: string): Promise<void> {
  let entries: HistoryEntry[];
  try {
    entries = await legacyEntries();
    await store.putAll(namespace, entries);
  } catch (cause) {
    // Nothing is half-done from the caller's point of view: the marker below is
    // not written, so the next call imports again, and re-writing the same
    // records is harmless. The legacy file is only ever read.
    throw new Error(
      `Could not import the file history of '${namespace}' into the record store: ${(cause as Error).message}. ` +
      "Nothing was lost — the legacy history.json is untouched — and the next call will try again.",
    );
  }

  // Written LAST. Until it exists every call comes back through here, so no
  // verdict can be recorded on a half-imported namespace.
  await store.markLegacyImported(namespace, { importedAt: new Date().toISOString(), count: entries.length });
  console.error(`[history] imported ${entries.length} legacy entry/entries of '${namespace}' into the record store`);
}

function importLegacyOnce(store: FileRecordStore, namespace: string): Promise<void> {
  const inFlight = importsInFlight.get(store) ?? new Map<string, Promise<void>>();
  importsInFlight.set(store, inFlight);

  const running = inFlight.get(namespace);
  if (running) {
    return running;
  }

  const started = importLegacyHistory(store, namespace).finally(() => inFlight.delete(namespace));
  inFlight.set(namespace, started);
  return started;
}

// ── Reading, with a copy kept while nothing has changed ──────────────────────

type CachedRecords = { revision: string | null; entries: readonly HistoryEntry[] };

// Keyed by store, so swapping the store (every test does) starts from nothing.
// Shared by every session of the process: a namespace's records are the same
// whoever asks, and its revision says when the copy has gone stale.
const recordCache = new WeakMap<FileRecordStore, Map<string, CachedRecords>>();

/**
 * Every record of the active namespace.
 *
 * Costs one small read when nothing changed since the last call, and a full
 * read only when the namespace's revision moved — the ci/maths records weigh
 * megabytes and the production reads ask on every section.
 *
 * The entries are FROZEN: they are shared between callers, so changing one in
 * place would change it for everybody. Build a new object instead.
 */
async function currentEntries(): Promise<readonly HistoryEntry[]> {
  const store = getFileRecordStore();
  const namespace = activeNamespaceKey();

  let state = await store.state(namespace);
  if (state.legacyImport === null) {
    await importLegacyOnce(store, namespace);
    state = await store.state(namespace);
  }

  const cacheOfStore = recordCache.get(store) ?? new Map<string, CachedRecords>();
  recordCache.set(store, cacheOfStore);

  const cached = cacheOfStore.get(namespace);
  if (cached && cached.revision === state.revision) {
    return cached.entries;
  }

  const listed = await store.list(namespace);
  const entries = listed.map((entry) => Object.freeze(entry));
  cacheOfStore.set(namespace, { revision: state.revision, entries });
  return entries;
}

// Ordered by relPath — a stable total order storage can produce without knowing
// graph ordinals. Callers that want ordinal order (list_documents) resolve each
// covered node's ordinal from the active model and re-sort.
export async function listEntries(): Promise<HistoryEntry[]> {
  const entries = await currentEntries();
  return [...entries].sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/** One recorded file, by the path that identifies it. */
export async function getEntry(relPath: string): Promise<HistoryEntry | undefined> {
  const entries = await currentEntries();
  return entries.find((entry) => entry.relPath === relPath);
}

/** Every file recorded against one curriculum node — four, on a CI-maths lesson. */
export async function entriesForNode(nodeId: string): Promise<HistoryEntry[]> {
  const entries = await currentEntries();
  return entries.filter((entry) => entry.nodeId === nodeId);
}

// ── Recording a file ─────────────────────────────────────────────────────────

/*
 * Refuse to silently re-point a recorded file at a DIFFERENT curriculum node.
 *
 * Recording a second file against a node simply adds. What is worth refusing is
 * the other direction: re-recording an existing FILE against a different node.
 * That is a correction, not an addition, and it silently moves the file out
 * from under whatever was reading it there.
 *
 * Re-recording the same file against the same node is an ordinary update — that
 * is how a changed document is re-read after an edit — and stays allowed.
 */
function repointRefusal(existing: HistoryEntry | undefined, relPath: string, nodeId: string): { error: string } | null {
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

/** A recorded file, and the older files it took the place of. */
export type RecordedFile = {
  entry: HistoryEntry;
  status: FileStatus;
  replaced: string[];         // relPaths now marked replaced by this file
};

export async function recordContent(
  source: "pipeline" | "parsed",
  input: {
    nodeId: string;
    relPath: string;
    content: DocumentContent;
    documentId?: string;
    variant?: string;
    replace?: boolean;
    sources?: { nodeId: string; hash: string }[];
    recordedBy?: FilePerson;
  },
): Promise<RecordedFile | { error: string }> {
  const existingEntries = await currentEntries();
  const previous = existingEntries.find((entry) => entry.relPath === input.relPath);

  if (!input.replace) {
    const refusal = repointRefusal(previous, input.relPath, input.nodeId);
    if (refusal) {
      return refusal;
    }
  }

  const md5 = await getStorageAdapter().getObjectMd5(input.relPath);
  if (md5 == null) {
    return { error: `Object not found in the bucket at documents/${input.relPath}. Upload it first via create_upload_url, then call this again.` };
  }

  // A verdict is about exact bytes. Re-recording the SAME bytes (to correct the
  // content record, say) keeps it; new bytes under the same path start again.
  const verdictStillApplies = previous?.review !== undefined && previous.review.md5 === md5;

  const now = new Date().toISOString();
  const entry: HistoryEntry = {
    id: input.relPath, relPath: input.relPath, nodeId: input.nodeId, md5,
    updated: now, source, recordedAt: now, content: input.content,
    // Only carried when the caller knows them; a migrated entry has neither.
    ...(input.documentId !== undefined ? { documentId: input.documentId } : {}),
    ...(input.variant !== undefined ? { variant: input.variant } : {}),
    ...(input.sources?.length ? { sources: input.sources } : {}),
    ...(input.recordedBy ? { recordedBy: input.recordedBy } : {}),
    ...(verdictStillApplies ? { review: previous.review } : {}),
  };

  // The older files of the same lesson, document and language stop being the
  // current one. They are written in the same change as the newcomer, so there
  // is never a moment with two current files, or with none.
  const nowReplaced = replacedByRecording(entry, existingEntries).map((older) => ({
    ...older,
    replacedBy: entry.relPath,
    replacedAt: now,
  }));

  await getFileRecordStore().putAll(activeNamespaceKey(), [entry, ...nowReplaced]);

  return {
    entry,
    status: statusOf(entry),
    replaced: nowReplaced.map((older) => older.relPath),
  };
}

// ── Recording a person's verdict ─────────────────────────────────────────────

/** One file's verdict, as recorded. */
export type FileVerdictResult = {
  relPath: string;
  nodeId: string;
  md5: string;
  statusBefore: FileStatus;
  status: FileStatus;
};

/** Why one file could not take a verdict. */
export type FileVerdictRefusal = { relPath: string; reason: string };

/**
 * Record one verdict on several files — "approve the four files of lesson 23".
 *
 * ALL OR NOTHING: if any file cannot take the verdict, none is written and
 * every refusal comes back, so a caller never has to work out which half ran.
 *
 * `dryRun` runs every check and returns what WOULD be recorded, writing
 * nothing — what the person is shown before they confirm.
 */
export async function recordVerdicts(input: {
  relPaths: string[];
  verdict: FileVerdict;
  by: FilePerson;
  note?: string;
  dryRun?: boolean;
}): Promise<{ recorded: FileVerdictResult[] } | { refused: FileVerdictRefusal[] }> {
  const entries = await currentEntries();
  const storage = getStorageAdapter();

  const refused: FileVerdictRefusal[] = [];
  const updated: HistoryEntry[] = [];
  const recorded: FileVerdictResult[] = [];
  const now = new Date().toISOString();

  for (const relPath of input.relPaths) {
    const entry = entries.find((candidate) => candidate.relPath === relPath);
    if (!entry) {
      refused.push({ relPath, reason: `No file is recorded at '${relPath}' in namespace '${activeNamespaceKey()}'. list_documents shows the recorded paths.` });
      continue;
    }

    const notCurrent = verdictRefusal(entry);
    if (notCurrent) {
      refused.push({ relPath, reason: notCurrent });
      continue;
    }

    // The verdict is on the bytes that were RECORDED. If the object in the
    // bucket has been uploaded again since, the person has not seen what the
    // record describes — or the record does not describe what they saw.
    const bucketMd5 = await storage.getObjectMd5(relPath);
    if (bucketMd5 !== entry.md5) {
      const what = bucketMd5 == null ? "is gone from the bucket" : "has been uploaded again since it was recorded";
      refused.push({ relPath, reason: `'${relPath}' ${what}, so a verdict would be on a file nobody recorded. Record it again (log_generation), then give the verdict.` });
      continue;
    }

    const review = {
      verdict: input.verdict,
      by: input.by,
      at: now,
      md5: entry.md5,
      ...(input.note ? { note: input.note } : {}),
    };
    const withVerdict: HistoryEntry = { ...entry, review };

    updated.push(withVerdict);
    recorded.push({
      relPath,
      nodeId: entry.nodeId,
      md5: entry.md5,
      statusBefore: statusOf(entry),
      status: statusOf(withVerdict),
    });
  }

  if (refused.length > 0) {
    return { refused };
  }

  if (!input.dryRun) {
    await getFileRecordStore().putAll(activeNamespaceKey(), updated);
  }
  return { recorded };
}

// ── Reconciling against the bucket ───────────────────────────────────────────

// Discover-only reconcile: list the bucket's .docx objects and diff against the
// records BY relPath. A record is tracked when its object is present + unchanged,
// dropped when its object is gone, and reported as untracked (changed) when the
// object's bytes differ. Any bucket object with no record is untracked (new) —
// the curator links it to a node via record_document_content.
export async function reconcile() {
  const entries = await currentEntries();
  const discovered = await discoverDocuments();
  const byPath = new Map(discovered.map((doc) => [doc.relPath, doc]));

  const result = {
    tracked: [] as { nodeId: string; relPath: string }[],
    untracked: [] as { relPath: string; md5: string | null; reason: "new" | "changed" }[],
    dropped: [] as string[],   // relPaths whose object is gone
    dropSkipped: undefined as string | undefined,
  };

  const knownPaths = new Set<string>();
  const gone: string[] = [];
  for (const entry of entries) {
    const object = byPath.get(entry.relPath);
    if (!object) {
      gone.push(entry.relPath);
      continue;
    }
    knownPaths.add(entry.relPath);
    if (object.md5 && object.md5 === entry.md5) {
      result.tracked.push({ nodeId: entry.nodeId, relPath: entry.relPath });
    } else {
      result.untracked.push({ relPath: entry.relPath, md5: object.md5, reason: "changed" });
    }
  }

  for (const doc of discovered) {
    if (!knownPaths.has(doc.relPath)) {
      result.untracked.push({ relPath: doc.relPath, md5: doc.md5, reason: "new" });
    }
  }

  // Every recorded file missing at once is far more likely a listing pointed at
  // the wrong place than a bucket emptied on purpose, and a dropped record does
  // not come back. So that one case is reported and left alone.
  const everythingGone = entries.length > 0 && discovered.length === 0;
  if (everythingGone) {
    result.dropSkipped =
      `The bucket lists NO documents for this namespace while ${entries.length} file(s) are recorded. ` +
      "Nothing was dropped: check the active namespace first. Records are only dropped when some documents are still there.";
    return result;
  }

  if (gone.length > 0) {
    await getFileRecordStore().removeAll(activeNamespaceKey(), gone);
    result.dropped = gone;
  }
  return result;
}
