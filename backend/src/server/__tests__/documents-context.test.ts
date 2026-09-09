/*
 * A document tool naming its own namespace — and being authorized against it.
 *
 * THE DEFECT, reported from a real authoring session. Every relPath a document
 * tool takes is namespace-relative: docKey() prefixes it with
 * `<workspace>/<grade>/<subject>/documents/`. The active namespace lives in the
 * session bag, and a session is one CONNECTION, so it can move between two of
 * one caller's own calls. It did, twice. `walk_graph` failed loudly. But
 * `create_download_url` returned a perfectly valid signed URL with
 * `exists: false` — which reads as "that file is not in the bucket", not "you
 * are in the wrong subject". Twenty minutes later the same drift would have had
 * create_upload_url + log_generation write a maths sheet into the reading
 * namespace, live, with no draft and no undo.
 *
 * So two properties are pinned here, and the second is the one with teeth:
 *
 *   1. A path-based response NAMES its namespace, and a miss explains itself.
 *   2. A call carrying `context` is authorized against THAT namespace. Checking
 *      membership outside the override would authorize against the session's
 *      workspace and then write to the named one — a worse hole than the drift
 *      it was meant to close. Nigeria is seeded precisely so there is a real
 *      second workspace to be refused in.
 *
 * Driven through the REAL assembled server, like open-reads.test.ts: the thing
 * worth testing is the wiring — that the gate sits inside the override — not
 * that authorize() returns the right boolean.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { seedStore, seededContexts, CI_MATHS, CE1_READING, withActiveContext as inContext } from "../../__tests__/index.js";
import { __setKgStoreForTest, kgNamespace, type KgNodeStore } from "../../kg-store/index.js";
import { __setStorageForTest } from "../../storage/index.js";
import { docKey } from "../../context/index.js";
import { buildServer } from "../index.js";
import type { Actor } from "../../actor.js";
import type { StorageAdapter, HistoryFile } from "../../types.js";

// The nigeria fixture is a genuinely different WORKSPACE, which is what makes a
// cross-workspace refusal testable — senegal's two fixtures share a workspace
// and so share a membership.
const NG_MATHS = "primary-1-3/maths";

// A curator via the legacy app_role bridge, which grants the role in the DEFAULT
// workspace ("senegal") and nowhere else — so this actor is a member of senegal
// and a stranger in nigeria.
const SENEGAL_CURATOR: Actor = { id: "curator-uid", email: "curator@test", role: "curator", unknown: false };

const senegal = seededContexts([CI_MATHS]).find((c) => c.grade === "ci" && c.subject === "maths")!;
const NIGERIA = { workspace: "nigeria", grade: "primary-1-3", subject: "maths" };

/*
 * A storage stub that answers with the REAL object key.
 *
 * The shared `fakeStorage` returns empty strings, which would let a test pass
 * while the signed URL pointed at the wrong namespace — the exact failure under
 * examination. `docKey` reads the ambient context, so the key it produces here
 * is the one production would produce.
 */
const emptyHistory: HistoryFile = { version: 4, entries: [] };
function storageHolding(paths: string[]): StorageAdapter {
  return {
    listDocuments: async () => paths.map((relPath) => ({ relPath, md5: "x", updated: null })),
    getObjectMd5: async () => "x",
    downloadDocx: async () => Buffer.from(""),
    createUploadUrl: async (relPath) => ({ url: "https://signed/put", objectKey: docKey(relPath), contentType: "docx", expiresAt: "" }),
    createMediaUpload: async (relPath, contentType) => ({ url: "https://signed/media", objectKey: docKey(relPath), contentType, expiresAt: "" }),
    createDownloadUrl: async (relPath) => ({ url: "https://signed/get", objectKey: docKey(relPath), expiresAt: "", exists: paths.includes(relPath) }),
    readHistory: async () => emptyHistory,
    writeHistory: async () => {},
  };
}

let store: KgNodeStore;

// One connected client per call, inside the actor's session on the senegal
// context — every test here starts from "the session is on ci/maths".
async function callAs(actor: Actor, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return inContext(senegal, actor, async () => {
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

beforeEach(async () => {
  store = await seedStore({ only: [CI_MATHS, CE1_READING, NG_MATHS] });
  __setKgStoreForTest(store);
  __setStorageForTest(storageHolding(["chapitre_05/Manuel.docx"]));
});
afterAll(() => { __setKgStoreForTest(null); });

describe("a path-based response says which namespace it resolved in", () => {
  it("echoes the namespace on a hit, alongside the object key", async () => {
    const result = await callAs(SENEGAL_CURATOR, "create_download_url", { relPath: "chapitre_05/Manuel.docx" });

    expect(result.exists).toBe(true);
    expect(result.namespace).toBe(kgNamespace("senegal", "ci", "maths"));
    // A hit needs no explanation, so none is offered.
    expect(result.note).toBeUndefined();
  });

  it("explains a miss inside a folder that DOES exist", async () => {
    const result = await callAs(SENEGAL_CURATOR, "create_download_url", { relPath: "chapitre_05/Absent.docx" });

    expect(result.exists).toBe(false);
    // The reported alternative is what is actually there — the point being that
    // the caller can see the folder was found and only the file was not.
    expect(String(result.note)).toContain("chapitre_05/Manuel.docx");
  });

  it("says the FOLDER is absent, not the file, and names the folders that exist", async () => {
    const result = await callAs(SENEGAL_CURATOR, "create_download_url", { relPath: "lecon_03/Fiche.docx" });

    // This is the reported case verbatim: the path does not exist here at all.
    expect(String(result.note)).toContain("No 'lecon_03/'");
    expect(String(result.note)).toContain("chapitre_05/");
    expect(String(result.note)).toMatch(/get_context/);
  });

  it("names the wrong-context suspicion when the namespace holds NOTHING", async () => {
    __setStorageForTest(storageHolding([]));
    const result = await callAs(SENEGAL_CURATOR, "create_download_url", { relPath: "lecon_03/Fiche.docx" });

    // An empty namespace is the strongest signal available that the CONTEXT is
    // wrong rather than the path, so it is said in those terms.
    expect(String(result.note)).toMatch(/NO documents at all/);
    expect(String(result.note)).toMatch(/context/);
  });
});

describe("a document tool can name its own namespace", () => {
  it("reads the named namespace and leaves the session's selection alone", async () => {
    const result = await callAs(SENEGAL_CURATOR, "list_documents", { context: { workspace: "senegal", grade: "ce1", subject: "reading" } });

    expect(result.namespace).toBe(kgNamespace("senegal", "ce1", "reading"));
  });

  it("signs the upload URL against the NAMED namespace, not the session's", async () => {
    const result = await callAs(SENEGAL_CURATOR, "create_upload_url", {
      relPath: "lecon_03/Fiche.docx",
      confirm: true,
      context: { workspace: "senegal", grade: "ce1", subject: "reading" },
    });

    expect(result.namespace).toBe(kgNamespace("senegal", "ce1", "reading"));
    // The key is the proof: a gate that ran outside the override would have
    // authorized ci/maths and signed this same reading key anyway.
    expect(String(result.objectKey)).toContain("senegal/ce1/reading/documents/");
  });

  it("names the namespace in the confirmation, so approving is an informed act", async () => {
    const notice = await callAs(SENEGAL_CURATOR, "create_upload_url", {
      relPath: "lecon_03/Fiche.docx",
      context: { workspace: "senegal", grade: "ce1", subject: "reading" },
    });

    expect(notice.needsConfirmation).toBeTruthy();
    expect(JSON.stringify(notice)).toContain("senegal/ce1/reading");
  });

  it("refuses a namespace that does not exist rather than reporting a missing file", async () => {
    const result = await callAs(SENEGAL_CURATOR, "create_download_url", {
      relPath: "chapitre_05/Manuel.docx",
      context: { workspace: "senegal", grade: "ce9", subject: "maths" },
    });

    expect(String(result.error)).toMatch(/Cannot act on workspace 'senegal'/);
  });
});

describe("the membership gate is applied to the NAMED namespace", () => {
  it("refuses a write into a workspace the caller has no role in", async () => {
    // The session is on senegal/ci/maths, where this actor IS a curator. The
    // call names nigeria, where they are nobody. Authorizing against the session
    // would let this through and then write to nigeria.
    const result = await callAs(SENEGAL_CURATOR, "create_upload_url", {
      relPath: "week_01/Sheet.docx",
      confirm: true,
      context: NIGERIA,
    });

    expect(refused(result)).toBe(true);
    expect(result.action).toBe("writeDocuments");
    expect(result.objectKey).toBeUndefined();
  });

  it("refuses a history write into that workspace too", async () => {
    const result = await callAs(SENEGAL_CURATOR, "log_generation", {
      nodeId: "whatever",
      relPath: "week_01/Sheet.docx",
      content: {},
      confirm: true,
      context: NIGERIA,
    });

    expect(refused(result)).toBe(true);
    // Refused BEFORE the scope-node check: an outsider learns nothing about
    // which ids the graph holds.
    expect(String(JSON.stringify(result))).not.toMatch(/No node/);
  });

  it("audits the refusal against the NAMED namespace, not the session's", async () => {
    await callAs(SENEGAL_CURATOR, "create_upload_url", { relPath: "week_01/Sheet.docx", confirm: true, context: NIGERIA });

    const blocked = (await store.listAudit({})).filter((record) => record.eventType === "blocked");
    expect(blocked.length).toBeGreaterThan(0);
    // The audit namespace is the observable proof of WHICH namespace the gate
    // evaluated. Were it senegal's, the check ran outside the override.
    expect(blocked[0].namespace).toBe(kgNamespace("nigeria", "primary-1-3", "maths"));
  });

  it("still allows the same write in a workspace the caller DOES belong to", async () => {
    const result = await callAs(SENEGAL_CURATOR, "create_upload_url", {
      relPath: "chapitre_05/Manuel.docx",
      confirm: true,
      context: { workspace: "senegal", grade: "ci", subject: "maths" },
    });

    expect(refused(result)).toBe(false);
    expect(String(result.objectKey)).toContain("senegal/ci/maths/documents/");
  });
});

describe("create_media_upload_url — an image the render tree references by relPath", () => {
  it("signs an image URL with the type inferred from the extension, in the named namespace", async () => {
    const result = await callAs(SENEGAL_CURATOR, "create_media_upload_url", {
      relPath: "media/lecon-22/photo.png",
      confirm: true,
      context: { workspace: "senegal", grade: "ce1", subject: "reading" },
    });

    expect(result.contentType).toBe("image/png");
    expect(result.namespace).toBe(kgNamespace("senegal", "ce1", "reading"));
    // Same documents/ keyspace render resolves a media relPath against.
    expect(String(result.objectKey)).toContain("senegal/ce1/reading/documents/media/lecon-22/photo.png");
  });

  it("requires confirmation before it signs, like every live write", async () => {
    const notice = await callAs(SENEGAL_CURATOR, "create_media_upload_url", { relPath: "media/a.jpg" });
    expect(notice.needsConfirmation).toBeTruthy();
    expect(notice.url).toBeUndefined();
  });

  it("refuses a non-image extension — render can only embed raster pictures", async () => {
    const result = await callAs(SENEGAL_CURATOR, "create_media_upload_url", { relPath: "notes/plan.docx", confirm: true });
    expect(String((result.error as { message?: string })?.message ?? result.error)).toMatch(/not a supported image/);
    expect(result.url).toBeUndefined();
  });

  it("is gated to the NAMED namespace, so a role elsewhere cannot sign here", async () => {
    const result = await callAs(SENEGAL_CURATOR, "create_media_upload_url", {
      relPath: "media/a.png",
      confirm: true,
      context: NIGERIA,
    });
    expect(refused(result)).toBe(true);
    expect(result.action).toBe("writeDocuments");
    expect(result.url).toBeUndefined();
  });
});
