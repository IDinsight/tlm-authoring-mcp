#!/usr/bin/env node
/*
 * Propose the picture nodes a student-book graph implies — READ-ONLY.
 *
 * Today a CI-maths picture is described inside the section that places it: a
 * `[IMAGE : <slug>]` marker in the section's assembly guide, followed by the
 * prompt, in a section that `covers` exactly one Activity. This walks every
 * such marker and writes what the migration would do — one `Material` per
 * picture under that Activity (docs/design-notes/illustrations-as-materials.md):
 * its name from the subject's own file-naming rule (`L06-amorce`), its
 * `content` = the prompt block, its file = `<mediaDir>/L06-amorce.png`, and
 * whether a produced image exists locally to upload.
 *
 * It changes nothing. The output is a proposal to read, and the input to the
 * second step (upload + attach + trim the section), which runs only once the
 * proposal has been agreed.
 *
 * Usage:
 *   node scripts/extract-pictures.mjs <graph.json> [--images <Outputs/Lessons dir>] [--out proposal.json]
 *
 * <graph.json> is an export-kg envelope ({ nodes, relationships }). The public
 * /kg explorer export will NOT do: it strips assembly guides.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const graphPath = args.find((a) => !a.startsWith("--"));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!graphPath) {
  console.error("usage: extract-pictures.mjs <graph.json> [--images <dir>] [--out proposal.json]");
  process.exit(1);
}
const imagesDir = opt("--images");
const outPath = opt("--out");

const graph = JSON.parse(readFileSync(resolve(graphPath), "utf8"));
const byId = new Map(graph.nodes.map((n) => [n.id, n]));
const labelsOf = (n) => n?.labels ?? [];
const titleOf = (n) => String(n?.properties?.description ?? "").split("\n")[0].trim();
const guideOf = (n) => String(n?.properties?.metadata?.assemblyGuide ?? "");

// The student book: the one TLM whose name says so. Its sections are the only
// ones whose pictures illustrate Activities; the teacher's guide has none.
const STUDENT_BOOK = /^Outil de l'élève$/;
const tlm = graph.nodes.find((n) => labelsOf(n).includes("TeachingLearningMaterial") && STUDENT_BOOK.test(titleOf(n)));
if (!tlm) { console.error("no TeachingLearningMaterial named « Outil de l'élève » in this graph"); process.exit(1); }

const parentOf = new Map();
for (const e of graph.relationships) if (e.type === "hasPart") parentOf.set(e.end, e.start);
const coversOf = (id) => graph.relationships.filter((e) => e.type === "covers" && e.start === id).map((e) => byId.get(e.end)).filter(Boolean);

// The lesson number a section belongs to, read off the nearest ancestor whose
// title carries « Leçon N » — that is how the book's spine names its lessons.
function lessonNumberOf(sectionId) {
  let current = sectionId;
  for (let hops = 0; hops < 20 && current; hops++) {
    const match = titleOf(byId.get(current)).match(/Leçon\s+(\d+)/i);
    if (match) return Number(match[1]);
    current = parentOf.get(current);
  }
  return null;
}

// The subject's own naming rule (formatter « Illustrations d'une leçon »):
// two-digit lesson number, the slug, and « je-retiens » as the ONE name for the
// notion image — « notion » is the old word and appears in 17 older sections.
const SLUG_ALIASES = { notion: "je-retiens" };
const fileStem = (lesson, slug) => `L${String(lesson).padStart(2, "0")}-${slug}`;

/*
 * The prompt block: from the marker line to the next blank line. Read on the
 * live sections, that is where every prompt ends — what follows is a heading
 * in capitals (QUESTIONS ORALES, ORIGINE, CE QUI CHANGE) after an empty line.
 */
function promptBlockAfter(guide, markerIndex) {
  const rest = guide.slice(markerIndex);
  const lineEnd = rest.indexOf("\n");
  const body = lineEnd < 0 ? "" : rest.slice(lineEnd + 1);
  const blank = body.search(/\n\s*\n/);
  return (blank < 0 ? body : body.slice(0, blank)).trim();
}

const MARKER = /\[IMAGE\s*:\s*([^\]]+)\]/g;
const pictures = [];
const anomalies = [];

for (const section of graph.nodes) {
  if (!labelsOf(section).includes("DocumentSection")) continue;
  // Only the student book's sections.
  let root = section.id; for (let hops = 0; hops < 20 && parentOf.has(root); hops++) root = parentOf.get(root);
  if (root !== tlm.id) continue;

  const guide = guideOf(section);
  const markers = [...guide.matchAll(MARKER)];
  if (markers.length === 0) continue;

  const covers = coversOf(section.id);
  const activity = covers.length === 1 && labelsOf(covers[0]).includes("Activity") ? covers[0] : null;
  const lesson = lessonNumberOf(section.id);

  for (const match of markers) {
    const rawSlug = match[1].trim();
    const where = { sectionId: section.id, section: titleOf(section), marker: rawSlug };
    if (/RETIR/i.test(rawSlug)) { anomalies.push({ ...where, problem: "marker says the picture was withdrawn — skipped" }); continue; }
    const slug = SLUG_ALIASES[rawSlug] ?? rawSlug;
    if (!/^[a-z0-9-]+$/.test(slug)) { anomalies.push({ ...where, problem: `slug '${rawSlug}' is not a file-name slug` }); continue; }
    if (!activity) { anomalies.push({ ...where, problem: `section covers ${covers.length} node(s), not exactly one Activity` }); continue; }
    if (lesson === null) { anomalies.push({ ...where, problem: "no « Leçon N » ancestor to number the file from" }); continue; }

    const prompt = promptBlockAfter(guide, match.index);
    if (prompt.length < 40) anomalies.push({ ...where, problem: `prompt block is only ${prompt.length} chars` });

    const name = fileStem(lesson, slug);
    const localFile = imagesDir ? resolve(imagesDir, `lecon_${String(lesson).padStart(2, "0")}`, "images", `${slug}.png`) : null;
    pictures.push({
      name,
      lesson,
      slug,
      renamedFrom: rawSlug !== slug ? rawSlug : undefined,
      activityId: activity.id,
      activity: titleOf(activity),
      sectionId: section.id,
      section: titleOf(section),
      relPath: `media/${name}.png`,
      localFile: localFile && existsSync(localFile) ? localFile : null,
      promptChars: prompt.length,
      prompt,
    });
  }
}

// Two pictures with one name under one activity would be one picture on the page.
const seen = new Map();
for (const p of pictures) {
  const key = `${p.activityId}/${p.name}`;
  if (seen.has(key)) anomalies.push({ sectionId: p.sectionId, section: p.section, marker: p.slug, problem: `duplicate name '${p.name}' under the same activity (also in '${seen.get(key)}')` });
  else seen.set(key, p.section);
}

const withFile = pictures.filter((p) => p.localFile).length;
const lessons = new Set(pictures.map((p) => p.lesson));
const perSlugKind = {};
for (const p of pictures) { const kind = p.slug.replace(/-?\d+$/, ""); perSlugKind[kind] = (perSlugKind[kind] ?? 0) + 1; }

const summary = {
  studentBook: tlm.id,
  pictures: pictures.length,
  lessons: lessons.size,
  withLocalFile: withFile,
  withoutLocalFile: pictures.length - withFile,
  renamedNotionToJeRetiens: pictures.filter((p) => p.renamedFrom).length,
  bySlugKind: perSlugKind,
  promptChars: { min: Math.min(...pictures.map((p) => p.promptChars)), median: [...pictures.map((p) => p.promptChars)].sort((a, b) => a - b)[Math.floor(pictures.length / 2)], max: Math.max(...pictures.map((p) => p.promptChars)) },
  anomalies: anomalies.length,
};
console.log(JSON.stringify(summary, null, 2));
if (anomalies.length) console.log("\nanomalies:\n" + anomalies.map((a) => `- ${a.problem}  [${a.section} · ${a.marker}]`).join("\n"));

if (outPath) {
  writeFileSync(resolve(outPath), JSON.stringify({ summary, pictures, anomalies }, null, 2));
  console.log(`\nproposal written to ${outPath}`);
}
