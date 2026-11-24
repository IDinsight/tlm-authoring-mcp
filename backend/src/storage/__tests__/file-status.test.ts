/*
 * Where a produced file stands.
 *
 * Before this, the file list could not say which of two files for one lesson was
 * the one in use, and nothing recorded that a person had accepted a file. Live,
 * lesson 56 held two different French pupil files side by side, and its Wolof
 * file was older than the French it was supposed to match.
 *
 * These tests pin: a newer file replaces the older one of the same lesson,
 * document and language (and nothing else); a verdict is a person's, tied to
 * the exact bytes; and a namespace's legacy history.json is imported once.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { activeNamespaceKey, newSessionState, runInSession } from "../../context/index.js";
import { kgNamespace } from "../../kg-store/index.js";
import {
  __setFileRecordStoreForTest, __setStorageForTest, countByStatus, createMemoryFileRecordStore, getEntry,
  getFileRecordStore, isCurrent, listEntries, recordContent, recordVerdicts, reconcile, statusOf,
  type FileRecordStore,
} from "../index.js";
import { replacedByRecording } from "../file-status.js";
import type { FilePerson, HistoryEntry, HistoryFile, StorageAdapter } from "../../types.js";

const LESSON = "lesson-23";
const OTHER_LESSON = "lesson-24";
const PUPIL_BOOK = "doc-pupil-book";
const TEACHER_GUIDE = "doc-teacher-guide";

const PUPIL_FR_OLD = "lecon_23/V2-Lecon-23-ancien-FR.docx";
const PUPIL_FR_NEW = "lecon_23/V2-Lecon-23-FR.docx";
const PUPIL_WO = "lecon_23/V2-Lecon-23-WO.docx";
const GUIDE_FR = "lecon_23/Guide-Lecon-23-FR.docx";

const AWA: FilePerson = { id: "awa-uid", email: "awa@test" };

function entry(overrides: Partial<HistoryEntry>): HistoryEntry {
  const relPath = overrides.relPath ?? PUPIL_FR_NEW;
  return {
    id: relPath, relPath, nodeId: LESSON, md5: `md5-of-${relPath}`,
    updated: "2026-11-01T00:00:00Z", source: "pipeline", recordedAt: "2026-11-01T00:00:00Z",
    content: { summary: "x" },
    documentId: PUPIL_BOOK, variant: "FR",
    ...overrides,
  };
}

// ── The rules, with no store ─────────────────────────────────────────────────

describe("statusOf — where a file stands, read off its own record", () => {
  it("is 'produced' for a filed file nobody has given a verdict on", () => {
    expect(statusOf(entry({}))).toBe("produced");
  });

  it("is 'unfiled' when the record names no document, or no language", () => {
    expect(statusOf(entry({ documentId: undefined }))).toBe("unfiled");
    expect(statusOf(entry({ variant: undefined }))).toBe("unfiled");
  });

  it("is the person's verdict while it is on the bytes recorded", () => {
    const approved = entry({ review: { verdict: "approved", by: AWA, at: "t", md5: `md5-of-${PUPIL_FR_NEW}` } });
    const sentBack = entry({ review: { verdict: "changes_requested", by: AWA, at: "t", md5: `md5-of-${PUPIL_FR_NEW}`, note: "le signe" } });

    expect(statusOf(approved)).toBe("approved");
    expect(statusOf(sentBack)).toBe("changes_requested");
  });

  it("goes back to 'produced' when the verdict was on OTHER bytes", () => {
    // The file was uploaded again under the same path: nobody approved these bytes.
    const reuploaded = entry({ md5: "new-bytes", review: { verdict: "approved", by: AWA, at: "t", md5: "old-bytes" } });

    expect(statusOf(reuploaded)).toBe("produced");
  });

  it("stays 'replaced' even if it had been approved — the approval was of a file no longer in use", () => {
    const replacedAfterApproval = entry({
      replacedBy: PUPIL_FR_NEW, replacedAt: "t",
      review: { verdict: "approved", by: AWA, at: "t", md5: `md5-of-${PUPIL_FR_NEW}` },
    });

    expect(statusOf(replacedAfterApproval)).toBe("replaced");
    expect(isCurrent(replacedAfterApproval)).toBe(false);
  });

  it("counts every status, zeros included, so a caller can print a full line", () => {
    const counts = countByStatus([entry({}), entry({ documentId: undefined }), entry({ replacedBy: "x" })]);

    expect(counts).toEqual({ unfiled: 1, replaced: 1, produced: 1, changes_requested: 0, approved: 0 });
  });
});

describe("replacedByRecording — which older files a new one takes the place of", () => {
  const older = entry({ relPath: PUPIL_FR_OLD });
  const newcomer = entry({ relPath: PUPIL_FR_NEW });

  it("replaces the older file of the same lesson, document and language", () => {
    expect(replacedByRecording(newcomer, [older]).map((file) => file.relPath)).toEqual([PUPIL_FR_OLD]);
  });

  it("leaves another language, another document and another lesson alone", () => {
    const wolof = entry({ relPath: PUPIL_WO, variant: "WO" });
    const guide = entry({ relPath: GUIDE_FR, documentId: TEACHER_GUIDE });
    const nextLesson = entry({ relPath: "lecon_24/V2-FR.docx", nodeId: OTHER_LESSON });

    expect(replacedByRecording(newcomer, [wolof, guide, nextLesson])).toEqual([]);
  });

  it("never replaces an unfiled file — it does not say which document it is", () => {
    const unfiled = entry({ relPath: PUPIL_FR_OLD, documentId: undefined, variant: undefined });

    expect(replacedByRecording(newcomer, [unfiled])).toEqual([]);
  });

  it("replaces nothing when the newcomer itself is unfiled", () => {
    const unfiledNewcomer = entry({ relPath: PUPIL_FR_NEW, documentId: undefined });

    expect(replacedByRecording(unfiledNewcomer, [older])).toEqual([]);
  });

  it("does not mark a file that is already replaced a second time", () => {
    const alreadyReplaced = entry({ relPath: PUPIL_FR_OLD, replacedBy: "an-earlier-newcomer.docx" });

    expect(replacedByRecording(newcomer, [alreadyReplaced])).toEqual([]);
  });
});

// ── With a store and a bucket ────────────────────────────────────────────────

// A bucket where every file exists with a stable hash, unless `md5Of` says
// otherwise. `legacy` plants a history.json, read once by the import.
function bucket(options: { legacy?: unknown; md5Of?: (relPath: string) => string | null; paths?: string[] } = {}): StorageAdapter & { historyReads: () => number } {
  let reads = 0;
  const md5Of = options.md5Of ?? ((relPath: string) => `md5-of-${relPath}`);
  return {
    listDocuments: async () => (options.paths ?? []).map((relPath) => ({ relPath, md5: md5Of(relPath), updated: null })),
    getObjectMd5: async (relPath) => md5Of(relPath),
    downloadDocx: async () => Buffer.from(""),
    createUploadUrl: async () => ({ url: "", objectKey: "", contentType: "", expiresAt: "" }),
    createDownloadUrl: async () => ({ url: "", objectKey: "", expiresAt: "", exists: false }),
    readHistory: async () => { reads += 1; return (options.legacy as HistoryFile | undefined) ?? null; },
    historyReads: () => reads,
  };
}

function inNamespace<T>(context: { grade: string; subject: string }, fn: () => Promise<T>): Promise<T> {
  const state = newSessionState();
  state.active = { workspace: "senegal", ...context };
  return runInSession(state, fn);
}
const inMaths = <T>(fn: () => Promise<T>): Promise<T> => inNamespace({ grade: "ci", subject: "maths" }, fn);
const inReading = <T>(fn: () => Promise<T>): Promise<T> => inNamespace({ grade: "ce1", subject: "reading" }, fn);

const pupilFrench = (relPath: string) => ({ nodeId: LESSON, relPath, content: { summary: "x" }, documentId: PUPIL_BOOK, variant: "FR" });

beforeEach(() => { __setStorageForTest(bucket()); });

describe("recording a file", () => {
  it("makes it the current file and marks the older one replaced, naming what replaced it", async () => {
    const result = await inMaths(async () => {
      await recordContent("pipeline", pupilFrench(PUPIL_FR_OLD));
      const recorded = await recordContent("pipeline", pupilFrench(PUPIL_FR_NEW));
      return { recorded, older: await getEntry(PUPIL_FR_OLD), newer: await getEntry(PUPIL_FR_NEW) };
    });

    expect(result.recorded).toMatchObject({ status: "produced", replaced: [PUPIL_FR_OLD] });
    expect(statusOf(result.older!)).toBe("replaced");
    expect(result.older!.replacedBy).toBe(PUPIL_FR_NEW);
    expect(statusOf(result.newer!)).toBe("produced");
  });

  it("keeps the Wolof file and the teacher's guide current when the French pupil file is redone", async () => {
    const statuses = await inMaths(async () => {
      await recordContent("pipeline", pupilFrench(PUPIL_FR_OLD));
      await recordContent("pipeline", { ...pupilFrench(PUPIL_WO), variant: "WO" });
      await recordContent("pipeline", { ...pupilFrench(GUIDE_FR), documentId: TEACHER_GUIDE });
      await recordContent("pipeline", pupilFrench(PUPIL_FR_NEW));
      const entries = await listEntries();
      return Object.fromEntries(entries.map((file) => [file.relPath, statusOf(file)]));
    });

    expect(statuses).toEqual({
      [PUPIL_FR_OLD]: "replaced",
      [PUPIL_FR_NEW]: "produced",
      [PUPIL_WO]: "produced",
      [GUIDE_FR]: "produced",
    });
  });

  it("records who delivered it", async () => {
    const recorded = await inMaths(async () => {
      await recordContent("pipeline", { ...pupilFrench(PUPIL_FR_NEW), recordedBy: AWA });
      return getEntry(PUPIL_FR_NEW);
    });

    expect(recorded?.recordedBy).toEqual(AWA);
  });

  it("is 'unfiled', and replaces nothing, when it names no document or language", async () => {
    const result = await inMaths(async () => {
      await recordContent("pipeline", pupilFrench(PUPIL_FR_OLD));
      return recordContent("pipeline", { nodeId: LESSON, relPath: PUPIL_FR_NEW, content: { summary: "x" } });
    });

    expect(result).toMatchObject({ status: "unfiled", replaced: [] });
  });
});

describe("a person's verdict", () => {
  const approve = (relPaths: string[], extra: { dryRun?: boolean } = {}) =>
    recordVerdicts({ relPaths, verdict: "approved", by: AWA, ...extra });

  it("approves the current file, in the person's name, on the bytes recorded", async () => {
    const approved = await inMaths(async () => {
      await recordContent("pipeline", pupilFrench(PUPIL_FR_NEW));
      await approve([PUPIL_FR_NEW]);
      return getEntry(PUPIL_FR_NEW);
    });

    expect(statusOf(approved!)).toBe("approved");
    expect(approved!.review).toMatchObject({ verdict: "approved", by: AWA, md5: `md5-of-${PUPIL_FR_NEW}` });
  });

  it("is lost when the file is recorded again with new bytes, and kept when the bytes are the same", async () => {
    let bytes = "first-bytes";
    __setStorageForTest(bucket({ md5Of: () => bytes }));

    const statuses = await inMaths(async () => {
      await recordContent("pipeline", pupilFrench(PUPIL_FR_NEW));
      await approve([PUPIL_FR_NEW]);

      await recordContent("parsed", pupilFrench(PUPIL_FR_NEW));          // same bytes: a corrected content record
      const afterSameBytes = statusOf((await getEntry(PUPIL_FR_NEW))!);

      bytes = "second-bytes";                                             // the file was produced again
      await recordContent("pipeline", pupilFrench(PUPIL_FR_NEW));
      const afterNewBytes = statusOf((await getEntry(PUPIL_FR_NEW))!);

      return { afterSameBytes, afterNewBytes };
    });

    expect(statuses).toEqual({ afterSameBytes: "approved", afterNewBytes: "produced" });
  });

  it("refuses a replaced file and names the file to judge instead", async () => {
    const outcome = await inMaths(async () => {
      await recordContent("pipeline", pupilFrench(PUPIL_FR_OLD));
      await recordContent("pipeline", pupilFrench(PUPIL_FR_NEW));
      return approve([PUPIL_FR_OLD]);
    });

    const [refusal] = (outcome as { refused: { relPath: string; reason: string }[] }).refused;
    expect(refusal.relPath).toBe(PUPIL_FR_OLD);
    expect(refusal.reason).toContain(PUPIL_FR_NEW);
  });

  it("refuses an unfiled file, a path nobody recorded, and a file whose bytes changed in the bucket", async () => {
    let bucketBytes = "recorded-bytes";
    __setStorageForTest(bucket({ md5Of: (relPath) => (relPath === PUPIL_WO ? bucketBytes : `md5-of-${relPath}`) }));

    const outcome = await inMaths(async () => {
      await recordContent("pipeline", { nodeId: LESSON, relPath: PUPIL_FR_OLD, content: { summary: "x" } });   // unfiled
      await recordContent("pipeline", { ...pupilFrench(PUPIL_WO), variant: "WO" });
      bucketBytes = "uploaded-again";                                                                        // nobody recorded these
      return approve([PUPIL_FR_OLD, "lecon_23/jamais-enregistre.docx", PUPIL_WO]);
    });

    const reasons = (outcome as { refused: { reason: string }[] }).refused.map((refusal) => refusal.reason);
    expect(reasons[0]).toContain("does not say which document");
    expect(reasons[1]).toContain("No file is recorded");
    expect(reasons[2]).toContain("uploaded again since it was recorded");
  });

  it("is all or nothing: one refusal means no file takes the verdict", async () => {
    const status = await inMaths(async () => {
      await recordContent("pipeline", pupilFrench(PUPIL_FR_NEW));
      await approve([PUPIL_FR_NEW, "lecon_23/jamais-enregistre.docx"]);
      return statusOf((await getEntry(PUPIL_FR_NEW))!);
    });

    expect(status).toBe("produced");
  });

  it("writes nothing on a dry run, and says what it would record", async () => {
    const result = await inMaths(async () => {
      await recordContent("pipeline", pupilFrench(PUPIL_FR_NEW));
      const plan = await approve([PUPIL_FR_NEW], { dryRun: true });
      return { plan, status: statusOf((await getEntry(PUPIL_FR_NEW))!) };
    });

    expect(result.plan).toEqual({
      recorded: [{ relPath: PUPIL_FR_NEW, nodeId: LESSON, md5: `md5-of-${PUPIL_FR_NEW}`, statusBefore: "produced", status: "approved" }],
    });
    expect(result.status).toBe("produced");
  });

  it("lets a later verdict replace an earlier one", async () => {
    const status = await inMaths(async () => {
      await recordContent("pipeline", pupilFrench(PUPIL_FR_NEW));
      await approve([PUPIL_FR_NEW]);
      await recordVerdicts({ relPaths: [PUPIL_FR_NEW], verdict: "changes_requested", by: AWA, note: "le signe de l'activité 2" });
      return statusOf((await getEntry(PUPIL_FR_NEW))!);
    });

    expect(status).toBe("changes_requested");
  });
});

describe("the one-time import of a legacy history.json", () => {
  const legacy: HistoryFile = { version: 4, entries: [entry({ relPath: PUPIL_FR_OLD }), entry({ relPath: PUPIL_WO, variant: "WO" })] };

  it("brings every entry across on the first read, and never reads the file again", async () => {
    const storage = bucket({ legacy });
    __setStorageForTest(storage);

    const counts = await inMaths(async () => {
      const first = await listEntries();
      await listEntries();
      await getEntry(PUPIL_WO);
      return first.length;
    });

    expect(counts).toBe(2);
    expect(storage.historyReads()).toBe(1);
  });

  it("does not run again and undo a verdict recorded after it", async () => {
    __setStorageForTest(bucket({ legacy }));

    const status = await inMaths(async () => {
      await recordVerdicts({ relPaths: [PUPIL_WO], verdict: "approved", by: AWA });
      await listEntries();
      return statusOf((await getEntry(PUPIL_WO))!);
    });

    expect(status).toBe("approved");
  });

  it("shares ONE import between two calls that arrive together", async () => {
    const storage = bucket({ legacy });
    __setStorageForTest(storage);

    const [first, second] = await inMaths(() => Promise.all([listEntries(), listEntries()]));

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(storage.historyReads()).toBe(1);
  });

  it("retries on the next call when the store refused the import, leaving nothing half-marked", async () => {
    __setStorageForTest(bucket({ legacy }));
    const working = createMemoryFileRecordStore();
    let refuseWrites = true;
    const flaky: FileRecordStore = {
      ...working,
      putAll: async (namespace, records) => {
        if (refuseWrites) {
          throw new Error("the database said no");
        }
        return working.putAll(namespace, records);
      },
    };
    __setFileRecordStoreForTest(flaky);

    const outcome = await inMaths(async () => {
      const firstError = await listEntries().then(() => null, (error: Error) => error.message);
      const stateAfterFailure = await flaky.state(activeNamespaceKey());
      refuseWrites = false;
      const afterRetry = await listEntries();
      return { firstError, stateAfterFailure, afterRetry: afterRetry.length };
    });

    expect(outcome.firstError).toContain("the database said no");
    expect(outcome.firstError).toContain("legacy history.json is untouched");
    expect(outcome.stateAfterFailure.legacyImport).toBeNull();
    expect(outcome.afterRetry).toBe(2);
  });
});

describe("reading the records", () => {
  it("does not fetch them again while nothing has changed, and does once something has", async () => {
    const working = createMemoryFileRecordStore();
    let listCalls = 0;
    const counting: FileRecordStore = {
      ...working,
      list: async (namespace) => { listCalls += 1; return working.list(namespace); },
    };
    __setFileRecordStoreForTest(counting);

    const calls = await inMaths(async () => {
      await listEntries();
      await listEntries();
      await getEntry(PUPIL_FR_NEW);
      const whileUnchanged = listCalls;

      // Another session records a file: the revision moves, so the next read fetches.
      await working.putAll(activeNamespaceKey(), [entry({ relPath: PUPIL_FR_NEW })]);
      const seen = await getEntry(PUPIL_FR_NEW);
      return { whileUnchanged, afterAChange: listCalls, seen: seen?.relPath };
    });

    expect(calls).toEqual({ whileUnchanged: 1, afterAChange: 2, seen: PUPIL_FR_NEW });
  });

  it("hands back entries that cannot be changed in place — they are shared between callers", async () => {
    const attempt = await inMaths(async () => {
      await recordContent("pipeline", pupilFrench(PUPIL_FR_NEW));
      const shared = (await getEntry(PUPIL_FR_NEW))!;
      return () => { shared.nodeId = "somewhere-else"; };
    });

    expect(attempt).toThrow(TypeError);
  });

  it("keeps two namespaces apart", async () => {
    await inMaths(() => recordContent("pipeline", pupilFrench(PUPIL_FR_NEW)));

    expect(await inReading(() => listEntries())).toEqual([]);
    expect(await inMaths(() => listEntries())).toHaveLength(1);
  });

  it("files records under the same key the graph store uses for the namespace", async () => {
    const key = await inMaths(async () => activeNamespaceKey());

    expect(key).toBe(kgNamespace("senegal", "ci", "maths"));
  });
});

describe("reconcile", () => {
  it("drops the record of a file that is gone from the bucket", async () => {
    __setStorageForTest(bucket({ paths: [PUPIL_FR_NEW] }));
    const result = await inMaths(async () => {
      await recordContent("pipeline", pupilFrench(PUPIL_FR_NEW));
      await recordContent("pipeline", { ...pupilFrench(PUPIL_WO), variant: "WO" });   // recorded, but not in the listing
      const reconciled = await reconcile();
      return { reconciled, left: (await listEntries()).map((file) => file.relPath) };
    });

    expect(result.reconciled.dropped).toEqual([PUPIL_WO]);
    expect(result.left).toEqual([PUPIL_FR_NEW]);
  });

  it("drops NOTHING when the bucket lists no document at all — that is a wrong namespace, not an empty one", async () => {
    __setStorageForTest(bucket({ paths: [] }));
    const result = await inMaths(async () => {
      await recordContent("pipeline", pupilFrench(PUPIL_FR_NEW));
      const reconciled = await reconcile();
      return { reconciled, left: await getFileRecordStore().list(activeNamespaceKey()) };
    });

    expect(result.reconciled.dropped).toEqual([]);
    expect(result.reconciled.dropSkipped).toContain("Nothing was dropped");
    expect(result.left).toHaveLength(1);
  });
});
