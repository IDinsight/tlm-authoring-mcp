#!/usr/bin/env node
/*
 * Write a subject-profile config cell ({ core, guide }) directly into a store
 * slot — the REPAIR path for a config cell that is too invalid to activate.
 *
 * Why this exists: when the published config cell is malformed for the running
 * code (e.g. it still carries a key the current schema retired), the server
 * refuses to activate that namespace. That blocks `edit_profile` (which needs an
 * activated context), and `import-kg` can't help either — it only writes slot
 * "a" and never repoints, so it can't fix a bad cell living in the *published*
 * slot. This script closes that gap. See the rollout skill's "Recovery"
 * section and docs/technical-reference/store.md.
 *
 * By default it targets the namespace's CURRENTLY PUBLISHED slot, so the fix is
 * live immediately with no pointer flip. The config is validated with the SAME
 * check the server runs on activation (buildAdapterFromStoredProfile), so it
 * refuses to write a cell that would not activate.
 *
 * This writes the cell directly — no draft, no audit record — deliberately
 * outside the two-phase curator loop that the broken cell blocks. Use it only to
 * repair; ordinary profile/guide edits go through edit_profile.
 *
 * Usage (after `npm run build`):
 *   node scripts/write-profile.mjs <workspace> <grade> <subject> [--profile p.json] [--slot a|b|published] [--dry-run]
 *
 * Config source: --profile <path> ({ core, guide } JSON) wins outright.
 * Otherwise `core` comes from the in-repo literal and the GUIDE IS TAKEN FROM
 * THE LIVE CELL — the repo's assets/<ws>/<grade>/<subject>/GRAPH_GUIDE.md is used only when the cell
 * has no guide to preserve (a first seed). Repairing `core` must not revert
 * authored prose; see the note at the write site.
 *
 * Env (same as import-kg): SERVICE_ACCOUNT_KEY_PATH (or SERVICE_ACCOUNT_KEY_JSON),
 * FIREBASE_STORAGE_BUCKET, TLM_BUCKET_PREFIX (match the runtime prefix so the
 * namespace lines up). --dry-run reads the real store but writes nothing.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(resolve(REPO, "dist"))) {
  console.error("write-profile: dist/ not found — run `npm run build` first.");
  process.exit(1);
}

const { getRegisteredProfile, getRegisteredGuide, buildAdapterFromStoredProfile } =
  await import(new URL("../dist/adapters/index.js", import.meta.url));
const { kgNamespace, createFirestoreKgStore } =
  await import(new URL("../dist/kg-store/index.js", import.meta.url));

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const profileIdx = args.indexOf("--profile");
const profilePath = profileIdx >= 0 ? args[profileIdx + 1] : null;
const slotIdx = args.indexOf("--slot");
const slotArg = slotIdx >= 0 ? args[slotIdx + 1] : "published";
// Drop the value that follows a flag — but only when the flag is actually
// present (indexOf returns -1 when absent, and -1 + 1 = 0 would wrongly drop the
// first positional).
const flagValueIdx = new Set();
if (profileIdx >= 0) flagValueIdx.add(profileIdx + 1);
if (slotIdx >= 0) flagValueIdx.add(slotIdx + 1);
const positional = args.filter((a, i) => !a.startsWith("--") && !flagValueIdx.has(i));

if (positional.length !== 3) {
  console.error("write-profile: expected `<workspace> <grade> <subject>` (plus optional --profile <path> / --slot a|b|published / --dry-run).");
  process.exit(1);
}
const [workspace, grade, subject] = positional;

const namespace = kgNamespace(workspace, grade, subject);
const store = createFirestoreKgStore();

try {
  const pointer = await store.readPointer(namespace);
  if (!pointer) {
    console.error(`write-profile: namespace '${namespace}' has no pointer — nothing to repair. Use import-kg to create it.`);
    process.exit(1);
  }
  const slot = slotArg === "published" ? pointer.publishedSlot : slotArg;
  if (slot !== "a" && slot !== "b") {
    console.error(`write-profile: bad --slot '${slotArg}' (expected a | b | published).`);
    process.exit(1);
  }

  /*
   * The config cell is written WHOLE — { core, guide } replaces, it does not
   * patch — so the half you are not trying to change has to be carried across
   * deliberately. The guide is authored prose (~24 KB of coverage expectations
   * and authoring conventions) that experts edit LIVE through edit_profile, and
   * the in-repo assets/<ws>/<grade>/<subject>/GRAPH_GUIDE.md copy is only the seed a namespace was
   * seeded from. Rebuilding the guide from the repo on every write meant a
   * one-word `core` repair silently reverted months of authored prose, with no
   * draft, no audit record and no undo.
   *
   * So: KEEP THE LIVE GUIDE unless the caller explicitly supplies one.
   *
   *   --profile <file>   wins outright — you asked for that record by name
   *   live cell has one  keep it verbatim, refresh `core` from the repo
   *   no cell yet        fall back to the repo guide (a first seed has nothing
   *                      to preserve, which is the case this path was born for)
   */
  const live = await store.readConfig(namespace, slot);
  let config;
  let guideSource;
  if (profilePath) {
    config = JSON.parse(readFileSync(resolve(profilePath), "utf8"));
    guideSource = `--profile ${profilePath}`;
  } else {
    const core = getRegisteredProfile(workspace, grade, subject);
    if (!core) {
      console.error(`write-profile: no in-repo profile for '${workspace}/${grade}/${subject}'. Pass --profile <path>.`);
      process.exit(1);
    }
    const liveGuide = live && typeof live.guide === "string" ? live.guide : undefined;
    const guide = liveGuide ?? getRegisteredGuide(workspace, grade, subject);
    guideSource = liveGuide !== undefined ? "the LIVE cell (preserved)" : "the repo assets (no live guide to preserve)";
    config = guide !== undefined ? { core, guide } : { core };
  }

  // Validate exactly as the server does on activation, so we never write a cell
  // that would refuse to activate.
  try {
    buildAdapterFromStoredProfile(workspace, grade, subject, config);
  } catch (e) {
    console.error(`write-profile: REFUSED — config would not activate: ${(e && e.message) || e}`);
    process.exit(2);
  }

  const guideLen = config.guide ? config.guide.length : 0;
  const liveLen = live && typeof live.guide === "string" ? live.guide.length : 0;
  console.error(`write-profile: ns='${namespace}', publishedSlot='${pointer.publishedSlot}', target slot='${slot}'.`);
  console.error(`write-profile: guide=${guideLen} chars from ${guideSource} (live cell holds ${liveLen})${dryRun ? " — dry-run, no write" : ""}.`);
  // Say it plainly when the caller's own file would shorten the live guide: that
  // is the one remaining way to lose authored prose here, and it is deliberate.
  if (profilePath && liveLen > guideLen) {
    console.error(`write-profile: WARNING — this REPLACES a ${liveLen}-char live guide with a ${guideLen}-char one.`);
  }
  if (!dryRun) {
    await store.writeConfig(namespace, slot, config);
    console.error("write-profile: done — config cell written.");
  }
} catch (e) {
  console.error(`write-profile: FAILED — ${(e && e.message) || e}`);
  process.exit(2);
}
