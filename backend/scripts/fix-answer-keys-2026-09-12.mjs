#!/usr/bin/env node
/*
 * Settle the answer-key disagreements the fiche pass surfaced (2026-09-12).
 *
 * Putting the teacher's answer key beside the pupil book's on each Lesson showed
 * five real mismatches. In four of them (Leçons 18 ★ and ▲, 41 ★, 42 ★) the odd one
 * out is the pupil book's one-line SUMMARY KEY, written before the band was
 * redrawn: the question's own answer paragraph and the teacher's printed line
 * agree with each other. Those four summary lines are corrected. In Leçon 20
 * (Nous faisons ▲) the question itself and the teacher disagree; decision of
 * Karimou Ba: the teacher's O stands, so the question's answer changes and a
 * dated note says its distractor rationale, written for X, is to be re-read.
 *
 * Every edit targets one exact substring and fails if it is not found exactly once.
 *
 * Usage: node scripts/fix-answer-keys-2026-09-12.mjs <graph.json> --out <migrated.json>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const graphPath = args.find((a) => !a.startsWith("--"));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const outPath = opt("--out");
if (!graphPath) { console.error("usage: fix-answer-keys-2026-09-12.mjs <graph.json> [--out migrated.json]"); process.exit(1); }

const NOTE = (what) => `Clé corrigée le 12 septembre 2026 (décision de Karimou Ba) : ${what}.`;
const graph = JSON.parse(readFileSync(resolve(graphPath), "utf8"));
const byId = new Map(graph.nodes.map((n) => [n.id, n]));
const titleOf = (n) => String(n?.properties?.description ?? "").split("\n")[0].trim();
const lessonByNumber = new Map();
for (const s of graph.nodes.filter((n) => (n.labels ?? []).includes("DocumentSection") && /^V2 — Leçon \d+/.test(titleOf(n)))) {
  const covered = graph.relationships.find((e) => e.type === "covers" && e.start === s.id);
  if (covered) lessonByNumber.set(Number(titleOf(s).match(/Leçon (\d+)/)[1]), byId.get(covered.end));
}
const replaceOnce = (text, from, to, where) => { const n = text.split(from).length - 1; if (n !== 1) throw new Error(`${where}: expected exactly one occurrence of « ${from} », found ${n}`); return text.replace(from, to); };
const log = [];

// A summary-key line inside a Lesson's `content`: swap the sign, append the note to that paragraph.
function fixSummaryKey(lessonNo, from, to, what) {
  const lesson = lessonByNumber.get(lessonNo);
  const paras = String(lesson.properties.content).split(/\n\s*\n/);
  const i = paras.findIndex((p) => /^(•• )?RÉPONSES/.test(p) && p.includes(from));
  if (i < 0) throw new Error(`Leçon ${lessonNo}: summary key with « ${from} » not found`);
  paras[i] = replaceOnce(paras[i], from, to, `Leçon ${lessonNo} key`) + "\n" + NOTE(what);
  lesson.properties.content = paras.join("\n\n");
  log.push(`Leçon ${lessonNo} · clé de l'Outil de l'élève : « ${from} » → « ${to} »`);
}
fixSummaryKey(18, "Situation n° 1 — ★ = O", "Situation n° 1 — ★ = X", "Situation n° 1 ★ = X, comme la question et la fiche");
fixSummaryKey(18, "Situation n° 2 — ★ = –, ▲ = O", "Situation n° 2 — ★ = –, ▲ = X", "Situation n° 2 ▲ = X, comme la question et la fiche");
fixSummaryKey(41, "TU FAIS ★ = –, ▲ = O", "TU FAIS ★ = O, ▲ = O", "TU FAIS ★ = O, comme la question et la fiche — la phrase « deux questions voisines n'ont jamais le même signe » ne tient plus pour ★ et ▲");
fixSummaryKey(42, "TU FAIS ★ = X, ▲ = tâche de production", "TU FAIS ★ = –, ▲ = tâche de production", "TU FAIS ★ = –, comme la question et la fiche");
fixSummaryKey(20, "NOUS FAISONS ★ = O, ▲ = X, ■ = O", "NOUS FAISONS ★ = O, ▲ = O, ■ = O", "NOUS FAISONS ▲ = O, comme la fiche du maître relue sur la bande — les trois activités portent alors le même signe");

// Leçon 20, Nous faisons ▲: the question's own answer changes, with a dated note under it.
{
  const section = graph.nodes.find((n) => (n.labels ?? []).includes("DocumentSection") && /^NOUS FAISONS — activité ▲/.test(titleOf(n)) && /L20-nf-2/.test(n.properties.metadata?.assemblyGuide ?? ""));
  const activity = byId.get(graph.relationships.find((e) => e.type === "covers" && e.start === section.id).end);
  const content = String(activity.properties.content);
  activity.properties.content = replaceOnce(content, "RÉPONSE : X.\n", "RÉPONSE : O.\n⚠ RÉPONSE CORRIGÉE LE 12 SEPTEMBRE 2026 (décision de Karimou Ba) : O, conformément à la fiche du maître relue sur la bande. La justification des distracteurs ci-dessous a été écrite pour X et reste à relire.\n", "Leçon 20 activité ▲");
  log.push(`Leçon 20 · activité ▲ « ${titleOf(activity)} » : RÉPONSE X → O, note datée ajoutée`);
}
console.log(log.map((l) => "  " + l).join("\n"));
if (outPath) { writeFileSync(resolve(outPath), JSON.stringify(graph, null, 2)); console.log(`written to ${outPath}`); }
