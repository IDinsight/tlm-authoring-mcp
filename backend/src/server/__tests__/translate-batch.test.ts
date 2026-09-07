/*
 * The translate TOOL's two shapes — one passage, and many.
 *
 * The service-level mechanics (order, per-item grounding, partial failure) are
 * pinned in src/translation/__tests__/batch.test.ts. What is left to the tool,
 * and tested here, is the SHAPING: a lone `text` keeps the flat response every
 * existing caller reads, `texts` returns an indexed array, and a batch that
 * partly failed says so out loud rather than handing back a short list that
 * looks complete.
 *
 * Driven through the real assembled server, like open-reads.test.ts. Fetch is
 * stubbed; the real Gemini API is never called.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { seedStore, seededContexts, fakeStorage, CI_MATHS, withActiveContext as inContext } from "../../__tests__/index.js";
import { __setKgStoreForTest, type KgNodeStore } from "../../kg-store/index.js";
import { __setStorageForTest } from "../../storage/index.js";
import { CONFIG } from "../../config.js";
import { buildServer } from "../index.js";
import type { Actor } from "../../actor.js";

const CURATOR: Actor = { id: "curator-uid", email: "curator@test", role: "curator", unknown: false };
const ctx = seededContexts([CI_MATHS]).find((c) => c.grade === "ci" && c.subject === "maths")!;

let store: KgNodeStore;

async function call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  return inContext(ctx, CURATOR, async () => {
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const server = buildServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const result = await client.callTool({ name: "translate", arguments: args });
    return JSON.parse((result as { content: Array<{ text: string }> }).content[0].text) as Record<string, unknown>;
  });
}

// Echo the passage back, so a misrouted result is visible rather than plausible.
function stubEcho() {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const sent = JSON.parse(String(init.body)).contents[0].parts[0].text as string;
    return {
      ok: true, status: 200, statusText: "OK",
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sourceLanguage: "French", targetLanguage: "Wolof", translation: `wo(${sent})` }) }] } }] }),
    };
  }) as unknown as typeof fetch);
}

beforeEach(async () => {
  store = await seedStore({ only: [CI_MATHS] });
  __setKgStoreForTest(store);
  __setStorageForTest(fakeStorage);
  CONFIG.gemini.apiKey = "test-key";
  CONFIG.gemini.model = "gemini-3.6-flash";
});
afterEach(() => { vi.unstubAllGlobals(); CONFIG.gemini.apiKey = ""; });
afterAll(() => { __setKgStoreForTest(null); });

describe("translate — one passage", () => {
  it("keeps the flat response an existing caller reads", async () => {
    stubEcho();
    const result = await call({ text: "Bonjour" });

    expect(result.translation).toBe("wo(Bonjour)");
    // A batch of one is not what a caller passing `text` asked for, so there is
    // no `results` array to unwrap.
    expect(result.results).toBeUndefined();
  });

  it("reports the term bank it was grounded in as a LIST, not a count", async () => {
    stubEcho();
    const result = await call({ text: "Bonjour" });

    // The count told a caller that grounding happened and nothing about what it
    // grounded ON — which is how a mis-grounded term went unnoticed until someone
    // read the Wolof. An empty glossary here still proves the shape is a list.
    expect(Array.isArray(result.glossaryTerms)).toBe(true);
    expect(result.glossaryTermsUsed).toBeUndefined();
  });
});

describe("translate — several passages", () => {
  it("returns one indexed result per input, in order", async () => {
    stubEcho();
    const texts = ["un", "deux", "trois"];
    const result = await call({ texts });

    expect(result.count).toBe(3);
    const results = result.results as Array<{ index: number; text: string; translation: string }>;
    results.forEach((item, i) => {
      expect(item.index).toBe(i);
      expect(item.translation).toBe(`wo(${texts[i]})`);
    });
    // Nothing failed, so nothing is flagged.
    expect(result.failed).toBeUndefined();
  });

  it("says out loud when part of the batch failed", async () => {
    let call_n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      call_n += 1;
      if (call_n === 1) return { ok: false, status: 400, statusText: "Bad", text: async () => "blocked" };
      return { ok: true, status: 200, statusText: "OK", json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sourceLanguage: "French", targetLanguage: "Wolof", translation: "ok" }) }] } }] }) };
    }) as unknown as typeof fetch);

    const result = await call({ texts: ["a", "b"] });

    // A partial batch that looked complete would be the same silent misalignment
    // the array shape exists to prevent.
    expect(result.failed).toBe(1);
    expect(String(result.note)).toMatch(/retry only the failures, by index/);
    expect((result.results as unknown[]).length).toBe(2);
  });

  it("refuses when neither text nor texts is given", async () => {
    stubEcho();
    expect(String((await call({})).error)).toMatch(/needs `text`.*or `texts`/);
  });
});
