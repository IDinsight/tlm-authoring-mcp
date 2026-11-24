/*
 * A person approves a produced file, or sends it back.
 *
 * Driven through the REAL assembled server, like documents-context.test.ts: what
 * is worth testing is the wiring — that approving needs an approver, that
 * nothing is written before the person confirms, that every verdict lands in
 * the audit trail under the right name — not that statusOf() returns a string.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { seedStore, seededContexts, CI_MATHS, CE1_READING, APPROVER, CURATOR, SIGNED_IN_NO_ROLE, withActiveContext as inContext } from "../../__tests__/index.js";
import { __setKgStoreForTest, kgNamespace, type KgNodeStore } from "../../kg-store/index.js";
import { __setStorageForTest } from "../../storage/index.js";
import { hashContent } from "../../render/index.js";
import { getActiveAdapter } from "../../adapters/index.js";
import { buildServer } from "../index.js";
import type { Actor } from "../../actor.js";
import type { StorageAdapter } from "../../types.js";

const maths = seededContexts([CI_MATHS]).find((context) => context.grade === "ci" && context.subject === "maths")!;
const MATHS_NAMESPACE = kgNamespace(maths.workspace, maths.grade, maths.subject);
const READING = { workspace: "senegal", grade: "ce1", subject: "reading" };

const PUPIL_BOOK = "doc-pupil-book";
const PUPIL_FR_OLD = "lecon_05/V2-Lecon-5-ancien-FR.docx";
const PUPIL_FR = "lecon_05/V2-Lecon-5-FR.docx";
const PUPIL_WO = "lecon_05/V2-Lecon-5-WO.docx";

// A bucket where every file exists, with a hash that changes when `reupload` is called.
let bucketGeneration = 1;
const reupload = (): void => { bucketGeneration += 1; };
const bucket: StorageAdapter = {
  listDocuments: async () => [],
  getObjectMd5: async (relPath) => `md5-${bucketGeneration}-${relPath}`,
  // No bytes to read: a delivery then records no sources, which is the documented
  // outcome for a file the server cannot open (see documents.ts::sourcesOf).
  downloadDocx: async () => { throw new Error("this fake bucket holds no bytes"); },
  createUploadUrl: async () => ({ url: "", objectKey: "", contentType: "", expiresAt: "" }),
  createDownloadUrl: async () => ({ url: "", objectKey: "", expiresAt: "", exists: true }),
  readHistory: async () => null,
};

let store: KgNodeStore;
let lessonId: string;            // a real lesson of the fixture graph, which a file may cover
let nodeWithWordingId: string;   // a node carrying `content`, which a file can be made from

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

/** Deliver one file of the lesson, the way a production run does. */
function deliver(relPath: string, variant: string, actor: Actor = CURATOR) {
  return callAs(actor, "log_generation", {
    nodeId: lessonId, relPath, content: { summary: "x" }, documentId: PUPIL_BOOK, variant, confirm: true,
  });
}

const fileEvents = async () =>
  (await store.listAudit({ namespace: MATHS_NAMESPACE })).filter((record) => record.eventType === "file");

beforeEach(async () => {
  store = await seedStore({ only: [CI_MATHS, CE1_READING] });
  __setKgStoreForTest(store);
  __setStorageForTest(bucket);
  bucketGeneration = 1;

  // Taken from the fixture rather than hard-coded: its ids move on a refresh.
  await inContext(maths, CURATOR, async () => {
    const rawNodes = getActiveAdapter().model().rawGraph?.nodes ?? [];
    lessonId = rawNodes.find((node) => (node.labels ?? []).includes("Lesson"))!.id;
    nodeWithWordingId = rawNodes.find((node) => typeof node.properties?.content === "string")!.id;
  });
});
afterAll(() => { __setKgStoreForTest(null); });

describe("delivering a file", () => {
  it("says where the file now stands, and what it replaced", async () => {
    await deliver(PUPIL_FR_OLD, "FR");
    const delivered = await deliver(PUPIL_FR, "FR");

    expect(delivered.status).toBe("produced");
    expect(delivered.replaced).toEqual([PUPIL_FR_OLD]);
    expect(delivered.nextSteps.join(" ")).toContain("record_file_verdict");
  });

  it("writes the delivery to the audit trail, in the name of whoever delivered", async () => {
    await deliver(PUPIL_FR_OLD, "FR");
    await deliver(PUPIL_FR, "FR");

    const [newest] = await fileEvents();
    expect(newest).toMatchObject({ fileEvent: "recorded", filePath: PUPIL_FR, replacedFiles: [PUPIL_FR_OLD] });
    expect(newest.actor.id).toBe(CURATOR.id);
  });

  it("warns that a file naming no document or language is unfiled", async () => {
    const delivered = await callAs(CURATOR, "log_generation", {
      nodeId: lessonId, relPath: PUPIL_FR, content: { summary: "x" }, confirm: true,
    });

    expect(delivered.status).toBe("unfiled");
    expect(delivered.nextSteps[0]).toContain("documentId");
  });
});

describe("approving", () => {
  beforeEach(async () => { await deliver(PUPIL_FR, "FR"); });

  it("is refused to a curator, who is told they may still send the file back", async () => {
    const refusal = await callAs(CURATOR, "record_file_verdict", { relPath: PUPIL_FR, verdict: "approved", confirm: true });

    expect(refusal.phase).toBe("unauthorized");
    expect(refusal.message).toContain("changes_requested");
    const listed = await callAs(CURATOR, "list_documents", { nodeId: lessonId });
    expect(listed.entries[0].status).toBe("produced");
  });

  it("leaves a trace of the refused attempt", async () => {
    await callAs(CURATOR, "record_file_verdict", { relPath: PUPIL_FR, verdict: "approved", confirm: true });

    const blocked = (await store.listAudit({ namespace: MATHS_NAMESPACE })).filter((record) => record.eventType === "blocked");
    expect(blocked).toHaveLength(1);
    expect(blocked[0].reason).toContain("cannot approve a produced file");
  });

  it("asks before writing: the first call lists the file before and after, and records nothing", async () => {
    const notice = await callAs(APPROVER, "record_file_verdict", { relPath: PUPIL_FR, verdict: "approved" });

    expect(notice.needsConfirmation).toBe(true);
    expect(notice.namespace).toBe(MATHS_NAMESPACE);
    expect(notice.message).toContain(MATHS_NAMESPACE);
    expect(notice.files).toEqual([expect.objectContaining({ relPath: PUPIL_FR, statusBefore: "produced", status: "approved" })]);

    const listed = await callAs(APPROVER, "list_documents", { nodeId: lessonId });
    expect(listed.entries[0].status).toBe("produced");
  });

  it("records the approval on confirm, in the approver's name, and audits it", async () => {
    const done = await callAs(APPROVER, "record_file_verdict", { relPath: PUPIL_FR, verdict: "approved", note: "bon pour impression", confirm: true });

    expect(done.verdict).toBe("approved");
    expect(done.by).toBe(APPROVER.email);

    const listed = await callAs(APPROVER, "list_documents", { nodeId: lessonId, detail: "summary" });
    expect(listed.entries[0]).toMatchObject({ status: "approved", verdict: { by: APPROVER.email, note: "bon pour impression" } });

    const [newest] = await fileEvents();
    expect(newest).toMatchObject({ fileEvent: "approved", filePath: PUPIL_FR, reason: "bon pour impression" });
    expect(newest.actor.id).toBe(APPROVER.id);
  });

  it("lapses when the file is produced again", async () => {
    await callAs(APPROVER, "record_file_verdict", { relPath: PUPIL_FR, verdict: "approved", confirm: true });
    reupload();
    const redelivered = await deliver(PUPIL_FR, "FR");

    expect(redelivered.status).toBe("produced");
  });

  it("is refused when the bucket no longer holds the bytes that were recorded", async () => {
    reupload();   // uploaded again, never recorded
    const refusal = await callAs(APPROVER, "record_file_verdict", { relPath: PUPIL_FR, verdict: "approved", confirm: true });

    expect(refusal.phase).toBe("refused");
    expect(refusal.refused[0].reason).toContain("uploaded again since it was recorded");
  });

  it("warns, without refusing, when the file quotes curriculum that has changed since", async () => {
    // The file says it was made from this lesson's wording as it was THEN.
    await callAs(CURATOR, "log_generation", {
      nodeId: lessonId, relPath: PUPIL_WO, content: { summary: "x" }, documentId: PUPIL_BOOK, variant: "WO", confirm: true,
    });
    await staleSourcesOn(PUPIL_WO);

    const notice = await callAs(APPROVER, "record_file_verdict", { relPath: PUPIL_WO, verdict: "approved" });

    expect(notice.needsConfirmation).toBe(true);
    expect(notice.warnings).toHaveLength(1);
    expect(notice.warnings[0]).toContain("has changed since it was produced");
  });
});

describe("sending a file back", () => {
  beforeEach(async () => { await deliver(PUPIL_FR, "FR"); });

  it("needs only membership — a curator may do it", async () => {
    const done = await callAs(CURATOR, "record_file_verdict", {
      relPath: PUPIL_FR, verdict: "changes_requested", note: "Le signe de l'activité 2 est faux.", confirm: true,
    });

    expect(done.verdict).toBe("changes_requested");
    const listed = await callAs(CURATOR, "list_documents", { nodeId: lessonId, detail: "summary" });
    expect(listed.entries[0]).toMatchObject({ status: "changes_requested", verdict: { note: "Le signe de l'activité 2 est faux." } });
  });

  it("is refused without a note — the next person would have nothing to act on", async () => {
    const result = await callAs(CURATOR, "record_file_verdict", { relPath: PUPIL_FR, verdict: "changes_requested", confirm: true });

    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(result.error.message).toContain("note");
  });

  it("is refused to someone with no role in the workspace", async () => {
    const refusal = await callAs(SIGNED_IN_NO_ROLE, "record_file_verdict", {
      relPath: PUPIL_FR, verdict: "changes_requested", note: "x", confirm: true,
    });

    expect(refusal.phase).toBe("unauthorized");
  });
});

describe("several files at once", () => {
  beforeEach(async () => {
    await deliver(PUPIL_FR, "FR");
    await deliver(PUPIL_WO, "WO");
  });

  it("approves a lesson's files under one confirmation", async () => {
    const done = await callAs(APPROVER, "record_file_verdict", { relPaths: [PUPIL_FR, PUPIL_WO], verdict: "approved", confirm: true });

    expect(done.files.map((file: { status: string }) => file.status)).toEqual(["approved", "approved"]);
    expect(await fileEvents()).toHaveLength(4);   // two deliveries, two approvals
  });

  it("approves none when one of them cannot take a verdict", async () => {
    const refusal = await callAs(APPROVER, "record_file_verdict", {
      relPaths: [PUPIL_FR, "lecon_05/jamais-enregistre.docx"], verdict: "approved", confirm: true,
    });

    expect(refusal.phase).toBe("refused");
    const listed = await callAs(APPROVER, "list_documents", { nodeId: lessonId });
    expect(listed.entries.map((file: { status: string }) => file.status)).toEqual(["produced", "produced"]);
  });
});

describe("the file list", () => {
  beforeEach(async () => {
    await deliver(PUPIL_FR_OLD, "FR");
    await deliver(PUPIL_FR, "FR");
    await deliver(PUPIL_WO, "WO");
    await callAs(APPROVER, "record_file_verdict", { relPath: PUPIL_FR, verdict: "approved", confirm: true });
  });

  it("counts every status for the lesson in one call", async () => {
    const listed = await callAs(CURATOR, "list_documents", { nodeId: lessonId });

    expect(listed.statusCounts).toEqual({ unfiled: 0, replaced: 1, produced: 1, changes_requested: 0, approved: 1 });
  });

  it("answers « which file is the real one » with current:true", async () => {
    const listed = await callAs(CURATOR, "list_documents", { nodeId: lessonId, current: true });

    expect(listed.entries.map((file: { relPath: string }) => file.relPath).sort()).toEqual([PUPIL_FR, PUPIL_WO].sort());
  });

  it("filters to one status, and still reports the counts of the others", async () => {
    const listed = await callAs(CURATOR, "list_documents", { nodeId: lessonId, status: "replaced" });

    expect(listed.entries).toEqual([expect.objectContaining({ relPath: PUPIL_FR_OLD, status: "replaced", replacedBy: PUPIL_FR })]);
    expect(listed.statusCounts.approved).toBe(1);
  });
});

describe("the namespace a verdict is written in", () => {
  it("is the one the call NAMES, so a file of another subject is not found by accident", async () => {
    await deliver(PUPIL_FR, "FR");

    // The same path, asked for in ce1/reading: nothing is recorded there.
    const refusal = await callAs(APPROVER, "record_file_verdict", { relPath: PUPIL_FR, verdict: "approved", confirm: true, context: READING });

    expect(refusal.phase).toBe("refused");
    expect(refusal.namespace).toBe(kgNamespace(READING.workspace, READING.grade, READING.subject));
    expect(refusal.refused[0].reason).toContain("No file is recorded");
  });
});

describe("what the server says about itself", () => {
  it("tells a curator they cannot approve, and an approver that they can", async () => {
    const forCurator = await callAs(CURATOR, "get_capabilities", { section: "documents" });
    const forApprover = await callAs(APPROVER, "get_capabilities", { section: "documents" });

    expect(forCurator.documents.canApprove).toBe(false);
    expect(forApprover.documents.canApprove).toBe(true);
    expect(forCurator.documents.fileStatus.statuses).toEqual(["unfiled", "replaced", "produced", "changes_requested", "approved"]);
  });

  it("lets an approver read file events back from the audit trail", async () => {
    await deliver(PUPIL_FR, "FR");
    await callAs(APPROVER, "record_file_verdict", { relPath: PUPIL_FR, verdict: "approved", confirm: true });

    const page = await callAs(APPROVER, "read_audit", { action: "file" });

    expect(page.records.map((record: { target: string }) => record.target)).toEqual([
      `approved ${PUPIL_FR}`,
      `recorded ${PUPIL_FR}`,
    ]);
  });
});

/**
 * Make a recorded file look as if it was produced from OLDER wording of the
 * lesson: give it a source whose hash is not the lesson's wording today.
 */
async function staleSourcesOn(relPath: string): Promise<void> {
  const { getFileRecordStore } = await import("../../storage/index.js");
  const records = getFileRecordStore();
  const recorded = (await records.list(MATHS_NAMESPACE)).find((file) => file.relPath === relPath)!;

  const withOldSource = { ...recorded, sources: [{ nodeId: nodeWithWordingId, hash: hashContent("the wording as it was last month") }] };
  await records.putAll(MATHS_NAMESPACE, [withOldSource]);
}
