#!/usr/bin/env node
/*
 * READ-ONLY diagnostic: what does each slot of a namespace actually hold?
 *
 * Written after a `seed:catalog` run deleted 19 live-authored entries from
 * senegal/_catalog/routines. The store is canonical + changeset overlay, so a
 * slot is not a plain copy — this prints both slots side by side to show whether
 * an intact pre-seed layer survives anywhere (which would make recovery a pointer
 * flip instead of a rebuild).
 *
 * Writes nothing. Safe to run any time.
 *
 *   node scripts/inspect-catalog-slots.mjs [namespace]
 *   (default namespace: senegal/_catalog/routines)
 */
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(resolve(REPO, "dist"))) {
  console.error("inspect-catalog-slots: dist/ not found — run `npm run build` first.");
  process.exit(1);
}

const { createFirestoreKgStore } = await import(new URL("../dist/kg-store/index.js", import.meta.url));
const namespace = process.argv[2] ?? "senegal/_catalog/routines";
const store = createFirestoreKgStore();

const pointer = await store.readPointer(namespace);
console.log(`namespace : ${namespace}`);
console.log(`pointer   : ${JSON.stringify(pointer)}`);

// A catalog ENTRY is a hasPart child of the root container, so count those rather
// than raw nodes — that is what list_catalog would show for this slot.
for (const slot of ["a", "b"]) {
  let nodes, edges;
  try {
    [nodes, edges] = await Promise.all([store.listNodes(namespace, slot), store.listEdges(namespace, slot)]);
  } catch (e) {
    console.log(`\nslot '${slot}': unreadable — ${e.message}`);
    continue;
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const entryIds = edges
    .filter((e) => e.type === "hasPart" && e.from === "catalog-root")
    .map((e) => e.to);

  console.log(`\nslot '${slot}': ${nodes.length} nodes, ${edges.length} edges, ${entryIds.length} entries`);
  for (const id of entryIds.sort()) {
    const raw = byId.get(id)?.properties?.raw ?? {};
    const kind = raw.metadata?.catalogKind ?? raw.metadata?.role ?? "";
    console.log(`   ${id}  ${kind ? `[${kind}] ` : ""}${raw.description ?? "(no description)"}`);
  }
}
