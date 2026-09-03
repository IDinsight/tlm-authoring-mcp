/*
 * History holds one entry per FILE, not per curriculum node.
 *
 * The node-keyed schema could hold one document per lesson, and a CI-maths
 * lesson has four: the pupil's tool in French and Wolof, and the teacher's
 * guide in each. So recording the second replaced the first — its whole content
 * record with it, live, with no undo — while `reconcile` reported 152 unrecorded
 * objects and told the caller to link each one.
 *
 * These tests pin the new shape: several files per node coexist, a file is
 * identified by its path, and the one remaining destructive move (re-pointing an
 * existing file at a different node) is refused unless asked for explicitly.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { newSessionState, runInSession } from "../../context/index.js";
import { __setStorageForTest, recordContent, getEntry, entriesForNode, listEntries } from "../index.js";
import type { StorageAdapter, HistoryFile, HistoryEntry, DocumentContent } from "../../types.js";

const LESSON = "d796c4ee-a3db-493c-b6ac-ee5697ddcf95";
const OTHER_LESSON = "aaaaaaaa-0000-0000-0000-000000000001";

const PUPIL_TOOL = "a51f831c-3c6d-52ae-aa14-a2f69e988d68";
const TEACHER_GUIDE = "041ec500-e4aa-4c37-b74f-6a2f1a4ca728";

const PUPIL_FR = "lecon_01/V2-Lecon-1-ensembles-FR.docx";
const PUPIL_WO = "lecon_01/V2-Lecon-1-ensembles-WO.docx";
const GUIDE_FR = "guide_enseignant/V2-Guide-Fiche-Lecon-1-FR.docx";

// The French record carries real weight — thousands of characters of summary,
// characters and concepts. Losing it silently is the failure being prevented.
const frenchContent: DocumentContent = {
  summary: "Leçon 1 — les ensembles. ".repeat(40),
  characters: [{ name: "Fatou", type: "child" }, { name: "Moussa", type: "child" }],
  exampleDomains: ["fruits"],
  conceptsCovered: ["ensembles"],
  terminologyUsed: ["ensemble"],
};
const wolofContent: DocumentContent = { summary: "Same lesson, Wolof rendering." };

// Storage that actually REMEMBERS, so a second write can be observed. `seed`
// plants a pre-existing history file, for the migration cases.
function statefulStorage(seed?: unknown): StorageAdapter {
  let history = seed as HistoryFile | undefined;
  return {
    listDocuments: async () => [],
    getObjectMd5: async (relPath: string) => `md5-of-${relPath}`,
    downloadDocx: async () => Buffer.from(""),
    createUploadUrl: async () => ({ url: "", objectKey: "", contentType: "", expiresAt: "" }),
    createDownloadUrl: async () => ({ url: "", objectKey: "", expiresAt: "", exists: false }),
    readHistory: async () => history ?? { version: 4, entries: [] },
    writeHistory: async (next: HistoryFile) => { history = next; },
  };
}

const inSession = <T>(fn: () => Promise<T>): Promise<T> => runInSession(newSessionState(), fn);

beforeEach(() => { __setStorageForTest(statefulStorage()); });

describe("several files on one curriculum node", () => {
  it("keeps every file, rather than the last one written", async () => {
    const files = await inSession(async () => {
      await recordContent("pipeline", { nodeId: LESSON, relPath: PUPIL_FR, content: frenchContent, documentId: PUPIL_TOOL, variant: "FR" });
      await recordContent("pipeline", { nodeId: LESSON, relPath: PUPIL_WO, content: wolofContent, documentId: PUPIL_TOOL, variant: "WO" });
      await recordContent("parsed", { nodeId: LESSON, relPath: GUIDE_FR, content: { summary: "teacher sheet" }, documentId: TEACHER_GUIDE, variant: "FR" });
      return entriesForNode(LESSON);
    });

    expect(files.map((f) => f.relPath).sort()).toEqual([GUIDE_FR, PUPIL_FR, PUPIL_WO].sort());
  });

  it("keeps the FIRST file's content record intact when later ones are added", async () => {
    const french = await inSession(async () => {
      await recordContent("pipeline", { nodeId: LESSON, relPath: PUPIL_FR, content: frenchContent });
      await recordContent("pipeline", { nodeId: LESSON, relPath: PUPIL_WO, content: wolofContent });
      return getEntry(PUPIL_FR);
    });

    expect(french?.content.summary).toBe(frenchContent.summary);
    expect(french?.content.characters).toHaveLength(2);
  });

  it("tells two files of the same lesson apart by the document they came from", async () => {
    const files = await inSession(async () => {
      await recordContent("pipeline", { nodeId: LESSON, relPath: PUPIL_FR, content: frenchContent, documentId: PUPIL_TOOL, variant: "FR" });
      await recordContent("parsed", { nodeId: LESSON, relPath: GUIDE_FR, content: { summary: "x" }, documentId: TEACHER_GUIDE, variant: "FR" });
      return entriesForNode(LESSON);
    });

    // Same covered lesson, same language — only documentId separates them.
    const byDocument = new Map(files.map((f) => [f.documentId, f.relPath]));
    expect(byDocument.get(PUPIL_TOOL)).toBe(PUPIL_FR);
    expect(byDocument.get(TEACHER_GUIDE)).toBe(GUIDE_FR);
  });
});

describe("updating and re-pointing a file", () => {
  it("re-recording the SAME file updates it in place", async () => {
    const entry = await inSession(async () => {
      await recordContent("pipeline", { nodeId: LESSON, relPath: PUPIL_FR, content: frenchContent });
      await recordContent("parsed", { nodeId: LESSON, relPath: PUPIL_FR, content: { summary: "re-read after an edit" } });
      return getEntry(PUPIL_FR);
    });

    expect(entry?.content.summary).toBe("re-read after an edit");
    expect(entry?.source).toBe("parsed");
  });

  it("REFUSES to move a recorded file to a different node", async () => {
    const result = await inSession(async () => {
      await recordContent("pipeline", { nodeId: LESSON, relPath: PUPIL_FR, content: frenchContent });
      return recordContent("parsed", { nodeId: OTHER_LESSON, relPath: PUPIL_FR, content: wolofContent });
    });

    const message = (result as { error: string }).error;
    expect(message).toContain(LESSON);
    expect(message).toContain("replace: true");
    // The refusal must also say what the caller probably meant to do instead.
    expect(message).toContain("relPath");
  });

  it("leaves the entry where it was when it refuses", async () => {
    const entry = await inSession(async () => {
      await recordContent("pipeline", { nodeId: LESSON, relPath: PUPIL_FR, content: frenchContent });
      await recordContent("parsed", { nodeId: OTHER_LESSON, relPath: PUPIL_FR, content: wolofContent });
      return getEntry(PUPIL_FR);
    });

    expect(entry?.nodeId).toBe(LESSON);
    expect(entry?.content.summary).toBe(frenchContent.summary);
  });

  it("moves it only when the caller says so explicitly", async () => {
    const entry = await inSession(async () => {
      await recordContent("pipeline", { nodeId: LESSON, relPath: PUPIL_FR, content: frenchContent });
      await recordContent("parsed", { nodeId: OTHER_LESSON, relPath: PUPIL_FR, content: wolofContent, replace: true });
      return getEntry(PUPIL_FR);
    });

    expect(entry?.nodeId).toBe(OTHER_LESSON);
  });

  it("still refuses an object that is not in the bucket", async () => {
    __setStorageForTest({ ...statefulStorage(), getObjectMd5: async () => null });
    const result = await inSession(async () =>
      recordContent("pipeline", { nodeId: LESSON, relPath: PUPIL_FR, content: frenchContent }));

    expect((result as { error: string }).error).toContain("not found in the bucket");
  });
});

describe("migrating the node-keyed history", () => {
  // The live history holds 60 of these. Discarding them would throw away exactly
  // the content records this change exists to protect.
  const nodeKeyed = {
    version: 3,
    entries: [
      { id: LESSON, nodeId: LESSON, relPath: PUPIL_FR, md5: "m1", updated: "2026-09-01T00:00:00Z", source: "pipeline", recordedAt: "2026-09-01T00:00:00Z", content: frenchContent },
      { id: OTHER_LESSON, nodeId: OTHER_LESSON, relPath: "lecon_02/V2-Lecon-2-FR.docx", md5: "m2", updated: "2026-09-01T00:00:00Z", source: "pipeline", recordedAt: "2026-09-01T00:00:00Z", content: { summary: "lesson 2" } },
    ] as unknown as HistoryEntry[],
  };

  it("carries every entry across, content records intact", async () => {
    __setStorageForTest(statefulStorage(nodeKeyed));
    const entries = await inSession(() => listEntries());

    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.relPath === PUPIL_FR)?.content.summary).toBe(frenchContent.summary);
  });

  it("re-keys each entry to its file", async () => {
    __setStorageForTest(statefulStorage(nodeKeyed));
    const entry = await inSession(() => getEntry(PUPIL_FR));

    expect(entry?.id).toBe(PUPIL_FR);
    expect(entry?.nodeId).toBe(LESSON);   // what it covers is preserved
  });

  it("leaves documentId and variant unset rather than guessing them from the path", async () => {
    __setStorageForTest(statefulStorage(nodeKeyed));
    const entry = await inSession(() => getEntry(PUPIL_FR));

    expect(entry?.documentId).toBeUndefined();
    expect(entry?.variant).toBeUndefined();
  });

  it("lets a migrated entry take a second file on its node afterwards", async () => {
    __setStorageForTest(statefulStorage(nodeKeyed));
    const files = await inSession(async () => {
      await recordContent("pipeline", { nodeId: LESSON, relPath: PUPIL_WO, content: wolofContent, variant: "WO" });
      return entriesForNode(LESSON);
    });

    expect(files.map((f) => f.relPath).sort()).toEqual([PUPIL_FR, PUPIL_WO].sort());
  });

  it("still discards a pre-node-keyed (v2) history, which cannot be mapped", async () => {
    __setStorageForTest(statefulStorage({ version: 2, entries: [{ unit: 1, deliverable: "manual" }] }));
    expect(await inSession(() => listEntries())).toEqual([]);
  });
});
