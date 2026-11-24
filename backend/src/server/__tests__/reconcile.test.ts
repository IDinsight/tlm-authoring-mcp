/*
 * Looking at the bucket and dropping file records are two tools.
 *
 * reconcile used to do both in one call: it reported the recorded files that
 * were gone from the bucket and deleted their records as it went, behind the
 * documents READ permission and with no confirmation. A dropped record does not
 * come back. So the report could not be hinted read-only, and a client such as
 * ChatGPT asked the user before every plain check.
 *
 * Now reconcile only looks, and drop_missing_file_records is the delete: behind
 * the WRITE permission, and only once the caller has confirmed.
 *
 * Driven through the REAL assembled server, like file-verdict.test.ts: what is
 * worth testing is the wiring — which tool deletes, behind which permission,
 * and after what.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { seedStore, seededContexts, CI_MATHS, CURATOR, withActiveContext as inContext } from "../../__tests__/index.js";
import { __setKgStoreForTest, kgNamespace } from "../../kg-store/index.js";
import { __setStorageForTest } from "../../storage/index.js";
import { getActiveAdapter } from "../../adapters/index.js";
import { buildServer } from "../index.js";
import type { Actor } from "../../actor.js";
import type { AuthAction } from "../../authz.js";
import type { StorageAdapter } from "../../types.js";

const maths = seededContexts([CI_MATHS]).find((context) => context.grade === "ci" && context.subject === "maths")!;
const MATHS_NAMESPACE = kgNamespace(maths.workspace, maths.grade, maths.subject);

const STILL_THERE = "lecon_05/V2-Lecon-5-FR.docx";
const GONE = "lecon_05/V2-Lecon-5-WO.docx";

// Every member holds both document rights today (authz.ts puts readDocuments
// and writeDocuments on the same tier), so no real role can show that the drop
// asks for the WRITE one. This caller is refused that right alone, the way a
// workspace that raised it above curator would refuse a curator.
const { READER_ID } = vi.hoisted(() => ({ READER_ID: "reader-uid" }));
const READER: Actor = { id: READER_ID, email: "reader@test", role: "curator", unknown: false };

vi.mock("../../authz.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../authz.js")>();
  const authorize = (actor: Actor, action: AuthAction, namespace: string) => {
    const readerWriting = actor.id === READER_ID && action === "writeDocuments";
    return readerWriting
      ? { ok: false, reason: "this caller may read the documents, not write to them" }
      : real.authorize(actor, action, namespace);
  };
  return { ...real, authorize };
});

// A bucket whose listing each test chooses. Every file can be recorded; a
// recorded file is "gone" when the listing leaves it out.
let listed: string[];
const md5Of = (relPath: string): string => `md5-of-${relPath}`;
const bucket: StorageAdapter = {
  listDocuments: async () => listed.map((relPath) => ({ relPath, md5: md5Of(relPath), updated: null })),
  getObjectMd5: async (relPath) => md5Of(relPath),
  downloadDocx: async () => { throw new Error("this fake bucket holds no bytes"); },
  createUploadUrl: async () => ({ url: "", objectKey: "", contentType: "", expiresAt: "" }),
  createDownloadUrl: async () => ({ url: "", objectKey: "", expiresAt: "", exists: true }),
  readHistory: async () => null,
};

// One connected client per call, in the caller's session on ci/maths.
async function callAs(actor: Actor, name: string, args: Record<string, unknown> = {}): Promise<Record<string, any>> {
  return inContext(maths, actor, async () => {
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const server = buildServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const result = await client.callTool({ name, arguments: args });
    const first = (result as { content: Array<{ type: string; text: string }> }).content[0];
    return JSON.parse(first.text) as Record<string, any>;
  });
}

async function recordedPaths(): Promise<string[]> {
  const listing = await callAs(CURATOR, "list_documents");
  return listing.entries.map((file: { relPath: string }) => file.relPath).sort();
}

const BOTH_RECORDED = [STILL_THERE, GONE].sort();

// Two files of one lesson are recorded, then the bucket stops listing one.
beforeEach(async () => {
  __setKgStoreForTest(await seedStore({ only: [CI_MATHS] }));
  __setStorageForTest(bucket);

  // Taken from the fixture rather than hard-coded: its ids move on a refresh.
  const lessonId = await inContext(maths, CURATOR, async () => {
    const rawNodes = getActiveAdapter().model().rawGraph?.nodes ?? [];
    return rawNodes.find((node) => (node.labels ?? []).includes("Lesson"))!.id;
  });
  for (const relPath of [STILL_THERE, GONE]) {
    await callAs(CURATOR, "log_generation", { nodeId: lessonId, relPath, content: { summary: "x" }, confirm: true });
  }
  listed = [STILL_THERE];
});
afterAll(() => { __setKgStoreForTest(null); });

describe("reconcile only reports", () => {
  it("lists the recorded file that is gone, and leaves its record where it was", async () => {
    const report = await callAs(CURATOR, "reconcile");

    expect(report.gone).toEqual([GONE]);
    expect(report.tracked.map((file: { relPath: string }) => file.relPath)).toEqual([STILL_THERE]);
    expect(report.dropped).toBeUndefined();
    expect(await recordedPaths()).toEqual(BOTH_RECORDED);
  });

  it("points at the tool that drops the record", async () => {
    const report = await callAs(CURATOR, "reconcile");

    expect(report.nextSteps.join(" ")).toContain("drop_missing_file_records");
  });

  it("says the drop is blocked when the bucket lists no document at all", async () => {
    listed = [];
    const report = await callAs(CURATOR, "reconcile");

    expect(report.gone.sort()).toEqual(BOTH_RECORDED);
    expect(report.dropBlocked).toContain("lists NO documents");
    expect(report.nextSteps).toBeUndefined();
  });
});

describe("drop_missing_file_records", () => {
  it("drops nothing until the caller confirms, and names what would go", async () => {
    const notice = await callAs(CURATOR, "drop_missing_file_records");

    expect(notice.needsConfirmation).toBe(true);
    expect(notice.wouldDrop).toEqual([GONE]);
    expect(notice.action).toContain(MATHS_NAMESPACE);
    expect(await recordedPaths()).toEqual(BOTH_RECORDED);
  });

  it("drops the record of the gone file once confirmed, and only that one", async () => {
    const outcome = await callAs(CURATOR, "drop_missing_file_records", { confirm: true });

    expect(outcome.dropped).toEqual([GONE]);
    expect(outcome.namespace).toBe(MATHS_NAMESPACE);
    expect(await recordedPaths()).toEqual([STILL_THERE]);
    expect((await callAs(CURATOR, "reconcile")).gone).toEqual([]);
  });

  it("refuses a caller who may read the documents but not write to them", async () => {
    const report = await callAs(READER, "reconcile");
    const refusal = await callAs(READER, "drop_missing_file_records", { confirm: true });

    expect(report.gone).toEqual([GONE]);              // reading is allowed…
    expect(refusal.phase).toBe("unauthorized");       // …dropping is not
    expect(refusal.action).toBe("writeDocuments");
    expect(await recordedPaths()).toEqual(BOTH_RECORDED);
  });

  it("drops nothing when the bucket lists no document at all, confirmed or not", async () => {
    listed = [];
    const unconfirmed = await callAs(CURATOR, "drop_missing_file_records");
    const confirmed = await callAs(CURATOR, "drop_missing_file_records", { confirm: true });

    // Not a confirmation notice: nobody is asked to approve a drop the server refuses.
    expect(unconfirmed.needsConfirmation).toBeUndefined();
    for (const answer of [unconfirmed, confirmed]) {
      expect(answer.dropped).toEqual([]);
      expect(answer.dropSkipped).toContain("lists NO documents");
    }
    expect(await recordedPaths()).toEqual(BOTH_RECORDED);
  });

  it("asks for no confirmation when every recorded file is still in the bucket", async () => {
    listed = [STILL_THERE, GONE];
    const answer = await callAs(CURATOR, "drop_missing_file_records");

    expect(answer.needsConfirmation).toBeUndefined();
    expect(answer.dropped).toEqual([]);
    expect(answer.message).toContain("no record to drop");
  });
});
