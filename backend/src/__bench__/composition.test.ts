/*
 * Where the bytes actually go inside a read payload.
 *
 * The bench says walk_document costs ~21k tokens; this says WHICH keys those
 * bytes are. Run alongside token-cost.test.ts.
 */
import { describe, it, beforeAll, beforeEach } from "vitest";
import { appendFileSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { seedStore, seededContexts, fakeStorage, withActiveContext as inContext } from "../__tests__/index.js";
import { __setKgStoreForTest } from "../kg-store/index.js";
import { __setStorageForTest } from "../storage/index.js";
import { buildServer } from "../server/index.js";
import type { ActiveContext } from "../context/index.js";

// Opt-in: without BENCH_REPORT the suite is skipped (see token-cost.test.ts).
const REPORT = process.env.BENCH_REPORT;
const bench = describe.skipIf(!REPORT);
const emit = (line: string): void => appendFileSync(REPORT!, line + "\n");
const CURATOR = { id: "curator-uid", email: "curator@test", role: "curator" as const, unknown: false };
const tokens = (bytes: number) => Math.round(bytes / 3.7);
const ctx = (grade: string, subject: string): ActiveContext => seededContexts().find((c) => c.grade === grade && c.subject === subject)!;

async function callText(context: ActiveContext, name: string, args: Record<string, unknown> = {}): Promise<string> {
  return inContext(context, CURATOR, async () => {
    const client = new Client({ name: "bench", version: "0.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(a), buildServer().connect(b)]);
    try {
      const r = (await client.callTool({ name, arguments: args })) as { content: Array<{ text?: string; resource?: { text?: string } }> };
      return r.content.map((c) => c.text ?? c.resource?.text ?? "").join("");
    } finally { await client.close(); }
  });
}

// Sum the serialized size of every occurrence of each property key, anywhere in
// the payload — the question a reader cares about is "what am I paying for",
// not where in the tree it sits.
function keyWeights(value: unknown, into: Map<string, number> = new Map(), path = ""): Map<string, number> {
  if (Array.isArray(value)) {
    for (const item of value) keyWeights(item, into, path);
    return into;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      // Attribute the whole subtree to the key, then keep descending only through
      // the structural containers (nodes/edges/properties) we want broken down.
      const bytes = Buffer.byteLength(JSON.stringify(child) ?? "");
      into.set(key, (into.get(key) ?? 0) + bytes);
      if (["nodes", "edges", "relationships", "properties", "curriculum", "document", "sections", "raw"].includes(key)) {
        keyWeights(child, into, `${path}.${key}`);
      }
    }
  }
  return into;
}

function breakdown(title: string, text: string): void {
  const total = Buffer.byteLength(text);
  emit(`\n── ${title}: ${total} B ≈ ${tokens(total)} tok ───────────────`);
  const weights = [...keyWeights(JSON.parse(text))].sort((a, b) => b[1] - a[1]).slice(0, 14);
  for (const [key, bytes] of weights) {
    emit(`  ${key.padEnd(26)} ${String(bytes).padStart(7)} B  ${String(tokens(bytes)).padStart(6)} tok  ${((bytes / total) * 100).toFixed(1)}%`);
  }
}

beforeAll(() => { __setStorageForTest(fakeStorage); if (REPORT) writeFileSync(REPORT, ""); });
beforeEach(async () => { __setKgStoreForTest(await seedStore({ withProfiles: true })); });

bench("payload composition", () => {
  it("breaks the big reads down by property key", async () => {
    const maths = ctx("ci", "maths");
    breakdown("walk_document — Guide de l'enseignant (ci/maths)", await callText(maths, "walk_document", { tlmId: "45a42c07-1263-5a69-bf1c-a0718d7fcd07" }));
    breakdown("walk_graph 1 page (ci/maths Course)", await callText(maths, "walk_graph", { fromId: "6510819b-90fd-53d3-ada1-3c7d32a18ef0", direction: "out" }));
    const reading = ctx("ce1", "reading");
    const stats = await callText(reading, "namespace_stats");
    const rootId = (JSON.parse(stats) as { roots: Array<{ id: string }> }).roots[0].id;
    breakdown("walk_graph 1 page (ce1/reading)", await callText(reading, "walk_graph", { fromId: rootId, direction: "out" }));
    breakdown("get_capabilities (ci/maths)", await callText(maths, "get_capabilities"));
  });
});

bench("inside metadata", () => {
  it("splits the extension sidecar into extraction provenance vs authored fields", async () => {
    for (const [label, context, args] of [
      ["ce1/reading page", ctx("ce1", "reading"), null],
      ["ci/maths Course page", ctx("ci", "maths"), { fromId: "6510819b-90fd-53d3-ada1-3c7d32a18ef0", direction: "out" }],
    ] as Array<[string, ActiveContext, Record<string, unknown> | null]>) {
      let walkArgs = args;
      if (!walkArgs) {
        const stats = await callText(context, "namespace_stats");
        walkArgs = { fromId: (JSON.parse(stats) as { roots: Array<{ id: string }> }).roots[0].id, direction: "out" };
      }
      const text = await callText(context, "walk_graph", walkArgs);
      const payload = JSON.parse(text) as { nodes: Array<{ properties?: Record<string, unknown> }> };
      const weights = new Map<string, number>();
      let metaTotal = 0;
      for (const node of payload.nodes) {
        const meta = node.properties?.metadata as Record<string, unknown> | undefined;
        if (!meta) continue;
        metaTotal += Buffer.byteLength(JSON.stringify(meta));
        for (const [key, value] of Object.entries(meta)) {
          weights.set(key, (weights.get(key) ?? 0) + Buffer.byteLength(JSON.stringify(value) ?? ""));
        }
      }
      emit(`\n── metadata inside ${label}: ${metaTotal} B ≈ ${tokens(metaTotal)} tok over ${payload.nodes.length} nodes ──`);
      for (const [key, bytes] of [...weights].sort((a, b) => b[1] - a[1])) {
        emit(`  metadata.${key.padEnd(24)} ${String(bytes).padStart(7)} B  ${String(tokens(bytes)).padStart(6)} tok`);
      }
    }
  });
});
