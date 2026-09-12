#!/usr/bin/env node
/*
 * Second pass over the ci/maths pictures — three repairs the first pass left.
 *
 * 1. STUDENT BOOK: a prompt was moved up to the first blank line, and for some
 *    pictures the description carried on past it (« Bandeau du haut … », then
 *    « Bandeau du bas … »), so the node's `content` stops mid-sentence and the
 *    rest still sits in the section. The paragraphs after the marker that read
 *    as description — a bullet, a letter label, an ordinary sentence — move
 *    into the node; the authoring notes that follow (ORIGINE, •• …, ⚠ …)
 *    stay where they are.
 *
 * 2. TEACHER'S GUIDE: it re-describes the same pictures inline, on the line
 *    that also carries the printed directive and the answer. Two copies drift,
 *    so the description goes and the marker stays: « ★ [IMAGE : L04-nf-1] [N] … ».
 *    Where the guide still said more than the node (after 1), that text is
 *    appended to the node rather than lost.
 *
 * 3. BLACKBOARD PICTURES (modelage, tableau-revision, tableau-rappel): the
 *    guide's own drawings, which the first pass skipped. One `Material` each
 *    under the LESSON (a teacher's drawing is the lesson's, not an activity's),
 *    its file from the images-tableau folder when produced, commissioned
 *    otherwise; and a `covers` edge from a PHASE section covering nothing to
 *    its lesson, so the picture reaches it.
 *
 * Dry run by default (graph.json + report.md, no upload). `--apply` uploads
 * the blackboard files. Import is the separate step, as before.
 *
 * Usage:
 *   node scripts/migrate-pictures-2.mjs <live-export.json> <images-tableau dir> <out dir> [--apply]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const [exportPath, imagesDir, outDir] = args.filter((a) => !a.startsWith("--"));
if (!exportPath || !imagesDir || !outDir) {
  console.error("usage: migrate-pictures-2.mjs <live-export.json> <images-tableau dir> <out dir> [--apply]");
  process.exit(1);
}
const WORKSPACE = "senegal", GRADE = "ci", SUBJECT = "maths";
const bucketName = process.env.FIREBASE_STORAGE_BUCKET ?? "";
const bucketPrefix = (process.env.TLM_BUCKET_PREFIX ?? "").replace(/\/+$/, "");
if (!bucketName) { console.error("FIREBASE_STORAGE_BUCKET is required — the picture URIs name the bucket."); process.exit(1); }
const docsPrefix = `${bucketPrefix ? bucketPrefix + "/" : ""}${WORKSPACE}/${GRADE}/${SUBJECT}/documents/`;
const objectUri = (relPath) => `gs://${bucketName}/${docsPrefix}${relPath}`;

const graph = JSON.parse(readFileSync(resolve(exportPath), "utf8"));
const byId = new Map(graph.nodes.map((n) => [n.id, n]));
const labelsOf = (n) => n?.labels ?? [];
const titleOf = (n) => String(n?.properties?.description ?? "").split("\n")[0].trim();
const guideOf = (n) => String(n?.properties?.metadata?.assemblyGuide ?? "");
const parentOf = new Map();
for (const e of graph.relationships) if (e.type === "hasPart") parentOf.set(e.end, e.start);
const rootOf = (id) => { let c = id; for (let i = 0; i < 20 && parentOf.has(c); i++) c = parentOf.get(c); return c; };
const tlmNamed = (name) => graph.nodes.find((n) => labelsOf(n).includes("TeachingLearningMaterial") && titleOf(n) === name);
const studentBook = tlmNamed("Outil de l'élève");
const teacherGuide = tlmNamed("Guide d'utilisation de l'outil de l'élève");
const sectionsOf = (tlm) => graph.nodes.filter((n) => labelsOf(n).includes("DocumentSection") && rootOf(n.id) === tlm.id);
const coversOf = (id) => graph.relationships.filter((e) => e.type === "covers" && e.start === id).map((e) => e.end);
const lessonNumberOf = (id) => {
  for (let c = id, i = 0; c && i < 20; c = parentOf.get(c), i++) {
    const m = titleOf(byId.get(c)).match(/Leçon\s+(\d+)/i);
    if (m) return Number(m[1]);
  }
  return null;
};

const pictures = new Map(graph.nodes.filter((n) => labelsOf(n).includes("Material") && /^L\d\d-/.test(n.properties?.name ?? "")).map((n) => [n.properties.name, n]));
const MARKER = /\[IMAGE\s*:\s*([^\]]+)\]/g;
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const overlap = (text, against) => {
  const words = norm(text).split(" ").filter((w) => w.length > 4);
  return words.length === 0 ? 1 : words.filter((w) => against.includes(w)).length / words.length;
};
const appendContent = (node, text) => { node.properties.content = `${(node.properties.content ?? "").trimEnd()}\n\n${text.trim()}`; };

// ── 1. Student book: the description paragraphs left behind ──────────────────

/*
 * A paragraph that continues the picture's brief rather than opening a note.
 *
 * A bullet, a letter label « (b) », or an ordinary sentence continues it. A
 * paragraph opening in capitals is a heading, and only some headings belong to
 * the brief — the ones the experts' own dossier format puts inside an image
 * block: the point not to miss, what the drawing must convey, a band reused.
 * Every other heading (ORIGINE, CE QUI CHANGE, LE CORRIGÉ, VERSION FINALE,
 * •• …, ⚠ …) is provenance or an answer key and stays in the section.
 * Decided with the curriculum lead on 2026-09-12.
 */
const BRIEF_HEADINGS = /^(LE POINT À NE PAS RATER|CE QUE LE SCHÉMA DOIT FAIRE COMPRENDRE|LA MÊME BANDE|LA COULEUR)/;
// Notes the capital-letter test misses: a generation pass (its digit breaks
// the run of capitals) and a bulleted « why ».
const NOTE_HEADINGS = /^(PASS\s*\d|• POURQUOI|ORIGINE|ERREUR)/;
const continuesDescription = (paragraph) => {
  const head = paragraph.trimStart();
  if (/^(••|⚠|\[)/.test(head) || NOTE_HEADINGS.test(head)) return false;
  if (/^[•\-–(]/.test(head)) return true;
  if (BRIEF_HEADINGS.test(head)) return true;
  // Opens in capitals: the first six letters (apostrophes and spaces aside)
  // all upper-case — « LE CORRIGÉ », « CE QUI CHANGE ».
  const letters = head.replace(/[^\p{L}]/gu, "").slice(0, 6);
  return !(letters.length === 6 && letters === letters.toUpperCase());
};

const repaired = [];
for (const section of sectionsOf(studentBook)) {
  let guide = guideOf(section);
  const matches = [...guide.matchAll(/\[IMAGE\s*:\s*(L\d\d-[^\]]+)\]/g)];
  if (matches.length === 0) continue;
  for (const match of matches.reverse()) {
    const picture = pictures.get(match[1].trim());
    if (!picture) continue;
    const afterMarker = match.index + match[0].length;
    const rest = guide.slice(afterMarker);
    // Paragraphs after the marker line, with their spans, until one is a note.
    const taken = [];
    let cursor = 0;
    const body = rest.replace(/^[ \t]*\n/, (m) => { cursor += m.length; return ""; });
    let pos = 0;
    for (const paragraph of body.split(/\n\s*\n/)) {
      const start = pos; pos += paragraph.length;
      const gapAfter = body.slice(pos).match(/^\n\s*\n/)?.[0]?.length ?? 0;
      pos += gapAfter;
      if (!paragraph.trim() || !continuesDescription(paragraph)) break;
      taken.push({ text: paragraph.trim(), end: pos });
    }
    if (taken.length === 0) continue;
    appendContent(picture, taken.map((t) => t.text).join("\n\n"));
    guide = guide.slice(0, afterMarker) + "\n\n" + body.slice(taken[taken.length - 1].end);
    repaired.push({ name: picture.properties.name, section: titleOf(section), paragraphs: taken.length, chars: taken.reduce((n, t) => n + t.text.length, 0) });
  }
  section.properties.metadata.assemblyGuide = guide.replace(/\n{3,}/g, "\n\n");
}

// ── 2. Teacher's guide: strip the inline re-descriptions ─────────────────────

// Where an inline description ends: the next printed-line tag, the answer, a
// blank line, or the next item's symbol — on this line or a following one. In
// the guide's grammar only tagged lines print, and a description may run over
// two or three lines before the first tag (54 of 506 do).
const DESCRIPTION_END = /\[(N|FR!?|WO)\]|\{pt:|RÉPONSE\s*:|\n(?=\s*(\n|$|\[(N|FR!?|WO)\]|\{pt:|[★▲■●◆]|RÉPONSE))/;
const stripped = [];
const keptInNode = [];
const guideOnly = [];   // markers naming no student picture — pass 3
for (const section of sectionsOf(teacherGuide)) {
  let guide = guideOf(section);
  const matches = [...guide.matchAll(MARKER)];
  if (matches.length === 0) continue;
  for (const match of matches.reverse()) {
    const name = match[1].trim();
    const afterMarker = match.index + match[0].length;
    const rest = guide.slice(afterMarker);
    const end = rest.search(DESCRIPTION_END);
    const description = (end < 0 ? rest : rest.slice(0, end)).trim();
    const picture = pictures.get(name);
    if (!picture) { guideOnly.push({ section, name, description, start: match.index, end: afterMarker + (end < 0 ? rest.length : end) }); continue; }
    if (description.length > 0) {
      const share = overlap(description, norm(picture.properties.content ?? ""));
      if (share < 0.5 && description.length > 40) {
        appendContent(picture, description);
        keptInNode.push({ name, section: titleOf(section), share: +share.toFixed(2), chars: description.length });
      }
      // Keep the marker; the tail starts at the tag/newline that ended the
      // description, so a tag on the same line stays on it (one space) and a
      // tag on the next line keeps its line break.
      const tail = end < 0 ? "" : rest.slice(end);
      guide = guide.slice(0, afterMarker) + (tail.startsWith("\n") ? "" : " ") + tail;
      stripped.push({ name, section: titleOf(section), chars: description.length });
    }
  }
  section.properties.metadata.assemblyGuide = guide;
}

// ── 3. Blackboard pictures under their lesson ────────────────────────────────

// lesson number → Lesson node, read off the student book's lesson sections.
const lessonByNumber = new Map();
for (const section of sectionsOf(studentBook)) {
  const m = titleOf(section).match(/^V2 — Leçon\s+(\d+)/);
  if (!m) continue;
  const lesson = coversOf(section.id).map((id) => byId.get(id)).find((n) => labelsOf(n).includes("Lesson"));
  if (lesson) lessonByNumber.set(Number(m[1]), lesson);
}
const BOILERPLATE = ["license", "provider", "attributionStatement", "audience", "author", "inLanguage", "gradeLevel", "academicSubject"];
const localFiles = new Set(existsSync(imagesDir) ? readdirSync(imagesDir) : []);
const created = [];
const coversAdded = [];
const perLessonCount = new Map();
// Process per section, from the last marker back, so spans stay valid.
const bySection = new Map();
for (const item of guideOnly) (bySection.get(item.section.id) ?? bySection.set(item.section.id, []).get(item.section.id)).push(item);
for (const [, items] of bySection) {
  const section = items[0].section;
  let guide = guideOf(section);
  const lessonNumber = lessonNumberOf(section.id);
  const lesson = lessonNumber === null ? null : lessonByNumber.get(lessonNumber);
  for (const item of items.sort((a, b) => b.start - a.start)) {
    const slug = item.name;
    if (!lesson || !/^[a-z0-9-]+$/.test(slug)) { created.push({ name: slug, section: titleOf(section), skipped: !lesson ? "no lesson" : "not a slug" }); continue; }
    const name = `L${String(lessonNumber).padStart(2, "0")}-${slug}`;
    const fileName = `${name}.png`;
    const hasFile = localFiles.has(fileName);
    const position = (perLessonCount.get(lesson.id) ?? 0) + 1;
    perLessonCount.set(lesson.id, position);
    const boilerplate = Object.fromEntries(BOILERPLATE.filter((k) => lesson.properties?.[k] !== undefined).map((k) => [k, lesson.properties[k]]));
    const node = {
      id: randomUUID(), labels: ["Material"],
      properties: { ...boilerplate, identifier: objectUri(`media/${fileName}`), name, description: name, content: item.description, materialType: "Supporting", position },
    };
    graph.nodes.push(node);
    graph.relationships.push({ id: `hasPart:${lesson.id}->${node.id}`, type: "hasPart", start: lesson.id, end: node.id, properties: {} });
    pictures.set(name, node);
    guide = guide.slice(0, item.start) + `[IMAGE : ${name}]` + guide.slice(item.end);
    created.push({ name, lesson: lessonNumber, section: titleOf(section), file: hasFile ? fileName : null, chars: item.description.length });
  }
  section.properties.metadata.assemblyGuide = guide;
  // A phase section covering nothing cannot reach the lesson's pictures.
  if (lesson && coversOf(section.id).length === 0) {
    graph.relationships.push({ id: `covers:${section.id}->${lesson.id}`, type: "covers", start: section.id, end: lesson.id, properties: {} });
    coversAdded.push({ section: titleOf(section), lesson: lessonNumber });
  }
}

// ── Upload (only with --apply) ───────────────────────────────────────────────

let uploaded = 0, alreadyThere = 0;
const toUpload = created.filter((c) => c.file);
if (apply && toUpload.length > 0) {
  const require = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), "../package.json"));
  const fbApp = require("firebase-admin/app");
  const fbStorage = require("firebase-admin/storage");
  const keyPath = process.env.SERVICE_ACCOUNT_KEY_PATH;
  if (fbApp.getApps().length === 0) fbApp.initializeApp({ credential: keyPath ? fbApp.cert(keyPath) : fbApp.applicationDefault(), storageBucket: bucketName });
  const bucket = fbStorage.getStorage().bucket();
  for (const c of toUpload) {
    const bytes = readFileSync(join(imagesDir, c.file));
    const file = bucket.file(`${docsPrefix}media/${c.file}`);
    const [exists] = await file.exists();
    if (exists) {
      const [meta] = await file.getMetadata();
      if (meta.md5Hash === createHash("md5").update(bytes).digest("base64")) { alreadyThere++; continue; }
    }
    await file.save(bytes, { contentType: "image/png", resumable: false });
    uploaded++;
  }
}

// ── Outputs ──────────────────────────────────────────────────────────────────

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "graph.json"), JSON.stringify(graph));
const summary = {
  mode: apply ? "apply" : "dry-run",
  studentPromptsRepaired: repaired.length,
  studentParagraphsMoved: repaired.reduce((n, r) => n + r.paragraphs, 0),
  guideDescriptionsStripped: stripped.length,
  guideCharsRemoved: stripped.reduce((n, s) => n + s.chars, 0),
  guideDescriptionsAppendedToNode: keptInNode.length,
  blackboardPicturesCreated: created.filter((c) => !c.skipped).length,
  blackboardWithFile: created.filter((c) => c.file).length,
  blackboardCommissioned: created.filter((c) => !c.skipped && !c.file).length,
  blackboardSkipped: created.filter((c) => c.skipped).length,
  coversEdgesAdded: coversAdded.length,
  uploaded, alreadyThere,
  graph: { nodes: graph.nodes.length, edges: graph.relationships.length },
};
let report = `# Picture migration, second pass — ${summary.mode}\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n`;
report += `\n## 1. Student prompts repaired (paragraphs moved from the section into the node)\n\n| picture | section | paragraphs | chars |\n|---|---|---|---|\n` + repaired.map((r) => `| ${r.name} | ${r.section.replace(/\|/g, "/")} | ${r.paragraphs} | ${r.chars} |`).join("\n") + "\n";
report += `\n## 2. Guide descriptions that said more than the node — appended to the node\n\n| picture | section | overlap | chars |\n|---|---|---|---|\n` + keptInNode.map((k) => `| ${k.name} | ${k.section.replace(/\|/g, "/")} | ${k.share} | ${k.chars} |`).join("\n") + "\n";
report += `\n## 3. Blackboard pictures\n\n| picture | lesson | section | file |\n|---|---|---|---|\n` + created.map((c) => `| ${c.name} | ${c.lesson ?? "—"} | ${c.section.replace(/\|/g, "/")} | ${c.skipped ? "SKIPPED: " + c.skipped : c.file ?? "commissioned"} |`).join("\n") + "\n";
report += `\n### covers edges added (phase section → its lesson)\n\n` + (coversAdded.map((c) => `- ${c.section} → Leçon ${c.lesson}`).join("\n") || "(none)") + "\n";
writeFileSync(join(outDir, "report.md"), report);
console.log(JSON.stringify(summary, null, 2));
console.log(`\nwrote ${join(outDir, "graph.json")} and report.md`);
