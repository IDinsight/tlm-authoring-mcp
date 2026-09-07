/*
 * sourceFreshness — is what I am about to compose FROM still current?
 *
 * THE DEFECT, from a real CE1 authoring session. A Guide was composed against a
 * pupil render sitting at its 1-September state while the lesson's decisions ran
 * to 6 September. Nothing flagged it. It surfaced only because someone opened
 * the drawings for an unrelated reason.
 *
 * Nothing was broken. `check_stale` already answered a STRONGER question than a
 * timestamp — it compares each document's recorded source wording against the
 * graph now, from the anchors the renderer wrote into the file — but it was a
 * separate call the composition path never made. A precondition nobody is
 * prompted to check is a precondition in name only.
 *
 * So two properties are pinned here:
 *
 *   1. The verdict rides the production READ, so it cannot be skipped by not
 *      thinking of it.
 *   2. The `unknown` bucket — a file with no anchors, which is where the
 *      reported case actually sat — gets a usable answer from the AUDIT: was
 *      there a graph edit to what this file covers AFTER the file was written?
 *      That is the {pupilRenderUpdated, lessonGraphUpdated} comparison the
 *      report asked for, with no new stored field.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  seedStore, seededContexts, CI_MATHS, CURATOR, SIGNED_IN_NO_ROLE,
  withActiveContext as inContext,
} from "../../__tests__/index.js";
import { __setKgStoreForTest, kgNamespace, nextAuditSeq, type KgNodeStore } from "../../kg-store/index.js";
import { __setStorageForTest } from "../../storage/index.js";
import { getActiveAdapter } from "../../adapters/index.js";
import { hashContent } from "../../render/index.js";
import { freshnessFor } from "../freshness.js";
import type { Actor } from "../../actor.js";
import type { StorageAdapter, HistoryFile, HistoryEntry } from "../../types.js";

const ctx = seededContexts([CI_MATHS]).find((c) => c.grade === "ci" && c.subject === "maths")!;
const ns = kgNamespace(ctx.workspace, ctx.grade, ctx.subject);

let store: KgNodeStore;

/** A storage stub whose history is whatever the test wants it to be. */
function storageWithHistory(entries: HistoryEntry[]): StorageAdapter {
  const history: HistoryFile = { version: 4, entries };
  return {
    listDocuments: async () => [],
    getObjectMd5: async () => "x",
    downloadDocx: async () => Buffer.from(""),
    createUploadUrl: async () => ({ url: "", objectKey: "", contentType: "", expiresAt: "" }),
    createDownloadUrl: async () => ({ url: "", objectKey: "", expiresAt: "", exists: false }),
    readHistory: async () => history,
    writeHistory: async () => {},
  };
}

const entry = (over: Partial<HistoryEntry> & { nodeId: string; relPath: string }): HistoryEntry => ({
  id: over.relPath, md5: "x", updated: "2026-09-01T00:00:00Z", source: "pipeline", recordedAt: "", content: {}, ...over,
});

/** A lesson id from the fixture, plus the wording the graph carries for it. */
function aNodeWithContent(): { id: string; content: string } {
  const raw = getActiveAdapter().model().rawGraph!;
  const found = raw.nodes.find((node) => typeof (node.properties as any)?.content === "string" && (node.properties as any).content.length > 10);
  return { id: found!.id, content: (found!.properties as any).content as string };
}

const run = <T>(actor: Actor, fn: () => Promise<T>): Promise<T> => inContext(ctx, actor, fn);

beforeEach(async () => {
  store = await seedStore({ only: [CI_MATHS] });
  __setKgStoreForTest(store);
});
afterAll(() => { __setKgStoreForTest(null); });

describe("the anchored verdict", () => {
  it("reports a document whose recorded wording still matches as current, and says nothing more", async () => {
    const result = await run(CURATOR, async () => {
      const node = aNodeWithContent();
      __setStorageForTest(storageWithHistory([
        entry({ nodeId: node.id, relPath: "lecon_01/Fiche.docx", sources: [{ nodeId: node.id, hash: hashContent(node.content) }] }),
      ]));
      return freshnessFor(ns, getActiveAdapter().model(), [node.id]);
    });

    expect(result).toMatchObject({ counts: { current: 1, stale: 0, unknown: 0 } });
    // A current document is counted, not listed — a list of "all fine" is noise
    // in a payload a model has to read on every section.
    expect((result as any).documents).toEqual([]);
    expect((result as any).note).toBeUndefined();
  });

  it("reports a document whose covered wording has MOVED as stale, naming the nodes", async () => {
    const result = await run(CURATOR, async () => {
      const node = aNodeWithContent();
      __setStorageForTest(storageWithHistory([
        // A hash of wording the graph no longer carries.
        entry({ nodeId: node.id, relPath: "lecon_01/Fiche.docx", sources: [{ nodeId: node.id, hash: hashContent("something else entirely") }] }),
      ]));
      return freshnessFor(ns, getActiveAdapter().model(), [node.id]);
    });

    expect((result as any).counts.stale).toBe(1);
    expect((result as any).documents[0]).toMatchObject({ state: "stale", relPath: "lecon_01/Fiche.docx" });
    expect((result as any).documents[0].changed).toHaveLength(1);
    expect((result as any).note).toMatch(/quote curriculum that has CHANGED/);
  });
});

describe("the unknown bucket — where the reported case actually sat", () => {
  it("asks the audit whether the graph moved AFTER the file was written", async () => {
    const result = await run(CURATOR, async () => {
      const node = aNodeWithContent();
      // A file with no anchors, written on 1 September…
      __setStorageForTest(storageWithHistory([
        entry({ nodeId: node.id, relPath: "lecon_03/Pupil.docx", updated: "2026-09-01T00:00:00Z" }),
      ]));
      // …and an edit to what it covers, on the 6th.
      await store.appendAudit({
        id: "a1", ts: "2026-09-06T10:00:00Z", seq: nextAuditSeq(),
        actor: { id: "someone" }, namespace: ns, eventType: "apply",
        diff: { nodes: { added: [], removed: [], changed: [{ id: node.id }] }, edges: { added: [], removed: [], changed: [] } },
      } as any);
      return freshnessFor(ns, getActiveAdapter().model(), [node.id]);
    });

    const row = (result as any).documents[0];
    expect(row.state).toBe("unknown");
    // The exact comparison the report asked for, without a new stored field.
    expect(row.olderThanGraph).toBe(true);
    expect(row.lastGraphEdit).toBe("2026-09-06T10:00:00Z");
    expect((result as any).note).toMatch(/predate the last graph edit/);
    // And it says which kind of answer this is, so it is not mistaken for the
    // stronger content comparison.
    expect((result as any).note).toMatch(/a timestamp, not a content comparison/);
  });

  it("does NOT claim a file is behind when the only later edit touched something else", async () => {
    const result = await run(CURATOR, async () => {
      const node = aNodeWithContent();
      __setStorageForTest(storageWithHistory([entry({ nodeId: node.id, relPath: "lecon_03/Pupil.docx" })]));
      await store.appendAudit({
        id: "a2", ts: "2026-09-06T10:00:00Z", seq: nextAuditSeq(),
        actor: { id: "someone" }, namespace: ns, eventType: "apply",
        diff: { nodes: { added: [], removed: [], changed: [{ id: "some-other-node" }] }, edges: { added: [], removed: [], changed: [] } },
      } as any);
      return freshnessFor(ns, getActiveAdapter().model(), [node.id]);
    });

    const row = (result as any).documents[0];
    expect(row.state).toBe("unknown");
    expect(row.olderThanGraph).toBeUndefined();
    expect(row.lastGraphEdit).toBeUndefined();
  });

  it("stays unknown, never current, when there is nothing to compare", async () => {
    const result = await run(CURATOR, async () => {
      const node = aNodeWithContent();
      __setStorageForTest(storageWithHistory([entry({ nodeId: node.id, relPath: "lecon_03/Pupil.docx" })]));
      return freshnessFor(ns, getActiveAdapter().model(), [node.id]);
    });

    // The one rule of the sources model: no record is never a clean bill.
    expect((result as any).counts).toMatchObject({ current: 0, unknown: 1 });
    expect((result as any).documents[0].state).toBe("unknown");
  });
});

describe("what it costs and who may see it", () => {
  it("says nothing at all when the read covers nothing — a front-matter section", async () => {
    const result = await run(CURATOR, () => freshnessFor(ns, getActiveAdapter().model(), []));
    expect(result).toBeUndefined();
  });

  it("is omitted when no document covers the material", async () => {
    const result = await run(CURATOR, async () => {
      __setStorageForTest(storageWithHistory([entry({ nodeId: "unrelated", relPath: "x.docx" })]));
      return freshnessFor(ns, getActiveAdapter().model(), [aNodeWithContent().id]);
    });
    expect(result).toBeUndefined();
  });

  it("refuses a non-member with a reason, rather than an empty result", async () => {
    const result = await run(SIGNED_IN_NO_ROLE, async () => {
      __setStorageForTest(storageWithHistory([entry({ nodeId: aNodeWithContent().id, relPath: "x.docx" })]));
      return freshnessFor(ns, getActiveAdapter().model(), [aNodeWithContent().id]);
    });

    // Documents are members-only even though the curriculum read carrying this
    // field is open. Saying so beats an empty object that reads as "all fine".
    expect(result).toHaveProperty("unavailable");
    expect(String((result as any).unavailable)).toMatch(/needs a ROLE/);
  });

  it("leaves no audit trail for a non-member's open curriculum read", async () => {
    await run(SIGNED_IN_NO_ROLE, async () => {
      __setStorageForTest(storageWithHistory([entry({ nodeId: aNodeWithContent().id, relPath: "x.docx" })]));
      return freshnessFor(ns, getActiveAdapter().model(), [aNodeWithContent().id]);
    });

    // A non-member doing an OPEN read has done nothing wrong. Writing a
    // "blocked" record on every one would bury the real refusals.
    const blocked = (await store.listAudit({})).filter((record) => record.eventType === "blocked");
    expect(blocked).toEqual([]);
  });
});
