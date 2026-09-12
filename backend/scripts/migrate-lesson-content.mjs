#!/usr/bin/env node
/*
 * Put what is about the LESSON on the Lesson node.
 *
 * After the activity pass, the 60 pupil-book lesson guides still held the
 * lesson's own matter beside the page's: the règle porteuse and the error it
 * fights, the décor and cast every picture of the lesson shares, the answer
 * key, the experts' final list of directives, which tasks are production
 * tasks, how the notions are spread over the questions, and where the lesson
 * sits in the progression (what it remobilises, which lesson not to confuse it
 * with). All of it is curriculum, read by both documents; none of it is about
 * the two pages. It moves to the covered Lesson's `content`, paragraph by
 * paragraph, by opening words — a paragraph not recognised stays.
 *
 * What stays on the lesson guide, on purpose: the header line and the files
 * to deliver (the page and its delivery), the illustration instructions from
 * the experts and the « SCHÉMA DE JE RETIENS » (production of the pictures),
 * the integration-format remainder, dated decisions and open questions.
 * The teacher's own lesson sections (« Fiche — Leçon N ») are not touched:
 * their ACQUIS RÉACTIVÉ and DÉCOR ET MATÉRIEL are the natural next boundary.
 *
 * Usage:
 *   node scripts/migrate-lesson-content.mjs <graph.json> [--out migrated.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const graphPath = args.find((a) => !a.startsWith("--"));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!graphPath) { console.error("usage: migrate-lesson-content.mjs <graph.json> [--out migrated.json]"); process.exit(1); }
const outPath = opt("--out");

// Paragraph families, by opening words, that describe the LESSON rather than its pages.
const LESSON_PARAGRAPHS = [
  { id: "règle porteuse", re: /^•• (?:LA )?RÈGLE (?:LA PLUS IMPORTANTE|PORTEUSE|DES CONSIGNES)|^•• (?:SECONDE|TROISIÈME) RÈGLE/ },
  { id: "décor et personnages", re: /^(?:DÉCOR|PERSONNAGES|TOUTES LES SORTES D'OBJETS DE LA LEÇON)\b/ },
  { id: "réponses (clé)", re: /^(?:•• )?RÉPONSES?(?:,| DANS| —|\n| ?:)/ },
  { id: "consignes de l'élève", re: /^(?:•• )?(?:CONSIGNES DE L'ÉLÈVE|LES (?:SEPT|DEUX|TROIS|QUATRE|CINQ|SIX) (?:CONSIGNES|ENTRÉES))/ },
  { id: "tâches de production", re: /^(?:•• )?(?:AUCUNE |UNE SEULE |LA |CETTE LEÇON (?:N'A DROIT QU'À UNE |GARDE SES DEUX ))?TÂCHES? DE PRODUCTION/ },
  { id: "place dans la progression", re: /^(?:•• )?(?:CE QUE LA LEÇON REMOBILISE|RAPPORT AVEC|NE PAS CONFONDRE AVEC|SUITE DIRECTE DE LA LEÇON|PREMIÈRE LEÇON DE L'UNITÉ|LEÇON DE CLÔTURE|DERNIÈRE LEÇON|C'EST LA DERNIÈRE LEÇON|TROISIÈME LEÇON DE LA TRIADE)/ },
  { id: "ce que la leçon enseigne / n'enseigne pas", re: /^(?:•• )?(?:CE QUE LA LEÇON N|CE QUE L'OBJECTIF DIT|LA LEÇON PORTE)/ },
  { id: "répartition des notions", re: /^(?:RÉPARTITION|COUVERTURE)\b/ },
  { id: "calibrage", re: /^CALIBRAGE/ },
  { id: "le bilan (vue de la leçon)", re: /^•• LE BILAN|^LES TROIS QUESTIONS DE SON BILAN/ },
];

const graph = JSON.parse(readFileSync(resolve(graphPath), "utf8"));
const byId = new Map(graph.nodes.map((n) => [n.id, n]));
const parentOf = new Map(); for (const e of graph.relationships) if (e.type === "hasPart") parentOf.set(e.end, e.start);
const titleOf = (n) => String(n?.properties?.description ?? "").split("\n")[0].trim();
const labelsOf = (n) => n?.labels ?? [];
const rootOf = (id) => { let c = id; for (let i = 0; i < 20 && parentOf.has(c); i++) c = parentOf.get(c); return c; };
const coversOf = (id) => graph.relationships.filter((e) => e.type === "covers" && e.start === id).map((e) => byId.get(e.end)).filter(Boolean);
const guideOf = (n) => n.properties?.metadata?.assemblyGuide;
const setGuide = (n, text) => { n.properties.metadata = { ...n.properties.metadata, assemblyGuide: text }; };
const paragraphsOf = (text) => text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
const headingOf = (p) => (p.match(/^••\s*([^•]+?)\s*••/)?.[1] ?? p.split("\n")[0]).replace(/\s*[:—–.(,].*$/, "").replace(/\d+/g, "N").trim().slice(0, 48);

const pupilTlm = graph.nodes.find((n) => labelsOf(n).includes("TeachingLearningMaterial") && /^Outil de l'élève$/.test(titleOf(n)));
const lessonGuides = graph.nodes.filter((n) => labelsOf(n).includes("DocumentSection") && typeof guideOf(n) === "string" && rootOf(n.id) === pupilTlm.id && /^V2 — Leçon \d+/.test(titleOf(n)));

const moved = {}, stayed = {}; const tally = (b, k, c) => { const x = (b[k] ??= { n: 0, chars: 0 }); x.n++; x.chars += c; };
let lessonsFilled = 0, charsMoved = 0; const skipped = []; const samples = [];
for (const s of lessonGuides) {
  const covered = coversOf(s.id);
  const lesson = covered.length === 1 && labelsOf(covered[0]).includes("Lesson") ? covered[0] : null;
  if (!lesson) { skipped.push(`${titleOf(s)} — covers ${covered.length} node(s), not one Lesson`); continue; }
  const paras = paragraphsOf(guideOf(s)); const toLesson = [], kept = [];
  for (const p of paras) { const fam = LESSON_PARAGRAPHS.find((f) => f.re.test(p)); if (fam) { toLesson.push(p); tally(moved, fam.id + "  ·  " + headingOf(p), p.length); } else { kept.push(p); tally(stayed, headingOf(p), p.length); } }
  if (!toLesson.length) continue;
  const existing = typeof lesson.properties.content === "string" && lesson.properties.content.trim() ? lesson.properties.content.trim() + "\n\n" : "";
  lesson.properties.content = existing + toLesson.join("\n\n");
  lessonsFilled++; charsMoved += toLesson.join("\n\n").length;
  setGuide(s, kept.join("\n\n"));
  if (samples.length < 1 && /Leçon 20 /.test(titleOf(s))) samples.push({ section: titleOf(s), after: kept.join("\n\n"), lesson: titleOf(lesson), content: lesson.properties.content });
}
// The pupil guide's convention gains the Lesson.
const NOTE_FROM = "the lesson's `Assessment` holds the bilan questions.";
const NOTE_TO = "the lesson's `Assessment` holds the bilan questions; the `Lesson` itself holds its règle porteuse, its décor and cast, its answer key, the experts' final directives and its place in the progression.";
const g = guideOf(pupilTlm); const noteEdited = g.includes(NOTE_FROM); if (noteEdited) setGuide(pupilTlm, g.replace(NOTE_FROM, NOTE_TO));

console.log(JSON.stringify({ lessonGuides: lessonGuides.length, lessonsFilled, charsMovedToLessons: charsMoved, skipped: skipped.length, pupilGuideNoteEdited: noteEdited }, null, 2));
console.log("\n── MOVED to Lesson.content (family · heading as seen):"); for (const [k, v] of Object.entries(moved).sort((a, b) => b[1].chars - a[1].chars)) console.log(`   ${String(v.chars).padStart(7)} ${String(v.n).padStart(3)}¶  ${k}`);
console.log("\n── STAYED on the lesson guides (top 30 by chars):"); for (const [k, v] of Object.entries(stayed).sort((a, b) => b[1].chars - a[1].chars).slice(0, 30)) console.log(`   ${String(v.chars).padStart(7)} ${String(v.n).padStart(3)}¶  ${k}`);
if (skipped.length) console.log("\n── skipped:\n  " + skipped.join("\n  "));
for (const smp of samples) console.log(`\n===== SAMPLE « ${smp.section} »\n--- guide AFTER (${smp.after.length} chars):\n${smp.after.slice(0, 1200)}\n--- Lesson « ${smp.lesson} » content (${smp.content.length} chars), headings:\n  ${paragraphsOf(smp.content).map((p) => headingOf(p)).join("\n  ")}`);
if (outPath) { writeFileSync(resolve(outPath), JSON.stringify(graph, null, 2)); console.log(`\nmigrated graph written to ${outPath}`); } else console.log("\ndry run — pass --out <file> to write the migrated graph.");
