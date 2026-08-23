#!/usr/bin/env node
/*
 * READ-ONLY: list a namespace's nodes carrying a given LC label, flagging the ones
 * nothing points at.
 *
 * This exists because `walk_graph` needs a starting node and follows edges, so it
 * can never reach a node with no inbound edge. Such a node is invisible to every
 * MCP read while still being real data in the store — which is exactly when you
 * need to find it. Two unreferenced InstructionalRoutine copies in a subject graph
 * were found this way during the 2026-08-22 catalog recovery; without it they would
 * have been lost, since the recovery worked from what the graph could reach.
 *
 * Writes nothing.
 *
 *   node scripts/find-nodes-by-label.mjs <namespace> <Label>
 *   node scripts/find-nodes-by-label.mjs senegal/ce1/reading InstructionalRoutine
 */
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(resolve(REPO, "dist"))) {
  console.error("find-nodes-by-label: dist/ not found — run `npm run build` first.");
  process.exit(1);
}

const { createFirestoreKgStore } = await import(new URL("../dist/kg-store/index.js", import.meta.url));
const [namespace, label] = process.argv.slice(2);
if (!namespace || !label) {
  console.error("usage: node scripts/find-nodes-by-label.mjs <namespace> <Label>");
  process.exit(1);
}

const store = createFirestoreKgStore();
const pointer = await store.readPointer(namespace);
if (!pointer) {
  console.error(`no pointer for '${namespace}'`);
  process.exit(1);
}

const [nodes, edges] = await Promise.all([
  store.listNodes(namespace, pointer.publishedSlot),
  store.listEdges(namespace, pointer.publishedSlot),
]);

// Flag which ones nothing points at — those are the copies no MCP read can reach.
const referenced = new Set(edges.map((e) => e.to));
const matches = nodes.filter((n) => (n.labels ?? []).includes(label));

console.log(`${namespace} · ${label}: ${matches.length} node(s)\n`);
for (const node of matches.sort((a, b) => (a.properties?.raw?.description ?? "").localeCompare(b.properties?.raw?.description ?? ""))) {
  const orphan = referenced.has(node.id) ? "" : "   ← UNREFERENCED";
  console.log(`${node.id}  ${node.properties?.raw?.description ?? "(no description)"}${orphan}`);
}
