#!/usr/bin/env node
/*
 * Move the student book's pictures out of its sections and into the graph —
 * one canonical `Material` per picture under the Activity it illustrates
 * (docs/design-notes/illustrations-as-materials.md).
 *
 * Input: an export-kg envelope of the live graph, and the staging folder
 * extract-docx-pictures.mjs wrote (the pictures pulled from the experts'
 * files + manifest.json saying which section each one belongs to).
 *
 * For every `[IMAGE : slug]` marker in a student-book section:
 *   • the picture's NAME is the subject's own file name, `L06-nf-1` (two-digit
 *     lesson + slug; « notion » becomes « je-retiens », the one name the
 *     formatter allows for the notion image);
 *   • a `Material` node is created under the Activity the section covers:
 *     `identifier` = the file's gs:// URI, `content` = the prompt block that
 *     followed the marker, `name`, `materialType: Supporting`, licence and
 *     provider copied from the Activity;
 *   • the section keeps ONE line where the block was — `[IMAGE : L06-nf-1]` —
 *     so a composer matches it against the section's `pictures` by name. The
 *     prompt MOVES; it is not copied;
 *   • a picture the staging folder holds is uploaded to media/<name>.<ext>;
 *     one it does not hold (lessons the experts have not produced) gets the
 *     same URI anyway — the file lands there when the illustrator delivers,
 *     and until then a render refuses it by name, which is the honest state.
 *
 * The teacher's guide references the same pictures by the same slugs. Its
 * markers are RENAMED to the picture's full name and otherwise left alone: its
 * sections cover the lesson, so the pictures reach them through the reads.
 * Guide-only pictures (blackboard drawings: modelage, tableau-revision,
 * tableau-rappel) are not touched here.
 *
 * Dry run by default: writes <out>/graph.json + <out>/report.md, uploads
 * nothing. `--apply` uploads the staged files (skipping an object already
 * there with the same bytes). The import is a separate step, on purpose:
 *   node scripts/import-kg.mjs senegal ci maths <out>/graph.json --replace-published
 *
 * Usage:
 *   node scripts/migrate-pictures.mjs <live-export.json> <staging dir> <out dir> [--apply]
 *
 * Env for --apply: FIREBASE_STORAGE_BUCKET (+ SERVICE_ACCOUNT_KEY_PATH or ADC),
 * TLM_BUCKET_PREFIX to match the runtime.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const [exportPath, stagingDir, outDir] = args.filter((a) => !a.startsWith("--"));
if (!exportPath || !stagingDir || !outDir) {
  console.error("usage: migrate-pictures.mjs <live-export.json> <staging dir> <out dir> [--apply]");
  process.exit(1);
}
const WORKSPACE = "senegal", GRADE = "ci", SUBJECT = "maths";
const bucketName = process.env.FIREBASE_STORAGE_BUCKET ?? "";
const bucketPrefix = (process.env.TLM_BUCKET_PREFIX ?? "").replace(/\/+$/, "");
if (!bucketName) { console.error("FIREBASE_STORAGE_BUCKET is required — the picture URIs name the bucket."); process.exit(1); }
const docsPrefix = `${bucketPrefix ? bucketPrefix + "/" : ""}${WORKSPACE}/${GRADE}/${SUBJECT}/documents/`;
const objectUri = (relPath) => `gs://${bucketName}/${docsPrefix}${relPath}`;

const graph = JSON.parse(readFileSync(resolve(exportPath), "utf8"));
const manifest = JSON.parse(readFileSync(join(stagingDir, "manifest.json"), "utf8"));
const byId = new Map(graph.nodes.map((n) => [n.id, n]));
const labelsOf = (n) => n?.labels ?? [];
const titleOf = (n) => String(n?.properties?.description ?? "").split("\n")[0].trim();
const parentOf = new Map();
for (const e of graph.relationships) if (e.type === "hasPart") parentOf.set(e.end, e.start);
const rootOf = (id) => { let c = id; for (let i = 0; i < 20 && parentOf.has(c); i++) c = parentOf.get(c); return c; };
const tlmNamed = (name) => graph.nodes.find((n) => labelsOf(n).includes("TeachingLearningMaterial") && titleOf(n) === name);
const studentBook = tlmNamed("Outil de l'élève");
const teacherGuide = tlmNamed("Guide d'utilisation de l'outil de l'élève");
if (!studentBook) { console.error("no « Outil de l'élève » in the export"); process.exit(1); }

const lessonNumberOf = (id) => {
  for (let c = id, i = 0; c && i < 20; c = parentOf.get(c), i++) {
    const m = titleOf(byId.get(c)).match(/Leçon\s+(\d+)/i);
    if (m) return Number(m[1]);
  }
  return null;
};
const coveredActivity = (id) => {
  const targets = graph.relationships.filter((e) => e.type === "covers" && e.start === id).map((e) => byId.get(e.end));
  return targets.length === 1 && labelsOf(targets[0]).includes("Activity") ? targets[0] : null;
};

const MARKER = /\[IMAGE\s*:\s*([^\]]+)\]/g;
const SLUG_ALIASES = { notion: "je-retiens" };
const pictureName = (lesson, slug) => `L${String(lesson).padStart(2, "0")}-${SLUG_ALIASES[slug] ?? slug}`;
// A student-book slug — what the guide may reference and what becomes a node.
const STUDENT_SLUG = /^(amorce|notion|je-retiens|nf-\d+|tf-\d+|tf-trace|s\d(-\d+)?)$/;

/** The marker line plus its prompt block (to the next blank line), as one span. */
function markerSpan(guide, markerIndex) {
  const rest = guide.slice(markerIndex);
  const blank = rest.search(/\n\s*\n/);
  const end = blank < 0 ? guide.length : markerIndex + blank;
  return { start: markerIndex, end, text: guide.slice(markerIndex, end) };
}

// The LC boilerplate a created node copies from a sibling, so it re-parses as
// one of the graph's own (the same keys deriveTemplate copies at runtime).
const BOILERPLATE = ["license", "provider", "attributionStatement", "audience", "author", "inLanguage", "gradeLevel", "academicSubject"];

// staged pictures by the section they were matched to — first match wins, a
// second candidate for one section is reported and left unattached.
const stagedBySection = new Map();
const spareStaged = [];
for (const p of manifest.pictures) {
  if (!p.proposedSectionId) { spareStaged.push(p); continue; }
  if (stagedBySection.has(p.proposedSectionId)) { spareStaged.push({ ...p, reason: `section already has ${stagedBySection.get(p.proposedSectionId).file}` }); continue; }
  stagedBySection.set(p.proposedSectionId, p);
}

// ── Pass 1: the student book — nodes, edges, trimmed sections ────────────────

const created = [];      // { node, edge, name, relPath, staged|null, activity, section }
const skipped = [];
const perActivityCount = new Map();

for (const section of graph.nodes) {
  if (!labelsOf(section).includes("DocumentSection") || rootOf(section.id) !== studentBook.id) continue;
  let guide = String(section.properties?.metadata?.assemblyGuide ?? "");
  const matches = [...guide.matchAll(MARKER)];
  if (matches.length === 0) continue;

  const activity = coveredActivity(section.id);
  const lesson = lessonNumberOf(section.id);
  // Rewrite from the end so earlier indexes stay valid.
  for (const match of matches.reverse()) {
    const rawSlug = match[1].trim();
    if (/RETIR/i.test(rawSlug)) { skipped.push({ section: titleOf(section), slug: rawSlug, why: "withdrawn" }); continue; }
    if (!activity || lesson === null || !STUDENT_SLUG.test(rawSlug)) { skipped.push({ section: titleOf(section), slug: rawSlug, why: !activity ? "covers no single Activity" : lesson === null ? "no lesson number" : "not a student-book slug" }); continue; }

    const name = pictureName(lesson, rawSlug);
    const span = markerSpan(guide, match.index);
    const prompt = span.text.slice(match[0].length).trim();
    const staged = stagedBySection.get(section.id) ?? null;
    const ext = staged ? staged.file.split(".").pop() : "png";
    const relPath = `media/${name}.${ext}`;

    const position = (perActivityCount.get(activity.id) ?? 0) + 1;
    perActivityCount.set(activity.id, position);
    const boilerplate = Object.fromEntries(BOILERPLATE.filter((k) => activity.properties?.[k] !== undefined).map((k) => [k, activity.properties[k]]));
    const node = {
      id: randomUUID(),
      labels: ["Material"],
      properties: {
        ...boilerplate,
        identifier: objectUri(relPath),
        name,
        description: name,
        content: prompt,
        materialType: "Supporting",
        position,
      },
    };
    const edge = { id: `hasPart:${activity.id}->${node.id}`, type: "hasPart", start: activity.id, end: node.id, properties: {} };
    created.push({ node, edge, name, relPath, staged, activity: titleOf(activity), section: titleOf(section), lesson, promptChars: prompt.length });

    guide = guide.slice(0, span.start) + `[IMAGE : ${name}]` + guide.slice(span.end);
  }
  section.properties.metadata.assemblyGuide = guide;
}
graph.nodes.push(...created.map((c) => c.node));
graph.relationships.push(...created.map((c) => c.edge));

// ── Pass 2: the teacher's guide — rename its references to the same pictures ──

const createdNames = new Set(created.map((c) => c.name));
let guideRenamed = 0, guideUnresolved = [];
if (teacherGuide) {
  for (const section of graph.nodes) {
    if (!labelsOf(section).includes("DocumentSection") || rootOf(section.id) !== teacherGuide.id) continue;
    const guide = String(section.properties?.metadata?.assemblyGuide ?? "");
    if (!MARKER.test(guide)) continue;
    const lesson = lessonNumberOf(section.id);
    const rewritten = guide.replace(MARKER, (whole, rawSlug) => {
      const slug = rawSlug.trim();
      if (!STUDENT_SLUG.test(slug) || lesson === null) return whole;
      const name = pictureName(lesson, slug);
      if (!createdNames.has(name)) { guideUnresolved.push({ section: titleOf(section), slug, name }); return whole; }
      guideRenamed++;
      return `[IMAGE : ${name}]`;
    });
    section.properties.metadata.assemblyGuide = rewritten;
  }
}

// ── Upload (only with --apply) ───────────────────────────────────────────────

const toUpload = created.filter((c) => c.staged);
let uploaded = 0, alreadyThere = 0;
if (apply) {
  const require = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), "../package.json"));
  const fbApp = require("firebase-admin/app");
  const fbStorage = require("firebase-admin/storage");
  const keyPath = process.env.SERVICE_ACCOUNT_KEY_PATH;
  if (fbApp.getApps().length === 0) {
    fbApp.initializeApp({ credential: keyPath ? fbApp.cert(keyPath) : fbApp.applicationDefault(), storageBucket: bucketName });
  }
  const bucket = fbStorage.getStorage().bucket();
  for (const c of toUpload) {
    const bytes = readFileSync(join(stagingDir, c.staged.file));
    const file = bucket.file(docsPrefix + c.relPath);
    const [exists] = await file.exists();
    if (exists) {
      const [meta] = await file.getMetadata();
      const localMd5 = createHash("md5").update(bytes).digest("base64");
      if (meta.md5Hash === localMd5) { alreadyThere++; continue; }
    }
    await file.save(bytes, { contentType: c.relPath.endsWith(".jpg") ? "image/jpeg" : "image/png", resumable: false });
    uploaded++;
    if ((uploaded + alreadyThere) % 25 === 0) console.log(`  uploaded ${uploaded} (+${alreadyThere} already there) of ${toUpload.length}`);
  }
}

// ── Outputs ──────────────────────────────────────────────────────────────────

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "graph.json"), JSON.stringify(graph));

const withFile = created.filter((c) => c.staged).length;
const summary = {
  mode: apply ? "apply" : "dry-run",
  picturesCreated: created.length,
  withFile,
  planned: created.length - withFile,
  lessons: new Set(created.map((c) => c.lesson)).size,
  studentSectionsSkipped: skipped.length,
  guideMarkersRenamed: guideRenamed,
  guideMarkersUnresolved: guideUnresolved.length,
  stagedNotAttached: spareStaged.length,
  uploaded, alreadyThere,
  graph: { nodes: graph.nodes.length, edges: graph.relationships.length },
};
let report = `# Picture migration — ${summary.mode}\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n`;
report += `\n## Skipped student-book markers\n\n${skipped.map((s) => `- ${s.section} · ${s.slug} — ${s.why}`).join("\n") || "(none)"}\n`;
report += `\n## Guide markers naming a picture that was not created\n\n${guideUnresolved.map((u) => `- ${u.section} · ${u.slug} → ${u.name}`).join("\n") || "(none)"}\n`;
report += `\n## Staged pictures left unattached\n\n${spareStaged.map((p) => `- ${p.file}${p.reason ? " — " + p.reason : " — no section proposed"}`).join("\n") || "(none)"}\n`;
report += `\n## Created pictures\n\n| name | lesson | activity | file | prompt chars |\n|---|---|---|---|---|\n`;
for (const c of created.sort((a, b) => a.lesson - b.lesson || a.name.localeCompare(b.name))) {
  report += `| ${c.name} | ${c.lesson} | ${c.activity.replace(/\|/g, "/").slice(0, 60)} | ${c.staged ? c.staged.file : "planned"} | ${c.promptChars} |\n`;
}
writeFileSync(join(outDir, "report.md"), report);
console.log(JSON.stringify(summary, null, 2));
console.log(`\nwrote ${join(outDir, "graph.json")} and report.md`);
