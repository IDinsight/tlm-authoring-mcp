#!/usr/bin/env node
/*
 * Pull the committed test fixtures back into line with the live store.
 *
 * The fixtures under test/fixtures/ are what ~27 suites assert against, and they
 * are a snapshot of graphs that keep being edited. Nothing used to refresh them
 * and nothing used to notice: ci/maths sat at 0 `DocumentSection`s here while
 * production grew ~1,100, so every section-based generation suite was green
 * against a curriculum shape the server never sees.
 *
 * Two modes, because there are two different questions:
 *
 *   --check   Has the live graph moved away from what we pinned? Reads live,
 *             writes NOTHING, exits 1 on drift. This is the one to run on a
 *             schedule or in a credentialed CI job — it answers "are our tests
 *             still honest?" without touching the working tree.
 *
 *   (default) Refresh: overwrite each fixture from the live PUBLISHED slot and
 *             re-pin test/fixtures/SHAPE.json. Deliberately leaves the result in
 *             the working tree UNCOMMITTED — the point is that a human reads the
 *             diff. `npm test` will fail until SHAPE.json is re-pinned, which is
 *             this script's other job, so the sequence is: refresh, read the
 *             printed drift, run the suites, then commit if the change is real.
 *
 * Usage (after `npm run build`):
 *   node scripts/refresh-fixtures.mjs [--check] [<workspace> <grade> <subject>]
 *
 * Naming a context limits it to that one; omit to do every fixture context.
 *
 * Env: SERVICE_ACCOUNT_KEY_PATH (or SERVICE_ACCOUNT_KEY_JSON), FIREBASE_STORAGE_BUCKET,
 * TLM_BUCKET_PREFIX (match the runtime prefix so the namespace lines up).
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = resolve(REPO, "test", "fixtures");
const MANIFEST = resolve(FIXTURES, "SHAPE.json");

if (!existsSync(resolve(REPO, "dist"))) {
  console.error("refresh-fixtures: dist/ not found — run `npm run build` first.");
  process.exit(1);
}

// The shape helpers come from the compiled test-support module rather than being
// restated here, so the offline test and this script can never disagree about
// what "drifted" means — the drift they'd disagree about is exactly the kind
// this whole mechanism exists to catch.
const { fixtureShape, shapeDeltas, formatDeltas } = await import(new URL("../dist/__tests__/fixture-shape.js", import.meta.url));
const { toRawEnvelope } = await import(new URL("../dist/curriculum/index.js", import.meta.url));
const { kgNamespace, createFirestoreKgStore } = await import(new URL("../dist/kg-store/index.js", import.meta.url));

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const [workspace, grade, subject] = args.filter((a) => !a.startsWith("--"));
if (workspace && !(grade && subject)) {
  console.error("refresh-fixtures: name a full context — `<workspace> <grade> <subject>` — or none at all.");
  process.exit(1);
}

const manifest = existsSync(MANIFEST)
  ? JSON.parse(readFileSync(MANIFEST, "utf8"))
  : { note: "", refreshedAt: null, contexts: {} };

// Which contexts to refresh: the one named, else every context already pinned in
// the manifest. Driving off the manifest rather than a directory scan means a
// half-written fixture folder can't quietly add itself to the refresh set.
const targets = workspace
  ? [`${workspace}/${grade}/${subject}`]
  : Object.keys(manifest.contexts).sort();

if (targets.length === 0) {
  console.error("refresh-fixtures: no contexts pinned in SHAPE.json and none named on the command line.");
  process.exit(1);
}

const store = createFirestoreKgStore();
let drifted = 0;
let failed = 0;

for (const key of targets) {
  const [ws, gr, sub] = key.split("/");
  const namespace = kgNamespace(ws, gr, sub);
  const pointer = await store.readPointer(namespace);
  if (!pointer) {
    console.error(`✗ ${key}: no graph in the store for namespace '${namespace}'.`);
    failed += 1;
    continue;
  }

  const [nodes, edges] = await Promise.all([
    store.listNodes(namespace, pointer.publishedSlot),
    store.listEdges(namespace, pointer.publishedSlot),
  ]);
  const envelope = toRawEnvelope({ nodes, edges });
  const live = fixtureShape(envelope);
  const pinned = manifest.contexts[key];
  const deltas = pinned ? shapeDeltas(pinned, live) : null;

  if (deltas && deltas.length === 0) {
    console.error(`✓ ${key}: unchanged (${live.nodes} nodes / ${live.edges} edges).`);
  } else {
    drifted += 1;
    console.error(deltas ? `● ${key}: drifted from the pinned shape —` : `● ${key}: not pinned yet — live shape is`);
    console.error(deltas ? formatDeltas(deltas) : `  ${live.nodes} nodes / ${live.edges} edges`);
  }

  if (checkOnly) continue;

  const dir = resolve(FIXTURES, ws, gr, sub);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "knowledge_graph.json"), JSON.stringify(envelope, null, 2));
  manifest.contexts[key] = live;
}

if (failed > 0) process.exit(2);

if (checkOnly) {
  console.error(
    drifted === 0
      ? "\nrefresh-fixtures: the fixtures still match live. Nothing to do."
      : `\nrefresh-fixtures: ${drifted} context(s) drifted. Run without --check to refresh, then review the diff.`,
  );
  process.exit(drifted === 0 ? 0 : 1);
}

manifest.note =
  "The pinned shape of each committed fixture graph. Asserted by src/__tests__/fixture-shape.test.ts " +
  "so a refresh cannot silently change what the suites stand on. Regenerate with `npm run refresh:fixtures`.";
manifest.refreshedAt = new Date().toISOString();
manifest.contexts = Object.fromEntries(Object.entries(manifest.contexts).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

console.error(
  `\nrefresh-fixtures: wrote ${targets.length} fixture(s) and re-pinned SHAPE.json.\n` +
    "Review the diff (`git diff --stat test/fixtures`) and run `npm test` before committing.",
);
