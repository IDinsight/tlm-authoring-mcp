#!/usr/bin/env node
/*
 * Put a lesson's words on the curriculum nodes they describe.
 *
 * The 523 activities of ci/maths carry one line each — the directive — and no
 * `content`. Everything else about a question sat in the pupil-book section
 * that places it: the answer, why each distractor traps a pupil, what is being
 * tested, the oral questions of the amorce, the bilan questions. The teacher's
 * guide then had to read the pupil book's sections to copy that text, so one
 * document depended on another document's assembly prose, and nothing could
 * check an answer against its question because the answer was not a field.
 *
 * This moves, paragraph by paragraph and by the paragraph's opening words:
 *   • a question section's answer / distractors / what-is-tested / directive /
 *     task paragraphs → the covered Activity's `content` (canonical LC);
 *   • the amorce section's oral questions and situation text → the amorce
 *     Activity's `content`;
 *   • the amorce section's « •• QUESTIONS DU BILAN •• » block → a new
 *     `Assessment` node under the Lesson (canonical: Lesson hasPart Assessment,
 *     educationalUse "Assessment"), which the teacher's phase-8 section now
 *     also `covers`;
 *   • the situation-context section's context text → its Activity.
 * What stays on a section is what is about the PAGE: layout choices, the
 * picture marker, presentation, banners, and anything not recognised.
 *
 * The teacher-side sourcing sentences (« se prennent dans le guide d'assemblage
 * de la section JE FAIS… ») are rewritten to point at the curriculum node the
 * section covers. Lesson-level guides are out of scope here (RÈGLE PORTEUSE,
 * DÉCOR… would go on the Lesson; a later pass).
 *
 * Usage:
 *   node scripts/migrate-activity-content.mjs <graph.json> [--out migrated.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const graphPath = args.find((a) => !a.startsWith("--"));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!graphPath) { console.error("usage: migrate-activity-content.mjs <graph.json> [--out migrated.json]"); process.exit(1); }
const outPath = opt("--out");

// Paragraph families, by opening words, that describe the ACTIVITY rather than the page.
const ACTIVITY_PARAGRAPHS = [
  /^RÉPONSES?(?: ATTENDUES?)?\b/,
  /^LE CORRIGÉ DU MAÎTRE/,
  /^CE QUI EST TESTÉ/,
  /^CE QUE (?:LA QUESTION|CETTE QUESTION|L'ACTIVITÉ|CETTE ACTIVITÉ|LA TÂCHE|CETTE TÂCHE) FAIT/,
  // (`\b` is ASCII-only in JavaScript: after an accented letter, spell the boundary out.)
  /^(?:RELATION|GESTE|SENS|NOTION|RÈGLE|FORME D'INDICE) TESTÉE?(?!\p{L})/u,
  /^(?:SENS|CAS) TRAITÉ(?!\p{L})/u,
  /^CE QUI EST PRODUIT/,
  /^TYPE :/,
  /^LE POINT À NE PAS RATER/,
  /^DIRECTIVE\b/,
  /^•• DIRECTIVE — VERSION FINALE DES EXPERTS/,
  /^TÂCHES? DE PRODUCTION/,
  /^CALIBRAGE/,
  /^CONTRAINTE DONT DÉPEND L'EXERCICE/,
  /^LES DEUX SEULES FAÇONS DE SE TROMPER/,
  /^AUCUN SIGNE NE DOMINE/,
  /^LES? (?:DEUX )?DISTRACTEURS?\b/,
];
// The amorce section: what the class hears and sees, and the bilan.
const AMORCE_PARAGRAPHS = [/^(?:•• )?QUESTIONS? ORALES?/, /^TEXTE DE LA SITUATION/];
const BILAN_BANNER = /^•• QUESTIONS DU BILAN[^•]*••/;
const BILAN_CONTINUATION = /^(?:\d+\.\s|→|SA DIRECTIVE DE BILAN|Sa consigne de bilan|Son bilan|CE QUE L'IMAGE DOIT MONTRER POUR)/;
// A situation's context section (integration lessons).
const CONTEXT_PARAGRAPHS = [/^CONTEXTE\b/, /^TITRE DE LA SITUATION/, /^LE POINT À NE PAS RATER/];

const graph = JSON.parse(readFileSync(resolve(graphPath), "utf8"));
const byId = new Map(graph.nodes.map((n) => [n.id, n]));
const parentOf = new Map(); for (const e of graph.relationships) if (e.type === "hasPart") parentOf.set(e.end, e.start);
const titleOf = (n) => String(n?.properties?.description ?? "").split("\n")[0].trim();
const labelsOf = (n) => n?.labels ?? [];
const rootOf = (id) => { let c = id; for (let i = 0; i < 20 && parentOf.has(c); i++) c = parentOf.get(c); return c; };
const lessonNumberOf = (id) => { let c = id; for (let i = 0; i < 20 && c; i++) { const m = titleOf(byId.get(c)).match(/Leçon (\d+)/i); if (m) return Number(m[1]); c = parentOf.get(c); } return null; };
const coversOf = (id) => graph.relationships.filter((e) => e.type === "covers" && e.start === id).map((e) => byId.get(e.end)).filter(Boolean);
const guideOf = (n) => n.properties?.metadata?.assemblyGuide;
const setGuide = (n, text) => { n.properties.metadata = { ...n.properties.metadata, assemblyGuide: text }; };
const paragraphsOf = (text) => text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
const appendContent = (node, paragraphs) => { const existing = typeof node.properties.content === "string" && node.properties.content.trim() ? node.properties.content.trim() + "\n\n" : ""; node.properties.content = existing + paragraphs.join("\n\n"); };

const pupilTlm = graph.nodes.find((n) => labelsOf(n).includes("TeachingLearningMaterial") && /^Outil de l'élève$/.test(titleOf(n)));
const teacherTlm = graph.nodes.find((n) => labelsOf(n).includes("TeachingLearningMaterial") && /^Guide/.test(titleOf(n)));
const sections = graph.nodes.filter((n) => labelsOf(n).includes("DocumentSection") && typeof guideOf(n) === "string");
const kindOf = (t) => /^V2 — Leçon/.test(t) ? "LESSON" : /^JE FAIS/.test(t) ? "JE FAIS" : /^NOUS FAISONS/.test(t) ? "NOUS FAISONS" : /^JE RETIENS/.test(t) ? "JE RETIENS" : /^TU FAIS/.test(t) ? "TU FAIS" : /^SITUATION N° \d — contexte/.test(t) ? "SIT-CONTEXTE" : /^SITUATION N°/.test(t) ? "SIT-QUESTION" : "OTHER";

const report = { moved: {}, stayed: {}, activitiesFilled: new Set(), assessments: [], coversAdded: 0, skipped: [], charsMoved: 0 };
const tally = (bucket, kind, key, chars) => { const b = (report[bucket][kind] ??= {}); const c = (b[key] ??= { n: 0, chars: 0 }); c.n++; c.chars += chars; };
const headingOf = (p) => (p.match(/^••\s*([^•]+?)\s*••/)?.[1] ?? p.split("\n")[0]).replace(/\s*[:—–.(].*$/, "").replace(/\d+/g, "N").trim().slice(0, 44);
const samples = [];

for (const s of sections) {
  if (rootOf(s.id) !== pupilTlm.id) continue;
  const kind = kindOf(titleOf(s));
  if (!["TU FAIS", "NOUS FAISONS", "SIT-QUESTION", "JE FAIS", "SIT-CONTEXTE"].includes(kind)) continue;
  const covered = coversOf(s.id);
  const activity = covered.length === 1 && labelsOf(covered[0]).includes("Activity") ? covered[0] : null;
  if (!activity) { report.skipped.push(`${titleOf(s)} — covers ${covered.length} node(s), not one Activity`); continue; }

  const paras = paragraphsOf(guideOf(s));
  const toActivity = [], toBilan = [], kept = [];
  const families = kind === "JE FAIS" ? AMORCE_PARAGRAPHS : kind === "SIT-CONTEXTE" ? CONTEXT_PARAGRAPHS : ACTIVITY_PARAGRAPHS;
  let inBilan = false;
  for (const p of paras) {
    if (kind === "JE FAIS" && BILAN_BANNER.test(p)) { inBilan = true; toBilan.push(p); tally("moved", kind, "•• QUESTIONS DU BILAN (→ Assessment)", p.length); continue; }
    if (inBilan && BILAN_CONTINUATION.test(p)) { toBilan.push(p); tally("moved", kind, "bilan continuation (→ Assessment)", p.length); continue; }
    inBilan = false;
    if (families.some((re) => re.test(p))) { toActivity.push(p); tally("moved", kind, headingOf(p), p.length); continue; }
    kept.push(p); tally("stayed", kind, headingOf(p), p.length);
  }
  if (toActivity.length === 0 && toBilan.length === 0) continue;

  if (toActivity.length) { appendContent(activity, toActivity); report.activitiesFilled.add(activity.id); report.charsMoved += toActivity.join("\n\n").length; }
  if (toBilan.length) {
    const lesson = byId.get(parentOf.get(activity.id));
    if (!lesson || !labelsOf(lesson).includes("Lesson")) { report.skipped.push(`${titleOf(s)} — amorce activity not under a Lesson`); kept.push(...toBilan); }
    else {
      const siblings = graph.relationships.filter((e) => e.type === "hasPart" && e.start === lesson.id).map((e) => byId.get(e.end));
      const position = Math.max(0, ...siblings.map((n) => Number(n?.properties?.position ?? 0))) + 1;
      const boilerplate = Object.fromEntries(["license", "provider", "attributionStatement", "inLanguage", "academicSubject"].filter((k) => activity.properties[k] !== undefined).map((k) => [k, activity.properties[k]]));
      const id = randomUUID();
      const body = toBilan.map((p) => p.replace(BILAN_BANNER, "").trim()).filter(Boolean).join("\n\n");
      graph.nodes.push({ id, labels: ["Assessment"], properties: { ...boilerplate, identifier: id, description: `Bilan de la leçon — ${titleOf(lesson)}`, position, normalizedType: "Assessment", educationalUse: "Assessment", content: body } });
      graph.relationships.push({ id: `hasPart:${lesson.id}->${id}`, type: "hasPart", start: lesson.id, end: id, properties: { orderInParent: position } });
      report.assessments.push({ lesson: lessonNumberOf(s.id), id, chars: body.length });
      report.charsMoved += body.length;
      // The teacher's objectivation section of this lesson covers the bilan too.
      const L = lessonNumberOf(s.id);
      const phase8 = sections.find((x) => rootOf(x.id) === teacherTlm.id && /^PHASE 8/.test(titleOf(x)) && lessonNumberOf(x.id) === L);
      if (phase8) { graph.relationships.push({ id: `covers:${phase8.id}->${id}`, type: "covers", start: phase8.id, end: id, properties: {} }); report.coversAdded++; }
      else report.skipped.push(`Leçon ${L}: no PHASE 8 section found to cover the new Assessment`);
    }
  }
  setGuide(s, kept.join("\n\n"));
  if (samples.length < 2 && (kind === "TU FAIS" || kind === "JE FAIS") && toActivity.length >= 2) samples.push({ section: titleOf(s), kind, before: paras.join("\n\n"), after: kept.join("\n\n"), activity: titleOf(activity), content: activity.properties.content, bilan: toBilan.join("\n\n") });
}

// ── teacher-side sourcing sentences → the curriculum node the section covers ──
const edits = [];
const rewrite = (node, getText, setText, pairs) => { let text = getText(node); for (const [from, to] of pairs) { if (!text.includes(from)) { edits.push({ where: titleOf(node), missing: from.slice(0, 70) }); continue; } text = text.split(from).join(to); edits.push({ where: titleOf(node), from: from.slice(0, 110), to: to.slice(0, 140) }); } setText(node, text); };
const phasesSpec = graph.nodes.find((n) => labelsOf(n).includes("FormatterSpec") && /^Les neuf phases/.test(titleOf(n)));
rewrite(phasesSpec, (n) => n.properties.content, (n, t) => { n.properties.content = t; }, [
  ["Elles se prennent dans le guide d'assemblage de la section « JE FAIS — situation d'amorce » de l'Outil de l'élève.", "Elles se prennent sur l'ACTIVITÉ D'AMORCE que couvre la section, dans le curriculum (son `content`) — la même activité que couvre la section « JE FAIS » de l'Outil de l'élève."],
  ["LA FICHE Y AJOUTE LA RÉPONSE, ET ELLE SEULE : [N] RÉPONSE : le signe X.", "LA FICHE Y AJOUTE LA RÉPONSE, ET ELLE SEULE : [N] RÉPONSE : le signe X. La réponse se lit sur l'ACTIVITÉ que couvre la section (rubrique RÉPONSE de son `content`), relue sur la bande finale."],
  ["Elle se prend dans le bloc « QUESTIONS DU BILAN — À GARDER RÉPONDABLES DEVANT CETTE IMAGE » du guide d'assemblage de la section JE FAIS de l'Outil de l'élève ; QUAND CE BLOC EN PORTE PLUSIEURS", "Elle se prend sur le BILAN DE LA LEÇON — le nœud Assessment que couvre cette section, dans le curriculum ; QUAND CE BILAN EN PORTE PLUSIEURS"],
]);
rewrite(teacherTlm, (n) => guideOf(n), (n, t) => setGuide(n, t), [
  ["Où les prendre : le guide d'assemblage de la section « JE FAIS — situation d'amorce ».", "Où les prendre : l'activité d'amorce que couvre la section, dans le curriculum (son `content`)."],
  ["Où la prendre : les guides des sections NOUS FAISONS, rubrique « RÉPONSE », relue sur la bande finale.", "Où la prendre : l'activité que couvre la section, rubrique « RÉPONSE » de son `content`, relue sur la bande finale."],
  ["Tout ce que le Guide récolte est DÉJÀ CONSERVÉ dans les guides d'assemblage de l'Outil de l'élève, section par section. ON L'Y PREND", "Tout ce que le Guide récolte est DÉJÀ CONSERVÉ dans le curriculum — sur l'activité ou le bilan que couvre chaque section (leur `content`) — et, pour ce qui tient à la page, dans les guides d'assemblage de l'Outil de l'élève. ON L'Y PREND"],
  ["Les guides d'assemblage de l'Outil de l'élève, eux, portent ces attributions et cet historique. ON Y PREND LE TEXTE, PAS SON COMMENTAIRE.", "Le curriculum et les guides d'assemblage de l'Outil de l'élève portent ces attributions ; l'historique est dans leurs journaux. ON Y PREND LE TEXTE, PAS SON COMMENTAIRE."],
]);
{ // the bilan pointer in the teacher guide names the block by its banner; replace the whole clause
  const t = guideOf(teacherTlm); const re = /Où la prendre : le bloc `•• QUESTIONS DU BILAN[^\n]*?••`[^.\n]*\./;
  if (re.test(t)) { setGuide(teacherTlm, t.replace(re, "Où la prendre : le bilan de la leçon, le nœud Assessment que couvre cette section dans le curriculum.")); edits.push({ where: titleOf(teacherTlm), from: "Où la prendre : le bloc `•• QUESTIONS DU BILAN … ••` …", to: "Où la prendre : le bilan de la leçon, le nœud Assessment que couvre cette section dans le curriculum." }); }
  else edits.push({ where: titleOf(teacherTlm), missing: "Où la prendre : le bloc `•• QUESTIONS DU BILAN" });
}
const PUPIL_GUIDE_NOTE = `- **The curriculum carries the words; a section carries the page.** An Activity's \`content\` holds its answer, its distractors and why they trap a pupil, and what it tests; the amorce Activity holds the oral questions; the lesson's \`Assessment\` holds the bilan questions. A section's assembly guide says only how the page shows them — layout, the picture marker, presentation. Both documents cover the same nodes, so the teacher's guide reads the curriculum, never the pupil book's sections.`;
if (!guideOf(pupilTlm).includes("The curriculum carries the words")) { const t = guideOf(pupilTlm); const at = t.indexOf("\n---\n\n## Section 1"); setGuide(pupilTlm, at >= 0 ? t.slice(0, at) + "\n" + PUPIL_GUIDE_NOTE + "\n" + t.slice(at) : t.trimEnd() + "\n\n" + PUPIL_GUIDE_NOTE + "\n"); edits.push({ where: titleOf(pupilTlm), from: "(new bullet under « Two conventions »)", to: PUPIL_GUIDE_NOTE.slice(0, 120) }); }

// ── report ───────────────────────────────────────────────────────────────────
console.log(JSON.stringify({ activitiesFilled: report.activitiesFilled.size, assessmentsCreated: report.assessments.length, coversEdgesAdded: report.coversAdded, charsMovedOffSections: report.charsMoved, skipped: report.skipped.length, textEdits: edits.filter((e) => !e.missing).length, textEditsNotFound: edits.filter((e) => e.missing).length }, null, 2));
for (const [kind, fams] of Object.entries(report.moved)) { console.log(`\n── MOVED off ${kind} sections (→ Activity.content unless said):`); for (const [k, v] of Object.entries(fams).sort((a, b) => b[1].chars - a[1].chars)) console.log(`   ${String(v.chars).padStart(7)} ${String(v.n).padStart(4)}¶  ${k}`); }
for (const [kind, fams] of Object.entries(report.stayed)) { console.log(`\n── STAYED on ${kind} sections:`); for (const [k, v] of Object.entries(fams).sort((a, b) => b[1].chars - a[1].chars).slice(0, 14)) console.log(`   ${String(v.chars).padStart(7)} ${String(v.n).padStart(4)}¶  ${k}`); }
console.log("\n── assessments:", report.assessments.map((a) => `L${a.lesson}:${a.chars}`).join(" "));
if (report.skipped.length) console.log("\n── skipped:\n  " + report.skipped.join("\n  "));
console.log("\n── text edits (teacher spec + guides):"); for (const e of edits) console.log(e.missing ? `  ✗ NOT FOUND in « ${e.where} »: ${e.missing}` : `  « ${e.where} »\n     − ${e.from}\n     + ${e.to}`);
for (const smp of samples) console.log(`\n===== SAMPLE ${smp.kind} « ${smp.section} »\n--- section guide AFTER (${smp.after.length} chars):\n${smp.after.slice(0, 700)}\n--- Activity « ${smp.activity} » content (${smp.content.length} chars):\n${smp.content.slice(0, 900)}${smp.bilan ? `\n--- Assessment content (${smp.bilan.length} chars):\n${smp.bilan.slice(0, 500)}` : ""}`);
if (outPath) { writeFileSync(resolve(outPath), JSON.stringify(graph, null, 2)); console.log(`\nmigrated graph written to ${outPath}`); } else console.log("\ndry run — pass --out <file> to write the migrated graph.");
