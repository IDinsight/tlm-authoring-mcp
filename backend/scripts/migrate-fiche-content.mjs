#!/usr/bin/env node
/*
 * The teacher's « Fiche — Leçon N » sections: what is about the LESSON goes on
 * the Lesson, what is history goes in the journal, what is about the fiche stays.
 *
 * Each of the 55 fiche guides restates, for the teacher, matter the pupil-book
 * lesson guide also carried and that now lives on the Lesson node: the règle
 * porteuse and the error it fights, the décor and material, the answer key,
 * the directives, what the lesson reactivates or revisits, its terminology.
 * The two versions are reworded, not copies, and the teacher's carries things
 * the pupil's does not (the évaluation and objectivation answers, the
 * classroom material) — and in places the two answer keys DISAGREE. So nothing
 * is deduplicated here: the teacher's paragraphs are appended to the Lesson's
 * `content` under one marker line, « === VU DE LA FICHE DU MAÎTRE === », and
 * the report lists every answer-key disagreement for a person to settle.
 *
 * A fiche guide is partitioned by its « === TITLE === » headings: a block runs
 * from its heading to the next one. Blocks move whole. The pupil-facing title
 * in the header (« TITRE IMPRIMÉ SUR LA PAGE DE L'ÉLÈVE » or the « Bandeau OS »)
 * becomes the Lesson's canonical `name`; the header block itself stays.
 *
 * Usage:
 *   node scripts/migrate-fiche-content.mjs <graph.json> [--out migrated.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const graphPath = args.find((a) => !a.startsWith("--"));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!graphPath) { console.error("usage: migrate-fiche-content.mjs <graph.json> [--out migrated.json]"); process.exit(1); }
const outPath = opt("--out");

const HEADING = /^===\s*(.+?)\s*===/;
// « === » blocks whose matter is the lesson's.
const LESSON_BLOCKS = [
  /^LA RÈGLE PORTEUSE DE LA LEÇON$/, /^DÉCOR ET MATÉRIEL( DE LA LEÇON)?$/, /^LES RÉPONSES, DANS L'ORDRE$/,
  /^LES (SEPT )?CONSIGNES(, MOT POUR MOT| DE LA PAGE DE L'ÉLÈVE)?$/, /^LA FORME DES CONSIGNES$/,
  /^CE QUE LA PHASE \d+ RÉACTIVE$/, /^CE QUE LA LEÇON REVISITE$/,
  /^TERMINOLOGIE TENUE DANS TOUTE LA LEÇON$/, /^LES MOTS DE LA LEÇON, À EMPLOYER LÀ OÙ ILS SONT$/,
  /^LA CONVENTION DONT DÉPENDENT LES RÉPONSES$/,
];
// Unheaded paragraphs at the top of a fiche guide that are the lesson's.
const LESSON_PARAGRAPHS = [
  /^DÉCOR( ET MATÉRIEL)?( DE LA LEÇON)?\s*:/, /^L'ERREUR D'ÉLÈVE QU/, /^DEUX \S+ SONT ENSEIGNÉE?S/, /^CE QUI EST NEUF AUJOURD'HUI/,
  /^RAPPORT AVEC LA LEÇON/, /^LEÇON DE CLÔTURE DE L'UNITÉ/, /^PREMIÈRE LEÇON DE NUMÉRATION/, /^CETTE LEÇON FERME L'UNITÉ/,
  /^CALIBRAGE/, /^LES DEUX SEULES FAÇONS DE SE TROMPER/, /^LE MATÉRIEL DE RÉFÉRENCE/,
];
// The teacher-side pointer to the formatter: the spec itself says the template is written there once.
// Two forms: the bare pointer, and the pointer followed by an enumeration of what the
// formatter covers; both end on « ce guide ne porte que ce qui est propre à la leçon ».
const GABARIT_POINTER = /^LE GABARIT COMMUN AUX \d+ FICHES EST DANS LA MISE EN FORME « [^»]+ »(?: : [^.]+)?\. IL NE SE RECOPIE (?:PAS|PLUS) ICI\. Ce guide ne porte que ce qui est PROPRE à la Leçon \d+(?:, et les (?:neuf )?sous-sections portent le détail de chaque phase)?\.$/;
// Dated history the journal pass did not recognise (no banner).
const HISTORY = /^(REPRISE DU \d+ \w+ \d{4} SUR LA FICHE|CRÉÉE LE \d+ \w+ \d{4})/;
const MARKER = "=== VU DE LA FICHE DU MAÎTRE ===";

const graph = JSON.parse(readFileSync(resolve(graphPath), "utf8"));
const byId = new Map(graph.nodes.map((n) => [n.id, n]));
const titleOf = (n) => String(n?.properties?.description ?? "").split("\n")[0].trim();
const labelsOf = (n) => n?.labels ?? [];
const guideOf = (n) => n.properties?.metadata?.assemblyGuide;
const setGuide = (n, text) => { n.properties.metadata = { ...n.properties.metadata, assemblyGuide: text }; };
const fiches = graph.nodes.filter((n) => labelsOf(n).includes("DocumentSection") && typeof guideOf(n) === "string" && /^Fiche — Leçon \d+/.test(titleOf(n)));

// Partition a guide into blocks: [{heading|null, paragraphs}] — a heading opens a block that runs to the next heading.
function blocksOf(text) {
  const blocks = [{ heading: null, paragraphs: [] }];
  for (const p of text.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean)) {
    const h = p.match(HEADING);
    if (h) blocks.push({ heading: h[1], paragraphs: [p] }); else blocks[blocks.length - 1].paragraphs.push(p);
  }
  return blocks.filter((b) => b.paragraphs.length);
}
const keyOf = (text, kind) => { // "NOUS FAISONS : ★ = O · ▲ = X" → {★:"O",▲:"X"} (signs only; « tâche », « à fixer » skipped)
  const seg = text.split(/\n|;/).find((l) => l.toUpperCase().includes(kind)); if (!seg) return null;
  const out = {}; for (const m of seg.matchAll(/([★▲■●])\s*=\s*([XO–-])(?![\p{L}])/gu)) out[m[1]] = m[2] === "-" ? "–" : m[2]; return out;
};

const report = { moved: {}, stayed: {}, pointersDeleted: 0, pointersKept: [], journaled: 0, names: 0, disagreements: [], lessonsFilled: 0, charsMoved: 0 };
const tally = (b, k, c) => { const x = (report[b][k] ??= { n: 0, chars: 0 }); x.n++; x.chars += c; };
for (const s of fiches) {
  const lesson = byId.get(graph.relationships.find((e) => e.type === "covers" && e.start === s.id)?.end);
  if (!lesson || !labelsOf(lesson).includes("Lesson")) continue;
  const toLesson = [], toJournal = [], kept = [];
  for (const b of blocksOf(guideOf(s))) {
    if (b.heading !== null) {
      if (LESSON_BLOCKS.some((re) => re.test(b.heading))) { toLesson.push(...b.paragraphs); tally("moved", "=== " + b.heading.replace(/\d+/g, "N"), b.paragraphs.join("\n\n").length); }
      else { kept.push(...b.paragraphs); tally("stayed", "=== " + b.heading.replace(/\d+/g, "N").slice(0, 48), b.paragraphs.join("\n\n").length); }
      if (/^EN-TÊTE$/.test(b.heading)) { // the pupil-facing title → Lesson.name (canonical)
        const t = b.paragraphs[0].match(/TITRE IMPRIMÉ SUR LA PAGE DE L'ÉLÈVE\s*:\s*«([^»]+)»/)?.[1] ?? b.paragraphs[0].match(/Bandeau OS\s*:\s*«\s*OS\s*[–-]\s*([^»]+)»/)?.[1];
        if (t && !lesson.properties.name) { lesson.properties.name = t.trim().replace(/\.$/, ""); report.names++; }
      }
      continue;
    }
    for (const p of b.paragraphs) {
      if (GABARIT_POINTER.test(p)) { report.pointersDeleted++; continue; }
      if (/^LE GABARIT COMMUN/.test(p)) { report.pointersKept.push(p.slice(0, 200)); kept.push(p); continue; }
      if (HISTORY.test(p)) { toJournal.push(p); report.journaled++; continue; }
      if (LESSON_PARAGRAPHS.some((re) => re.test(p))) { toLesson.push(p); tally("moved", p.split("\n")[0].replace(/\s*[:—–.(,].*$/, "").replace(/\d+/g, "N").slice(0, 48), p.length); continue; }
      kept.push(p); tally("stayed", p.split("\n")[0].replace(/\s*[:—–.(,].*$/, "").replace(/\d+/g, "N").slice(0, 48), p.length);
    }
  }
  // Answer keys: the teacher's (moving now) against the pupil's (already on the Lesson).
  const teacherKey = toLesson.find((p) => /^=== LES RÉPONSES/.test(p)); const pupilKey = String(lesson.properties.content || "").split(/\n\s*\n/).find((p) => /^(•• )?RÉPONSES/.test(p));
  if (teacherKey && pupilKey) for (const kind of ["NOUS FAISONS", "TU FAIS", "SITUATION N° 1", "SITUATION N° 2"]) {
    const a = keyOf(teacherKey, kind), b = keyOf(pupilKey, kind); if (!a || !b) continue;
    for (const sym of Object.keys(a)) if (b[sym] && b[sym] !== a[sym]) report.disagreements.push(`${titleOf(s).replace(/^Fiche — /, "")} · ${kind} ${sym} : élève ${b[sym]} / maître ${a[sym]}`);
  }
  if (toLesson.length) {
    const existing = typeof lesson.properties.content === "string" && lesson.properties.content.trim() ? lesson.properties.content.trim() + "\n\n" : "";
    lesson.properties.content = existing + MARKER + "\n\n" + toLesson.join("\n\n"); report.lessonsFilled++; report.charsMoved += toLesson.join("\n\n").length;
  }
  if (toJournal.length) { const j = typeof s.properties.metadata.journal === "string" && s.properties.metadata.journal.trim() ? s.properties.metadata.journal.trimEnd() + "\n\n" : `# Journal — ${titleOf(s)}\n\n`; s.properties.metadata = { ...s.properties.metadata, journal: j + toJournal.join("\n\n") }; }
  setGuide(s, kept.join("\n\n"));
}
console.log(JSON.stringify({ fiches: fiches.length, lessonsFilled: report.lessonsFilled, charsMovedToLessons: report.charsMoved, lessonNamesSet: report.names, gabaritPointersDeleted: report.pointersDeleted, gabaritPointersKeptWithTail: report.pointersKept.length, paragraphsToJournal: report.journaled, answerKeyDisagreements: report.disagreements.length }, null, 2));
console.log("\n── MOVED to Lesson.content (under « " + MARKER + " »):"); for (const [k, v] of Object.entries(report.moved).sort((a, b) => b[1].chars - a[1].chars)) console.log(`   ${String(v.chars).padStart(7)} ${String(v.n).padStart(3)}¶  ${k}`);
console.log("\n── STAYED on the fiche guides:"); for (const [k, v] of Object.entries(report.stayed).sort((a, b) => b[1].chars - a[1].chars).slice(0, 25)) console.log(`   ${String(v.chars).padStart(7)} ${String(v.n).padStart(3)}¶  ${k}`);
if (report.pointersKept.length) console.log("\n── GABARIT pointer paragraphs kept because they carry a tail (first one):\n   " + report.pointersKept[0]);
console.log("\n── ANSWER KEYS THAT DISAGREE (élève = pupil-book key on the Lesson, maître = the fiche's):"); for (const d of report.disagreements) console.log("   " + d);
if (outPath) { writeFileSync(resolve(outPath), JSON.stringify(graph, null, 2)); console.log(`\nmigrated graph written to ${outPath}`); } else console.log("\ndry run — pass --out <file> to write the migrated graph.");
