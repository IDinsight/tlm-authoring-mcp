#!/usr/bin/env node
/*
 * Apply a batch of node field-edits from a JSON file to a namespace's DRAFT, via
 * the same two-phase `editNode` mutation the `edit_nodes` tool folds per item (so
 * every edit is validated + audited through runGraphMutation). The offline twin of
 * that tool: same engine, but the edits live in a reviewable data file rather than
 * in a tool call, and each one is applied (and skipped) individually.
 *
 * It STAGES a draft (lazily created) and does NOT publish — review with diff_draft
 * and publish with publish_draft afterwards. Idempotent: an edit whose target value
 * already matches (in the draft-else-published slot) is skipped, so a re-run — or a
 * run after some edits were already applied by hand — is safe.
 *
 * Usage (after `npm run build`):
 *   node scripts/apply-edits.mjs <workspace> <grade> <subject> <edits.json> [--batch N]
 *
 * ONE EDIT PER MUTATION IS THE DEFAULT, and it is slow in a way worth knowing
 * before starting a large run: every mutation reads the whole graph and diffs it
 * TWICE — once to preview, once to confirm. Measured on live ci/maths (2,044
 * nodes), that is ~63 seconds per node, so a 260-section marking pass is four
 * hours and a bulk pass is not viable at all.
 *
 * `--batch N` sends N edits as ONE mutation through the same two-phase, audited
 * path: one read, one diff, one write, ONE audit record for the batch. The
 * trade is granularity — a batch is all-or-nothing and the trail records it as
 * one event, so an edit that fails takes its batch with it. Use it for a
 * mechanical pass over many nodes; leave it off when each edit is its own
 * decision and you want each recorded separately.
 *
 * edits.json: [{ "id": "<nodeId>", "field": "content"|"summary"|"title"|"title_en"|"assemblyGuide", "value": "<text>" }, …]
 *
 * Env (same as import-kg): SERVICE_ACCOUNT_KEY_PATH (or _JSON), FIREBASE_STORAGE_BUCKET,
 * TLM_BUCKET_PREFIX. Actor: set TLM_ACTOR_EMAIL for the audit trail (else a script actor).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(resolve(REPO, "dist"))) {
  console.error("apply-edits: dist/ not found — run `npm run build` first.");
  process.exit(1);
}

const { runGraphMutation, createFirestoreKgStore, kgNamespace, __setKgStoreForTest } =
  await import(new URL("../dist/kg-store/index.js", import.meta.url));
const { editNode, editNodes } = await import(new URL("../dist/kg-recipes/index.js", import.meta.url));
const actorMod = await import(new URL("../dist/actor.js", import.meta.url));

const argv = process.argv.slice(2);
const batchIndex = argv.indexOf("--batch");
const batchSize = batchIndex >= 0 ? Number(argv[batchIndex + 1]) : 0;
if (batchIndex >= 0 && (!Number.isInteger(batchSize) || batchSize < 1)) {
  console.error("apply-edits: --batch needs a positive whole number.");
  process.exit(1);
}
// Drop the --batch flag and its value ONLY when the flag is present: with no
// flag indexOf gives -1, and -1 + 1 is 0, which silently ate the first argument.
const args = batchIndex >= 0 ? argv.filter((a, i) => i !== batchIndex && i !== batchIndex + 1) : argv;
if (args.length !== 4) {
  console.error("apply-edits: expected `<workspace> <grade> <subject> <edits.json> [--batch N]`.");
  process.exit(1);
}
const [workspace, grade, subject, editsPath] = args;
const edits = JSON.parse(readFileSync(resolve(editsPath), "utf8"));
const namespace = kgNamespace(workspace, grade, subject);

// A named actor for the audit trail (the mutation records who edited).
if (actorMod.__setActorForTest) {
  actorMod.__setActorForTest({ id: "apply-edits-script", email: process.env.TLM_ACTOR_EMAIL ?? "apply-edits@script", role: "curator", unknown: false });
}

const store = createFirestoreKgStore();
if (__setKgStoreForTest) __setKgStoreForTest(store);

// Read the current value of a field on a node in the draft-else-published slot, to
// skip edits already applied. content → raw.content; summary → raw.metadata.summary;
// title → raw.description; title_en → raw.metadata.en.description;
// assemblyGuide → raw.metadata.assemblyGuide.
function currentValue(node, field) {
  const raw = node?.properties?.raw ?? {};
  if (field === "content") return raw.content;
  if (field === "summary") return (raw.metadata ?? {}).summary;
  if (field === "title") return raw.description;
  if (field === "title_en") return ((raw.metadata ?? {}).en ?? {}).description;
  if (field === "assemblyGuide") return (raw.metadata ?? {}).assemblyGuide;
  return undefined;
}

/*
 * The mutation arguments for one edit.
 *
 * Most fields are a named argument on `editNode`. `assemblyGuide` is not — it is
 * an ordinary LC property, reached through the freeform bag by its dotted path,
 * which is the same door `edit_nodes` opens for it. Sending it as a named
 * argument would be silently ignored.
 */
function argsFor(namespace, id, field, value) {
  if (field === "assemblyGuide") {
    return { namespace, nodeId: id, properties: { "metadata.assemblyGuide": value } };
  }
  return { namespace, nodeId: id, [field]: value };
}

const pointer = await store.readPointer(namespace);
if (!pointer) { console.error(`apply-edits: namespace '${namespace}' has no pointer.`); process.exit(1); }
const readSlot = pointer.draftSlot ?? pointer.publishedSlot;
const nodes = await store.listNodes(namespace, readSlot);
const byId = new Map(nodes.map((n) => [n.id, n]));

let applied = 0, skipped = 0, failed = 0;

// Edits still worth making — anything already at its target value is dropped
// here, so a re-run after an interrupted pass does only what is left.
const pending = [];
for (const e of edits) {
  const id = e.id ?? e.nodeId;
  const node = byId.get(id);
  if (!node) { console.error(`  ! ${id} [${e.field}] — node not found in ${readSlot}`); failed++; continue; }
  if (currentValue(node, e.field) === e.value) { console.error(`  = ${id} [${e.field}] — already up to date, skipped`); skipped++; continue; }
  pending.push({ id, field: e.field, value: e.value });
}
console.error(`apply-edits: ${pending.length} to apply, ${skipped} already up to date.`);

/** Run one two-phase mutation and say whether it landed. */
async function run(mutation, mutArgs, label) {
  const preview = await runGraphMutation({ namespace, mutation, args: mutArgs });
  if (preview.phase !== "preview") {
    console.error(`  ! ${label} — ${preview.phase}: ${JSON.stringify(preview.errors ?? preview.message ?? "")}`);
    return false;
  }
  const confirm = await runGraphMutation({ namespace, mutation, args: mutArgs, confirm: true, token: preview.confirmationToken });
  if (confirm.phase !== "apply") { console.error(`  ! ${label} — confirm ${confirm.phase}`); return false; }
  return true;
}

if (batchSize > 0) {
  for (let start = 0; start < pending.length; start += batchSize) {
    const chunk = pending.slice(start, start + batchSize);
    const items = chunk.map((e) => {
      const { namespace: _ignored, nodeId, ...fields } = argsFor(namespace, e.id, e.field, e.value);
      return { nodeId, ...fields };
    });
    const label = `batch ${start + 1}-${start + chunk.length} of ${pending.length}`;
    const ok = await run(editNodes, { namespace, items }, label);
    if (ok) { console.error(`  ✓ ${label}`); applied += chunk.length; } else { failed += chunk.length; }
  }
} else {
  for (const e of pending) {
    const ok = await run(editNode, argsFor(namespace, e.id, e.field, e.value), `${e.id} [${e.field}]`);
    if (ok) { console.error(`  ✓ ${e.id} [${e.field}]`); applied++; } else { failed++; }
  }
}

console.error(`apply-edits: done — ${applied} applied, ${skipped} skipped, ${failed} failed. Draft on '${namespace}'; review with diff_draft, publish with publish_draft.`);
if (failed) process.exit(2);
