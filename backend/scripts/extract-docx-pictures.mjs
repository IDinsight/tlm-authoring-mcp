#!/usr/bin/env node
/*
 * Pull the pictures out of the experts' student-book files — READ-ONLY on the
 * inputs, writes a STAGING folder.
 *
 * The expert-corrected lessons (« Lesson 6-10.docx » …) embed the real pictures
 * at full size, with no names — Word calls them image5.png. This walks each
 * file in reading order, keeps the pictures (a pictogram or an answer mark is
 * re-used across lessons, a picture never is), classifies each by its shape,
 * and proposes the graph section it illustrates:
 *
 *   • the opening scene (wide, tall)      → the lesson's « JE FAIS — situation d'amorce »
 *   • the notion band (1584×672)          → « JE RETIENS — image de la notion »
 *   • a question band (wide, short)       → the k-th question section, in page order
 *   • a lone square cell                  → one option of a question laid out as cells
 *
 * For a band the proposal is by ORDER (the V2 sections were authored from these
 * very pages) and the directive printed just above the band rides along, so a
 * reader can confirm it against the section's guide before anything is attached.
 * A word-overlap score between that directive and the section's text is the
 * confidence; below 0.3 the row is marked to check.
 *
 * Output: <staging>/L06-amorce.png, L06-je-retiens.png, L06-nf-1.png … (a band the
 * graph has no section for stays L06-band-k.png), plus
 * <staging>/manifest.json (every picture, its proposed section, confidence) and
 * <staging>/manifest.md (the same, readable per lesson).
 *
 * Usage:
 *   node scripts/extract-docx-pictures.mjs <graph.json> <docx dir> <staging dir>
 *
 * Needs `npm run build` (the docx reader lives in dist/render).
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(resolve(REPO, "dist"))) { console.error("run `npm run build` first"); process.exit(1); }
const { unzip } = await import(resolve(REPO, "dist/render/index.js"));

const [graphPath, docxDir, stagingDir] = process.argv.slice(2);
if (!graphPath || !docxDir || !stagingDir) {
  console.error("usage: extract-docx-pictures.mjs <graph.json> <docx dir> <staging dir>");
  process.exit(1);
}

// ── The graph: the student book's picture sections, per lesson, in page order ──

const graph = JSON.parse(readFileSync(resolve(graphPath), "utf8"));
const byId = new Map(graph.nodes.map((n) => [n.id, n]));
const labelsOf = (n) => n?.labels ?? [];
const titleOf = (n) => String(n?.properties?.description ?? "").split("\n")[0].trim();
const guideOf = (n) => String(n?.properties?.metadata?.assemblyGuide ?? "");
const parentOf = new Map();
for (const e of graph.relationships) if (e.type === "hasPart") parentOf.set(e.end, e.start);
const rootOf = (id) => { let c = id; for (let i = 0; i < 20 && parentOf.has(c); i++) c = parentOf.get(c); return c; };
const tlm = graph.nodes.find((n) => labelsOf(n).includes("TeachingLearningMaterial") && titleOf(n) === "Outil de l'élève");
if (!tlm) { console.error("no « Outil de l'élève » document in the graph"); process.exit(1); }

const lessonNumberOf = (id) => {
  for (let c = id, i = 0; c && i < 20; c = parentOf.get(c), i++) {
    const m = titleOf(byId.get(c)).match(/Leçon\s+(\d+)/i);
    if (m) return Number(m[1]);
  }
  return null;
};
const coversActivity = (id) => {
  const targets = graph.relationships.filter((e) => e.type === "covers" && e.start === id).map((e) => byId.get(e.end));
  return targets.length === 1 && labelsOf(targets[0]).includes("Activity") ? targets[0] : null;
};

/** Sections of the student book carrying an [IMAGE : slug] marker, grouped by lesson, in position order. */
const sectionsByLesson = new Map();
for (const n of graph.nodes) {
  if (!labelsOf(n).includes("DocumentSection") || rootOf(n.id) !== tlm.id) continue;
  const marker = guideOf(n).match(/\[IMAGE\s*:\s*([^\]]+)\]/);
  if (!marker || /RETIR/i.test(marker[1])) continue;
  const lesson = lessonNumberOf(n.id);
  if (lesson === null) continue;
  const slug = marker[1].trim() === "notion" ? "je-retiens" : marker[1].trim();
  const activity = coversActivity(n.id);
  const row = { id: n.id, title: titleOf(n), slug, position: n.properties.position ?? 0, activityId: activity?.id ?? null, activity: activity ? titleOf(activity) : null, text: normalise(guideOf(n)) };
  (sectionsByLesson.get(lesson) ?? sectionsByLesson.set(lesson, []).get(lesson)).push(row);
}
for (const rows of sectionsByLesson.values()) rows.sort((a, b) => a.position - b.position);

function normalise(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
// Share of the directive's words found in the section's text — the confidence.
function overlap(directive, sectionText) {
  const words = normalise(directive).split(" ").filter((w) => w.length > 3);
  if (words.length === 0) return 0;
  const hits = words.filter((w) => sectionText.includes(w)).length;
  return Math.round((hits / words.length) * 100) / 100;
}

// ── The documents: pictures in reading order, per lesson ──────────────────────

function pngSize(buf) {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i < buf.length - 9;) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1]; const len = buf.readUInt16BE(i + 2);
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return { w: 0, h: 0 };
}
const md5 = (buf) => createHash("md5").update(buf).digest("hex");

/** Every paragraph of a .docx as { text, images[] } in order. */
function paragraphsOf(docxPath) {
  const parts = unzip(readFileSync(docxPath));
  const rels = new Map([...parts.get("word/_rels/document.xml.rels").toString("utf8").matchAll(/Id="(rId\d+)"[^>]*Target="(media\/[^"]+)"/g)].map((m) => [m[1], m[2]]));
  const xml = parts.get("word/document.xml").toString("utf8");
  const out = [];
  for (const p of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
    const text = [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("").trim();
    const images = [...p.matchAll(/r:embed="(rId\d+)"/g)].map((m) => rels.get(m[1])).filter(Boolean).map((rel) => ({ rel, data: parts.get("word/" + rel) }));
    out.push({ text, images });
  }
  return out;
}

// First pass over every file: which image bytes appear in more than one lesson
// (pictograms, answer marks) — those are furniture, never a picture.
const docxFiles = readdirSync(docxDir).filter((f) => f.endsWith(".docx") && !f.startsWith("~$")).sort();
const lessonsPerHash = new Map();
const perFile = new Map();
for (const file of docxFiles) {
  const paragraphs = paragraphsOf(join(docxDir, file));
  perFile.set(file, paragraphs);
  let lesson = null;
  for (const { text, images } of paragraphs) {
    const heading = text.match(/^(?:Unité\s+\d+\s*·\s*)?Leçon\s+(\d+)/i);
    if (heading) lesson = Number(heading[1]);
    for (const img of images) {
      const key = md5(img.data);
      (lessonsPerHash.get(key) ?? lessonsPerHash.set(key, new Set()).get(key)).add(lesson);
    }
  }
}
const isFurniture = (data) => (lessonsPerHash.get(md5(data))?.size ?? 0) > 1 || data.length < 20_000;

const classify = ({ w, h }) => {
  if (w === 1584 && h === 672) return "je-retiens";
  if (w >= 1200 && h >= 500) return "amorce";
  if (h <= 300 && w >= 800) return "band";
  if (w === h) return "cell";
  return "other";
};

mkdirSync(stagingDir, { recursive: true });
const manifest = [];
for (const file of docxFiles) {
  // An integration lesson is two « Situation n° N » blocks, each with its own
  // scene and its own bands (slugs s1, s1-1, s1-2 … in the graph). The heading
  // switches the situation; a scene then goes to `sN` and bands to `sN-k`.
  let lesson = null, lastText = "", bandIndex = 0, cellIndex = 0, otherIndex = 0, situation = null, situationBand = 0;
  for (const { text, images } of perFile.get(file)) {
    const heading = text.match(/^(?:Unité\s+\d+\s*·\s*)?Leçon\s+(\d+)/i);
    if (heading) { lesson = Number(heading[1]); lastText = ""; bandIndex = cellIndex = otherIndex = 0; situation = null; situationBand = 0; }
    const situationHeading = text.match(/^Situation\s+n°\s*(\d+)/i);
    if (situationHeading) { situation = Number(situationHeading[1]); situationBand = 0; }
    for (const img of images) {
      if (lesson === null || isFurniture(img.data)) continue;
      const size = pngSize(img.data);
      const kind = classify(size);
      const ext = img.rel.toLowerCase().endsWith(".jpg") || img.rel.toLowerCase().endsWith(".jpeg") ? "jpg" : "png";
      const L = `L${String(lesson).padStart(2, "0")}`;
      const sections = sectionsByLesson.get(lesson) ?? [];
      const bandSections = sections.filter((s) => !["amorce", "je-retiens"].includes(s.slug) && !/^s\d/.test(s.slug));

      let name, proposed = null, confidence = null;
      if (situation !== null && (kind === "amorce" || kind === "band")) {
        if (kind === "amorce") { proposed = sections.find((s) => s.slug === `s${situation}`) ?? null; confidence = proposed ? 1 : 0; }
        else { situationBand++; proposed = sections.find((s) => s.slug === `s${situation}-${situationBand}`) ?? null; confidence = proposed ? overlap(lastText, proposed.text) : 0; }
        name = proposed ? `${L}-${proposed.slug}` : `${L}-s${situation}-${kind === "amorce" ? "scene" : "band-" + situationBand}`;
      }
      else if (kind === "amorce") { name = `${L}-amorce`; proposed = sections.find((s) => s.slug === "amorce") ?? null; confidence = proposed ? 1 : 0; }
      else if (kind === "je-retiens") { name = `${L}-je-retiens`; proposed = sections.find((s) => s.slug === "je-retiens") ?? null; confidence = proposed ? 1 : 0; }
      else if (kind === "band") { bandIndex++; proposed = bandSections[bandIndex - 1] ?? null; confidence = proposed ? overlap(lastText, proposed.text) : 0; name = proposed ? `${L}-${proposed.slug}` : `${L}-band-${bandIndex}`; }
      else if (kind === "cell") { cellIndex++; name = `${L}-cell-${cellIndex}`; }
      else { otherIndex++; name = `${L}-other-${otherIndex}`; }

      const fileName = `${name}.${ext}`;
      writeFileSync(join(stagingDir, fileName), img.data);
      manifest.push({
        file: fileName, source: file, lesson, kind, width: size.w, height: size.h, bytes: img.data.length,
        directive: lastText.slice(0, 160),
        proposedSectionId: proposed?.id ?? null, proposedSection: proposed?.title ?? null, proposedSlug: proposed?.slug ?? null,
        activityId: proposed?.activityId ?? null, activity: proposed?.activity ?? null,
        confidence, check: kind === "band" ? (confidence === null || confidence < 0.3) : proposed === null && kind !== "cell" && kind !== "other",
      });
    }
    if (text) lastText = text;
  }
}

// ── Reports ───────────────────────────────────────────────────────────────────

const byKind = {};
for (const m of manifest) byKind[m.kind] = (byKind[m.kind] ?? 0) + 1;
const lessons = [...new Set(manifest.map((m) => m.lesson))].sort((a, b) => a - b);
const missingLessons = [...sectionsByLesson.keys()].filter((l) => !lessons.includes(l)).sort((a, b) => a - b);
const summary = {
  files: docxFiles.length, pictures: manifest.length, byKind, lessons,
  lessonsInGraphWithoutPictures: missingLessons,
  proposedWithSection: manifest.filter((m) => m.proposedSectionId).length,
  toCheck: manifest.filter((m) => m.check).length,
  bandsWithoutSection: manifest.filter((m) => m.kind === "band" && !m.proposedSectionId).length,
  sectionsWithoutPicture: [...sectionsByLesson.entries()].filter(([l]) => lessons.includes(l)).flatMap(([, rows]) => rows).filter((s) => !manifest.some((m) => m.proposedSectionId === s.id)).length,
};
writeFileSync(join(stagingDir, "manifest.json"), JSON.stringify({ summary, pictures: manifest }, null, 2));

let md = `# Pictures extracted from the experts' files\n\n${JSON.stringify(summary)}\n`;
for (const lesson of lessons) {
  md += `\n## Leçon ${lesson}\n\n| file | size | printed above it | proposed section | conf. |\n|---|---|---|---|---|\n`;
  for (const m of manifest.filter((x) => x.lesson === lesson)) {
    md += `| ${m.file} | ${m.width}×${m.height} | ${m.directive.slice(0, 70).replace(/\|/g, "/")} | ${(m.proposedSection ?? "—").replace(/\|/g, "/")} | ${m.confidence ?? "—"}${m.check ? " ⚠" : ""} |\n`;
  }
}
writeFileSync(join(stagingDir, "manifest.md"), md);
console.log(JSON.stringify(summary, null, 2));
console.log(`\nstaged ${manifest.length} pictures + manifest.json / manifest.md in ${stagingDir}`);
