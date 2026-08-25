/*
 * Token-cost bench for the MCP tool surface.
 *
 * Drives the REAL assembled server (buildServer) over an in-memory transport
 * against the committed fixtures and measures the bytes each tool puts in front
 * of the model. Two costs are separated because they behave differently:
 *
 *   • the MANIFEST (tools/list) — paid EVERY turn, whether or not a tool is
 *     called, so a byte here is worth many bytes in any single payload;
 *   • each tool RESPONSE — paid once, by whoever calls it.
 *
 * Tokens are estimated as bytes / 3.7 (the ratio the 2026-08-25 audit used):
 * ratios are reliable, absolutes ±10%. Any number here describes the FIXTURE,
 * not production — the two have drifted before (see PR #205).
 *
 * Not part of `npm test`'s intent — it asserts nothing, it reports. Run it as:
 *   BENCH_REPORT=/tmp/bench.txt npx vitest run src/__bench__/token-cost.test.ts
 */
import { describe, it, beforeAll, beforeEach, afterAll } from "vitest";
import { appendFileSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { seedStore, seededContexts, fakeStorage, withActiveContext as inContext } from "../__tests__/index.js";
import { __setKgStoreForTest, type KgNodeStore } from "../kg-store/index.js";
import { __setStorageForTest } from "../storage/index.js";
import { buildServer } from "../server/index.js";
import type { Actor } from "../actor.js";
import type { ActiveContext } from "../context/index.js";

// Vitest intercepts console output, so the report goes to a file.
// Opt-in: without BENCH_REPORT the suite is skipped, so `npm test` neither runs
// the bench nor drops a report file in the working tree.
const REPORT = process.env.BENCH_REPORT;
const bench = describe.skipIf(!REPORT);
const emit = (line: string): void => appendFileSync(REPORT!, line + "\n");

const CURATOR: Actor = { id: "curator-uid", email: "curator@test", role: "curator", unknown: false };
const BYTES_PER_TOKEN = 3.7;
const tokens = (bytes: number) => Math.round(bytes / BYTES_PER_TOKEN);

// Fixture landmarks, taken from the committed graphs.
const MATHS_COURSE = "6510819b-90fd-53d3-ada1-3c7d32a18ef0";
const MATHS_TEACHER_GUIDE = "45a42c07-1263-5a69-bf1c-a0718d7fcd07";
const MATHS_STUDENT_TOOL = "a51f831c-3c6d-52ae-aa14-a2f69e988d68";
const MATHS_LESSON = "01ea5bbc-eecd-593c-bea8-54383dfc5d09";

const ctx = (grade: string, subject: string): ActiveContext =>
  seededContexts().find((c) => c.grade === grade && c.subject === subject)!;

let store: KgNodeStore;

/**
 * Call one tool and return the bytes the model would see.
 *
 * A tool answers with text blocks OR a resource block (get_graph_guide does),
 * and both land in the model's context — measuring only `text` silently scored
 * the guide at zero.
 */
async function callBytes(context: ActiveContext, name: string, args: Record<string, unknown> = {}): Promise<{ bytes: number; text: string }> {
  return inContext(context, CURATOR, async () => {
    const client = new Client({ name: "bench", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), buildServer().connect(serverTransport)]);
    try {
      const result = (await client.callTool({ name, arguments: args })) as {
        content: Array<{ type: string; text?: string; resource?: { text?: string } }>;
      };
      const text = result.content.map((block) => block.text ?? block.resource?.text ?? "").join("");
      return { bytes: Buffer.byteLength(text), text };
    } finally {
      await client.close();
    }
  });
}

type Row = { label: string; bytes: number; note?: string };

function report(title: string, entries: Row[]): void {
  const width = Math.max(...entries.map((r) => r.label.length), 5);
  const total = entries.reduce((sum, r) => sum + r.bytes, 0);
  emit(`\n── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}`);
  for (const r of entries) {
    emit(`${r.label.padEnd(width)}  ${String(r.bytes).padStart(8)} B  ${String(tokens(r.bytes)).padStart(7)} tok${r.note ? `   ${r.note}` : ""}`);
  }
  emit(`${"TOTAL".padEnd(width)}  ${String(total).padStart(8)} B  ${String(tokens(total)).padStart(7)} tok`);
}

beforeAll(() => { __setStorageForTest(fakeStorage); if (REPORT) writeFileSync(REPORT, ""); });
beforeEach(async () => {
  // withProfiles seeds each namespace's config cell, so the guide-reading tools
  // are measured with a guide present — as production has one.
  store = await seedStore({ withProfiles: true });
  __setKgStoreForTest(store);
});
afterAll(() => { __setKgStoreForTest(null); });

bench("token cost", () => {
  it("the tool manifest — the per-turn fixed cost", async () => {
    const client = new Client({ name: "bench", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), buildServer().connect(serverTransport)]);
    const { tools } = await client.listTools();
    await client.close();

    const per = tools
      .map((t) => ({
        name: t.name,
        all: Buffer.byteLength(JSON.stringify(t)),
        desc: Buffer.byteLength(t.description ?? ""),
        schema: Buffer.byteLength(JSON.stringify(t.inputSchema ?? {})),
      }))
      .sort((a, b) => b.all - a.all);

    const sum = (pick: (t: (typeof per)[number]) => number) => per.reduce((s, t) => s + pick(t), 0);
    const totalAll = sum((t) => t.all);

    emit(`\n══ MANIFEST — ${tools.length} tools, paid every turn ══`);
    emit(`whole manifest   ${totalAll} B  ≈ ${tokens(totalAll)} tok`);
    emit(`  descriptions   ${sum((t) => t.desc)} B  ≈ ${tokens(sum((t) => t.desc))} tok  (${((sum((t) => t.desc) / totalAll) * 100).toFixed(1)}%)`);
    emit(`  input schemas  ${sum((t) => t.schema)} B  ≈ ${tokens(sum((t) => t.schema))} tok  (${((sum((t) => t.schema) / totalAll) * 100).toFixed(1)}%)`);
    emit(`\ntop 15 tools by manifest cost:`);
    for (const t of per.slice(0, 15)) {
      emit(`  ${t.name.padEnd(26)} ${String(t.all).padStart(6)} B  ${String(tokens(t.all)).padStart(5)} tok  (desc ${tokens(t.desc)} / schema ${tokens(t.schema)})`);
    }
    const tail = per.slice(15).reduce((s, t) => s + t.all, 0);
    emit(`  ${`… ${per.length - 15} others`.padEnd(26)} ${String(tail).padStart(6)} B  ${String(tokens(tail)).padStart(5)} tok`);
  });

  it("orientation reads — what a session pays before touching the graph", async () => {
    const maths = ctx("ci", "maths");
    const entries: Row[] = [];
    for (const name of ["get_context", "start_here", "namespace_stats", "list_catalog", "get_capabilities", "get_graph_guide"]) {
      entries.push({ label: name, bytes: (await callBytes(maths, name)).bytes });
    }
    entries.push({ label: "find_node 'addition'", bytes: (await callBytes(maths, "find_node", { query: "addition" })).bytes });
    report("ORIENTATION (ci/maths)", entries);
  });

  it("curriculum traversal — one page vs the whole Course subtree", async () => {
    const maths = ctx("ci", "maths");
    const entries: Row[] = [];

    const firstPage = await callBytes(maths, "walk_graph", { fromId: MATHS_COURSE, direction: "out" });
    const firstPageNodes = (JSON.parse(firstPage.text) as { nodes: unknown[] }).nodes.length;
    entries.push({ label: "walk_graph (1 default page)", bytes: firstPage.bytes, note: `${firstPageNodes} nodes` });
    entries.push({ label: "walk_graph (1 page, includeEdges)", bytes: (await callBytes(maths, "walk_graph", { fromId: MATHS_COURSE, direction: "out", includeEdges: true })).bytes });

    // Page the whole subtree the way a real caller must.
    let cursor: string | undefined;
    let pages = 0;
    let subtreeBytes = 0;
    let nodesSeen = 0;
    do {
      const { bytes, text } = await callBytes(maths, "walk_graph", { fromId: MATHS_COURSE, direction: "out", ...(cursor ? { cursor } : {}) });
      subtreeBytes += bytes;
      pages += 1;
      const payload = JSON.parse(text) as { nextCursor?: string; nodes?: unknown[] };
      nodesSeen += (payload.nodes ?? []).length;
      cursor = payload.nextCursor;
    } while (cursor && pages < 40);
    entries.push({ label: "walk_graph FULL Course subtree", bytes: subtreeBytes, note: `${pages} pages, ${nodesSeen} nodes` });

    report("TRAVERSAL (ci/maths Course)", entries);
  });

  it("generation + review reads", async () => {
    const maths = ctx("ci", "maths");
    const entries: Row[] = [
      { label: "walk_document — Guide de l'enseignant", bytes: (await callBytes(maths, "walk_document", { tlmId: MATHS_TEACHER_GUIDE })).bytes },
      { label: "walk_document — Outil de l'élève", bytes: (await callBytes(maths, "walk_document", { tlmId: MATHS_STUDENT_TOOL })).bytes },
      { label: "get_standards (one Lesson)", bytes: (await callBytes(maths, "get_standards", { nodeId: MATHS_LESSON })).bytes },
      { label: "review_draft", bytes: (await callBytes(maths, "review_draft")).bytes },
      { label: "review_draft (includeGuide:false)", bytes: (await callBytes(maths, "review_draft", { includeGuide: false })).bytes },
      { label: "check_draft", bytes: (await callBytes(maths, "check_draft")).bytes },
    ];
    report("GENERATION / REVIEW (ci/maths)", entries);
  });

  it("the biggest graph — ce1/reading", async () => {
    const reading = ctx("ce1", "reading");
    const stats = await callBytes(reading, "namespace_stats");
    const roots = (JSON.parse(stats.text) as { roots: Array<{ id: string }> }).roots;

    // walk_graph fills each page to a BYTE budget, so a cheaper node does not
    // shrink the page — it puts more nodes in it. Cost per node delivered, and
    // pages needed to finish, are what actually move.
    const page = await callBytes(reading, "walk_graph", { fromId: roots[0].id, direction: "out" });
    const pageNodes = (JSON.parse(page.text) as { nodes: unknown[] }).nodes.length;

    let cursor: string | undefined;
    let pages = 0;
    let walkBytes = 0;
    let walkNodes = 0;
    do {
      const { bytes, text } = await callBytes(reading, "walk_graph", { fromId: roots[0].id, direction: "out", ...(cursor ? { cursor } : {}) });
      walkBytes += bytes;
      pages += 1;
      const payload = JSON.parse(text) as { nextCursor?: string; nodes?: unknown[] };
      walkNodes += (payload.nodes ?? []).length;
      cursor = payload.nextCursor;
    } while (cursor && pages < 60);

    const entries: Row[] = [
      { label: "namespace_stats", bytes: stats.bytes, note: `${roots.length} roots listed` },
      { label: "walk_graph 1 page from a root", bytes: page.bytes, note: `${pageNodes} nodes → ${Math.round(page.bytes / pageNodes / 3.7)} tok/node` },
      { label: "walk_graph FULL root subtree", bytes: walkBytes, note: `${pages} pages, ${walkNodes} nodes` },
      { label: "find_node 'Expression Orale'", bytes: (await callBytes(reading, "find_node", { query: "Expression Orale" })).bytes },
      { label: "get_graph_guide", bytes: (await callBytes(reading, "get_graph_guide")).bytes },
    ];
    report("ce1/reading (1968 nodes)", entries);
  });

  it("the oversize backstop — what a caller gets when a payload blows the cap", async () => {
    const reading = ctx("ce1", "reading");
    const stats = await callBytes(reading, "namespace_stats");
    const rootId = (JSON.parse(stats.text) as { roots: Array<{ id: string }> }).roots[0].id;
    // Deliberately greedy: max page + edges on the largest graph.
    const greedy = await callBytes(reading, "walk_graph", { fromId: rootId, direction: "out", limit: 500, includeEdges: true });
    const payload = JSON.parse(greedy.text) as Record<string, unknown>;
    emit(`\n── OVERSIZE BACKSTOP ───────────────────────────────────────`);
    emit(`walk_graph limit:500 includeEdges:true → ${greedy.bytes} B (${tokens(greedy.bytes)} tok)`);
    emit(`keys: ${Object.keys(payload).join(", ")}`);
    emit(greedy.text.slice(0, 600));
  });
});
