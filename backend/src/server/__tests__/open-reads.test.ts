/*
 * Open curriculum reads, members-only live assets.
 *
 * The policy these tests pin: anyone signed in may enter ANY workspace and read
 * its published curriculum — the same graphs the public KG explorer already
 * serves anonymously, so gating the tool path protected nothing. What still
 * needs a role is the workspace's live assets: the documents bucket, the
 * generation history, and the metered translator.
 *
 * Driven through the REAL assembled server (buildServer) over an in-memory
 * transport, because the thing worth testing is the WIRING — that each tool
 * actually calls the gate — not that authorize() returns the right boolean
 * (src/__tests__/authz.test.ts covers that in isolation).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { seedStore, seededContexts, fakeStorage, CI_MATHS, withActiveContext as inContext } from "../../__tests__/index.js";
import { __setKgStoreForTest, kgNamespace, type KgNodeStore } from "../../kg-store/index.js";
import { __setStorageForTest } from "../../storage/index.js";
import { buildServer } from "../index.js";
import type { Actor } from "../../actor.js";

// A curator via the legacy app_role bridge (which grants the role in the
// DEFAULT_WORKSPACE, "senegal" — where the fixtures live), and a real signed-in
// user who belongs to nothing.
const CURATOR: Actor = { id: "curator-uid", email: "curator@test", role: "curator", unknown: false };
const GUEST: Actor = { id: "guest-uid", email: "guest@test", unknown: false };

const targetCtx = seededContexts([CI_MATHS]).find((c) => c.grade === "ci" && c.subject === "maths")!;
const ns = kgNamespace(targetCtx.workspace, targetCtx.grade, targetCtx.subject);

let store: KgNodeStore;

// One connected client per call, inside the actor's session — buildServer is
// cheap and a fresh pair keeps the suites independent.
async function callAs(actor: Actor, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return inContext(targetCtx, actor, async () => {
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const server = buildServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const result = await client.callTool({ name, arguments: args });
    const first = (result as { content: Array<{ type: string; text: string }> }).content[0];
    return JSON.parse(first.text) as Record<string, unknown>;
  });
}

const refused = (payload: Record<string, unknown>): boolean => payload.phase === "unauthorized";

beforeAll(() => { __setStorageForTest(fakeStorage); });
beforeEach(async () => {
  store = await seedStore({ only: [CI_MATHS] });
  __setKgStoreForTest(store);
});
afterAll(() => { __setKgStoreForTest(null); });

describe("the curriculum is open", () => {
  it("a signed-in non-member may enter a workspace they have no role in", async () => {
    const result = await callAs(GUEST, "set_context", { workspace: targetCtx.workspace, grade: "ci", subject: "maths" });
    expect(result.ok).toBe(true);
    expect(result.role).toBeNull();
    // Entering is allowed, but the response says plainly what a role would add.
    expect(String(result.note)).toMatch(/not a member/i);
  });

  it("set_context tells a member their role instead of the notice", async () => {
    const result = await callAs(CURATOR, "set_context", { workspace: targetCtx.workspace, grade: "ci", subject: "maths" });
    expect(result.ok).toBe(true);
    expect(result.role).toBe("curator");
    expect(result.note).toBeUndefined();
  });

  it("a non-member reads the published graph like anyone else", async () => {
    const stats = await callAs(GUEST, "namespace_stats");
    expect(refused(stats)).toBe(false);
    expect((stats.nodeCounts as Record<string, number>).Lesson).toBeGreaterThan(0);

    const found = await callAs(GUEST, "find_node", { query: "chapitre" });
    expect(refused(found)).toBe(false);
  });

  it("but the DRAFT stays shut — open reads are published reads only", async () => {
    const draftWalk = await callAs(GUEST, "walk_graph", { fromId: "anything", direction: "out", slot: "draft" });
    expect(refused(draftWalk)).toBe(true);
    expect(draftWalk.action).toBe("readDraft");
  });
});

describe("the workspace's live assets are members-only", () => {
  // Every tool that reaches the bucket, the history, or the metered translator.
  // Args are whatever gets past argument validation — the gate runs first, so a
  // non-member never reaches the point where they would matter.
  const READS = [
    ["reconcile", {}],
    ["list_documents", {}],
    ["create_download_url", { relPath: "chapitre_01/manuel.docx" }],
    ["get_document_text", { relPath: "chapitre_01/manuel.docx" }],
  ] as const;
  const WRITES = [
    ["create_upload_url", { relPath: "chapitre_01/manuel.docx" }],
    ["log_generation", { nodeId: "n-1", relPath: "chapitre_01/manuel.docx", content: {} }],
    ["record_document_content", { nodeId: "n-1", relPath: "chapitre_01/manuel.docx", content: {} }],
  ] as const;

  it.each([...READS, ...WRITES])("%s refuses a non-member", async (tool, args) => {
    const result = await callAs(GUEST, tool, args as Record<string, unknown>);
    expect(refused(result)).toBe(true);
    expect(String(result.message)).toMatch(/need one|Ask a workspace admin/i);
  });

  it("tags reads and writes as the distinct actions they are", async () => {
    expect((await callAs(GUEST, "reconcile")).action).toBe("readDocuments");
    expect((await callAs(GUEST, "create_upload_url", { relPath: "x.docx" })).action).toBe("writeDocuments");
  });

  it("translate refuses a non-member — it spends a metered backend", async () => {
    const result = await callAs(GUEST, "translate", { text: "bonjour" });
    expect(refused(result)).toBe(true);
    expect(result.action).toBe("translate");
  });

  it("records the refusal in the audit trail", async () => {
    await callAs(GUEST, "create_upload_url", { relPath: "chapitre_01/manuel.docx" });
    const blocked = await store.listAudit({ namespace: ns, eventType: "blocked", limit: 10 });
    expect(blocked.some((record) => record.actor.id === GUEST.id && /no role is assigned/.test(record.reason ?? ""))).toBe(true);
  });

  it("a curator passes the gate on all of them", async () => {
    for (const [tool, args] of READS) {
      expect(refused(await callAs(CURATOR, tool, args as Record<string, unknown>))).toBe(false);
    }
    // The write tools stop at their OWN next check (unknown scope node, or the
    // confirmation prompt) — either way the membership gate let them through.
    expect(refused(await callAs(CURATOR, "create_upload_url", { relPath: "x.docx" }))).toBe(false);
    expect(refused(await callAs(CURATOR, "log_generation", { nodeId: "n-1", relPath: "x.docx", content: {} }))).toBe(false);
    expect(refused(await callAs(CURATOR, "translate", { text: "bonjour" }))).toBe(false);
  });
});

describe("get_capabilities mirrors the split", () => {
  it("reports open reads and closed documents for a non-member", async () => {
    // `actions` rides the digest; the per-area `documents` block is a section,
    // asked for by name since the tool started projecting (WP2b).
    const report = await callAs(GUEST, "get_capabilities", { section: "documents" });
    const actions = report.actions as Record<string, boolean>;
    expect(actions.canReadGenerate).toBe(true);
    expect(actions.canReadDocuments).toBe(false);
    expect(actions.canWriteDocuments).toBe(false);
    expect(actions.canTranslate).toBe(false);
    expect(actions.canEditDraft).toBe(false);

    const documents = report.documents as Record<string, unknown>;
    expect(documents.canRead).toBe(false);
    expect(documents.canWrite).toBe(false);
  });

  it("reports both open for a curator", async () => {
    const report = await callAs(CURATOR, "get_capabilities");
    const actions = report.actions as Record<string, boolean>;
    expect(actions.canReadDocuments).toBe(true);
    expect(actions.canWriteDocuments).toBe(true);
    expect(actions.canTranslate).toBe(true);
  });
});
