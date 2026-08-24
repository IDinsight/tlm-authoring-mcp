#!/usr/bin/env node
/*
 * READ-ONLY diagnostic: does any namespace still carry a RETIRED profile key?
 *
 * Written while retiring `capabilities` from the subject-profile schema. The
 * schema is `.strict()`, so a leftover key in a cell that gets VALIDATED makes
 * that namespace refuse to activate — an outage, not a degraded read. Before
 * dropping a key from `RETIRED_PROFILE_KEYS` (src/adapters/profile.ts), every
 * stored cell must be clean; this is how you check rather than assume.
 *
 * It walks EVERY namespace the store holds — including the reserved `_catalog`
 * and `_glossary` partitions, which no enterable context covers and which
 * `set_context` / `get_profile` therefore cannot reach.
 *
 * Writes nothing. Safe to run any time.
 *
 * Env (same as import-kg): SERVICE_ACCOUNT_KEY_PATH (or SERVICE_ACCOUNT_KEY_JSON),
 * FIREBASE_STORAGE_BUCKET, and TLM_BUCKET_PREFIX to match the runtime namespace.
 *
 *   npm run build && node scripts/check-config-cells.mjs
 */
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(resolve(REPO, "dist"))) {
  console.error("check-config-cells: dist/ not found — run `npm run build` first.");
  process.exit(1);
}

const { createFirestoreKgStore } = await import(new URL("../dist/kg-store/index.js", import.meta.url));

// The keys the current schema no longer models. Keep in step with
// RETIRED_PROFILE_KEYS in src/adapters/profile.ts.
const RETIRED = ["capabilities", "deliverables"];

const store = createFirestoreKgStore();
const namespaces = await store.listNamespaces();
console.log(`check-config-cells: ${namespaces.length} namespace(s)\n`);

let flagged = 0;
for (const ns of [...namespaces].sort()) {
  const pointer = await store.readPointer(ns);
  if (!pointer) {
    console.log(`${ns}\n   (no pointer)`);
    continue;
  }

  // Check BOTH slots: an open draft can carry its own config cell, and that cell
  // becomes published the moment someone publishes the draft.
  const lines = [];
  for (const slot of [pointer.publishedSlot, pointer.draftSlot].filter(Boolean)) {
    const cell = await store.readConfig(ns, slot);
    if (!cell) {
      lines.push(`slot '${slot}': no config cell`);
      continue;
    }
    // A pre-2c cell is a FLAT SubjectProfile; a current one is { core, guide }.
    const core = cell.core ?? cell;
    const keys = core && typeof core === "object" ? Object.keys(core) : [];
    const found = RETIRED.filter((key) => keys.includes(key));
    if (found.length > 0) flagged += 1;
    lines.push(
      `slot '${slot}': core keys [${keys.join(", ")}]` +
        (found.length > 0 ? `   <-- RETIRED KEY PRESENT: ${found.join(", ")}` : "   OK"),
    );
  }
  console.log(`${ns}\n   ${lines.join("\n   ")}`);
}

console.log(
  flagged === 0
    ? "\nCLEAN — no retired key on any cell. RETIRED_PROFILE_KEYS can be dropped."
    : `\n${flagged} cell(s) still carry a retired key — KEEP the shim until they are synced.`,
);
