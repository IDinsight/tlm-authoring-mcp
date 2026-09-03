/*
 * History keeps ONE entry per scope node — so a second document on a node is a
 * REPLACEMENT, not an addition.
 *
 * That is not hypothetical. On the live CI-maths bucket every lesson has four
 * files (pupil FR, pupil WO, illustration dossier, teacher sheet), only the
 * French one is recorded, and `reconcile` reports 152 unrecorded objects while
 * telling the caller to link each one to the node it covers. Following that
 * instruction overwrote the existing entry — its whole content record included —
 * with no draft behind it and no undo.
 *
 * These tests pin the refusal. They do NOT decide how a node should eventually
 * hold several documents; they stop the unrecoverable write while that is decided.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { newSessionState, runInSession } from "../../context/index.js";
import { __setStorageForTest, recordContent, getEntry } from "../index.js";
import type { StorageAdapter, HistoryFile, DocumentContent } from "../../types.js";

const LESSON = "d796c4ee-a3db-493c-b6ac-ee5697ddcf95";
const FRENCH_SHEET = "lecon_01/V2-Lecon-1-ensembles-FR.docx";
const WOLOF_SHEET = "lecon_01/V2-Lecon-1-ensembles-WO.docx";

// The French record carries real weight — several thousand characters of summary,
// characters and concepts. Losing it silently is the failure being prevented.
const frenchContent: DocumentContent = {
  summary: "Leçon 1 — les ensembles. ".repeat(40),
  characters: [{ name: "Fatou", type: "child" }, { name: "Moussa", type: "child" }],
  exampleDomains: ["fruits"],
  conceptsCovered: ["ensembles"],
  terminologyUsed: ["ensemble", "boucle"],
};
const wolofContent: DocumentContent = { summary: "Same lesson, Wolof rendering." };

// A storage stub that actually REMEMBERS the history, so a second write can be
// observed. Every object is present in the bucket with a stable hash.
function statefulStorage(): StorageAdapter {
  let history: HistoryFile = { version: 3, entries: [] };
  return {
    listDocuments: async () => [],
    getObjectMd5: async (relPath: string) => `md5-of-${relPath}`,
    downloadDocx: async () => Buffer.from(""),
    createUploadUrl: async () => ({ url: "", objectKey: "", contentType: "", expiresAt: "" }),
    createDownloadUrl: async () => ({ url: "", objectKey: "", expiresAt: "", exists: false }),
    readHistory: async () => history,
    writeHistory: async (next: HistoryFile) => { history = next; },
  };
}

const inSession = <T>(fn: () => Promise<T>): Promise<T> => runInSession(newSessionState(), fn);

beforeEach(() => { __setStorageForTest(statefulStorage()); });

describe("recording a document into history", () => {
  it("records the first document on a node", async () => {
    const result = await inSession(async () =>
      recordContent("pipeline", { nodeId: LESSON, relPath: FRENCH_SHEET, content: frenchContent }));

    expect("error" in result).toBe(false);
    expect((result as { relPath: string }).relPath).toBe(FRENCH_SHEET);
  });

  it("REFUSES a second, different document on the same node", async () => {
    const result = await inSession(async () => {
      await recordContent("pipeline", { nodeId: LESSON, relPath: FRENCH_SHEET, content: frenchContent });
      return recordContent("parsed", { nodeId: LESSON, relPath: WOLOF_SHEET, content: wolofContent });
    });

    expect("error" in result).toBe(true);
    const message = (result as { error: string }).error;
    // The refusal has to name what is in the way, or the caller cannot act on it.
    expect(message).toContain(FRENCH_SHEET);
    expect(message).toContain("replace: true");
  });

  it("leaves the existing entry untouched when it refuses", async () => {
    const entry = await inSession(async () => {
      await recordContent("pipeline", { nodeId: LESSON, relPath: FRENCH_SHEET, content: frenchContent });
      await recordContent("parsed", { nodeId: LESSON, relPath: WOLOF_SHEET, content: wolofContent });
      return getEntry(LESSON);
    });

    expect(entry?.relPath).toBe(FRENCH_SHEET);
    expect(entry?.content.summary).toBe(frenchContent.summary);
  });

  it("allows re-recording the SAME document — that is an update, not a replacement", async () => {
    const entry = await inSession(async () => {
      await recordContent("pipeline", { nodeId: LESSON, relPath: FRENCH_SHEET, content: frenchContent });
      await recordContent("parsed", { nodeId: LESSON, relPath: FRENCH_SHEET, content: { summary: "re-read after an edit" } });
      return getEntry(LESSON);
    });

    expect(entry?.relPath).toBe(FRENCH_SHEET);
    expect(entry?.content.summary).toBe("re-read after an edit");
    expect(entry?.source).toBe("parsed");
  });

  it("replaces only when the caller says so explicitly", async () => {
    const entry = await inSession(async () => {
      await recordContent("pipeline", { nodeId: LESSON, relPath: FRENCH_SHEET, content: frenchContent });
      await recordContent("parsed", { nodeId: LESSON, relPath: WOLOF_SHEET, content: wolofContent, replace: true });
      return getEntry(LESSON);
    });

    expect(entry?.relPath).toBe(WOLOF_SHEET);
  });

  it("still refuses an object that is not in the bucket, before anything else", async () => {
    __setStorageForTest({ ...statefulStorage(), getObjectMd5: async () => null });
    const result = await inSession(async () =>
      recordContent("pipeline", { nodeId: LESSON, relPath: FRENCH_SHEET, content: frenchContent }));

    expect((result as { error: string }).error).toContain("not found in the bucket");
  });
});
