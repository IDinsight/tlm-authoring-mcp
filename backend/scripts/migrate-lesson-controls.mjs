#!/usr/bin/env node
/*
 * Take the per-fiche « CONTRÔLE … » blocks out of the assembly guides.
 *
 * Twenty-nine teacher fiche sections end with a numbered block of checks —
 * « CONTRÔLE DE LA FICHE », « CONTRÔLE PROPRE À CETTE LEÇON » — written
 * before the 27-point grid existed. Read one by one, the 74 points are of
 * three kinds, and none of them is a per-lesson rubric:
 *
 *   grille   — a restatement of a general rule (no A/B/C letters, the header,
 *              the durations, the last task at the ÉVALUATION…). The grid asks
 *              it on every fiche now, so the copy only drifts.
 *   leçon    — a fact about the lesson (« boucle » and nothing else, no number
 *              above 9, the vegetables of the warm-up). That is the lesson's
 *              words: it goes on the Lesson's `content`, where every read of
 *              the lesson sees it — unless the lesson already says it.
 *   décision — a dated measurement, an arbitration, a question awaiting the
 *              experts. That is history: the section's journal.
 *
 * Nothing is deleted: every point goes verbatim into the section's journal
 * with its kind, so the ✓ of the 2 September verification stay on record.
 * The rule of the earlier passes holds — the curriculum carries the words,
 * a section carries the page.
 *
 * Usage:
 *   node scripts/migrate-lesson-controls.mjs <graph.json> [--out migrated.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const graphPath = args.find((a) => !a.startsWith("--"));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!graphPath) { console.error("usage: migrate-lesson-controls.mjs <graph.json> [--out migrated.json]"); process.exit(1); }
const outPath = opt("--out");

const DATE = "13 septembre 2026";
const HEADER = /^=== (CONTRÔLE DE LA FICHE|CONTRÔLE PROPRE À CETTE LEÇON|CONTRÔLE PROPRE À LA LEÇON) ===$/m;
const LESSON_HEADING = "=== À RESPECTER DANS CETTE LEÇON — vu du contrôle de la fiche ===";

/*
 * The classification, point by point, in the order the points appear in each
 * block. `already` is how the lesson's content is asked whether it states the
 * fact already; a match means the point is recorded in the journal only.
 */
const G = { kind: "grille" }, D = { kind: "décision" };
const L = (already) => ({ kind: "leçon", already });
const PLAN = {
  // L1 — Former et représenter un ensemble
  "d62df984-6916-4d69-80c9-b18c70c84616": [L(/la lettre/), G, L(/boucle/i), G, G, D, D, D],
  // L2 — Former et représenter des sous-ensembles
  "34879ec3-8458-45d5-8e1b-34390a188ec2": [L(/boucle/i), G, G, G, L(/ardoise/i), D, G],
  // L3 — gauche/droite, devant/derrière
  "d9214531-148b-41f4-a121-e303495a6104": [L(/de face/i), D, G, G, D, D, D, G],
  // L4 — Estimer des longueurs
  "01a37d50-ddc0-4c17-a4bd-da99b6d706f3": [G, G, L(/ni chiffre ni forme/i), L(/un seul objet/i), G, D],
  // L5 — Rechercher des indices
  "5a40b131-66a5-4c69-aceb-f3fe9cf01acf": [L(/33 min/), L(/séance unique|une seule séance|SÉANCE 2/i), G, G, G, G, G, L(/PLATEAU/), D],
  // L7 — Classifier des ensembles
  "2167d831-2ef3-4e42-9afa-59341f3b74a8": [L(/Abdou/)],
  // L10 — Reconnaître l'intrus
  "82527801-099e-49f5-a895-572856af3d0f": [L(/une seule phrase/i)],
  // L15
  "672235b1-f30c-43b7-af31-26a122077998": [L(/sens \(a\)/)],
  // L16 — réunion
  "09b1a194-3cdb-42a8-91b9-8cd233c32a15": [L(/tomate/i), L(/cinq légumes/i), L(/phase 5/)],
  // L22
  "0c64070d-70f4-456d-acc1-2b9df9f8c53d": [G, L(/signe <|<, >/)],
  // L23
  "3d862698-5329-49c0-ae46-b566df99d4fb": [G, G, G, G, G],
  // L24, L25
  "1b893064-b65d-45c4-845c-690862061a57": [G],
  "1ccc74f0-d2f3-46c3-bb12-18354073aaee": [G],
  // L26 — cadre de dix
  "754fa418-89d2-4d31-ac78-dfde07c7c377": [L(/rangée du haut/i)],
  // L27 — aucun total supérieur à 7
  "47b15eaf-0876-46c0-838c-c43d192be5df": [L(/supérieur à 7|au-delà de 7/i)],
  // L29 — les lettres du texte source nomment les enfants
  "4d0a461c-9e9b-4e85-a44e-5ddd26a628db": [L(/texte source/i)],
  // L31, L32, L36 — aucun nombre au-delà de 9
  "e2937e75-9f4c-4499-a8fb-fcbc8278e95a": [L(/au-delà de 9|supérieur à 9/i)],
  "f84635ac-6b67-4a97-bd95-2eeacea0bd63": [L(/au-delà de 9|supérieur à 9/i)],
  "47371317-3104-4ba6-bc0d-41315dfc383d": [L(/au-delà de 9|supérieur à 9/i)],
  // L35 — « ardoise » partout où l'élève produit
  "a0543ce6-2720-41cb-8e49-035e7bf20cac": [L(/ardoise/i)],
  // L41 — onze
  "e4928be4-8cb2-4e2e-8492-77390ce66252": [L(/onze/i)],
  // L42 — aucune option n'est un signe d'opération
  "222f327c-415e-4537-849a-f757ed73421d": [L(/signe d.opération/i)],
  // L43 — aucun solide
  "7e421421-ed99-417e-b2a1-af323a142f16": [L(/solide/i)],
  // L45
  "92676569-7243-4877-adf6-550a67199427": [G, G, G, G, G],
  // L46
  "e007f3b0-b365-4a25-b00f-732d565631c9": [G],
  // L48 — les numéros des cartons sont des étiquettes
  "c69941fb-80f9-4c5e-8b10-961888e45993": [L(/étiquettes de l.image|pas des choix|numéros 1 à 4/i)],
  // L51
  "a16eb91f-5e8e-4857-a30a-2e981c961996": [G],
  // L52 — 20 ne paraît nulle part
  "d687074a-8633-4810-abbf-88f44dc83df3": [L(/20 ne paraît|jamais 20|sans 20|pas 20/i)],
  // L57 — vingt en deux paquets de dix ; rien au-delà
  "d1e6b51b-635d-48d5-a7f8-a4e339ed23fe": [L(/deux paquets de dix/i), L(/au-delà de vingt|supérieur à vingt|plus de vingt/i)],
};

const graph = JSON.parse(readFileSync(resolve(graphPath), "utf8"));
const byId = new Map(graph.nodes.map((n) => [n.id, n]));
const labelsOf = (n) => n?.labels ?? [];
const titleOf = (n) => String(n?.properties?.description ?? "").split("\n")[0].trim();
const guideOf = (n) => String(n?.properties?.metadata?.assemblyGuide ?? "");
const lessonOf = (sectionId) => graph.relationships
  .filter((e) => e.type === "covers" && e.start === sectionId)
  .map((e) => byId.get(e.end))
  .find((n) => labelsOf(n).includes("Lesson"));

// The block is the guide's last heading in all twenty-nine sections; the
// script checks that rather than assuming it.
function splitBlock(guide) {
  const at = guide.search(HEADER);
  if (at < 0) return null;
  const block = guide.slice(at);
  if (/\n=== /.test(block.slice(1))) throw new Error("a control block is not the last block of its guide");
  const lines = block.split("\n");
  const points = lines.slice(1).join("\n").split(/\n(?=\s*\d+\.\s)/).map((p) => p.trim()).filter(Boolean);
  return { before: guide.slice(0, at).trimEnd(), heading: lines[0], points };
}

const stripNumber = (p) => p.replace(/^\d+\.\s*/, "");
const stripTick = (p) => p.replace(/\s*✓\s*/g, " ").replace(/\s+—\s*$/, "").trim();

const report = [];
let totals = { sections: 0, points: 0, grille: 0, leçon: 0, leçonCopied: 0, leçonAlready: 0, décision: 0, charsToLessons: 0, charsOutOfGuides: 0 };

for (const section of graph.nodes) {
  if (!labelsOf(section).includes("DocumentSection")) continue;
  const split = splitBlock(guideOf(section));
  if (!split) continue;
  const plan = PLAN[section.id];
  if (!plan) throw new Error(`unclassified control block in « ${titleOf(section)} » (${section.id})`);
  if (plan.length !== split.points.length) throw new Error(`« ${titleOf(section)} »: ${split.points.length} points, ${plan.length} classified`);
  const lesson = lessonOf(section.id);
  if (!lesson) throw new Error(`« ${titleOf(section)} » covers no Lesson`);

  const lessonContent = String(lesson.properties.content ?? "");
  const toLesson = [];
  const journalLines = [];
  const row = { section: titleOf(section), lesson: titleOf(lesson), grille: 0, leçon: 0, already: 0, décision: 0, copied: [] };

  split.points.forEach((point, i) => {
    const { kind, already } = plan[i];
    const text = stripNumber(point);
    row[kind]++; totals[kind]++;
    let tag = kind;
    if (kind === "leçon") {
      if (already.test(lessonContent)) { row.already++; totals.leçonAlready++; tag = "leçon · déjà portée par la leçon"; }
      else { toLesson.push(stripTick(text)); row.copied.push(stripTick(text).slice(0, 70)); totals.leçonCopied++; tag = "leçon · copiée sur la leçon"; }
    }
    journalLines.push(`[${tag}] ${text}`);
  });

  // The guide loses the block and nothing else.
  totals.charsOutOfGuides += guideOf(section).length - split.before.length;
  section.properties.metadata = { ...section.properties.metadata, assemblyGuide: split.before };

  // The journal keeps every point, with what became of it.
  const intro = `=== ${split.heading.replace(/^=== | ===$/g, "")} — SORTI DU GUIDE D'ASSEMBLAGE LE ${DATE.toUpperCase()} ===\n` +
    `Ces points fermaient le guide d'assemblage. Les ✓ datent de la vérification du 2 septembre 2026 sur le rendu. ` +
    `[grille] : la grille de 27 points le demande désormais sur chaque fiche. [leçon] : c'est un fait de la leçon, porté par la leçon elle-même. [décision] : arbitrage ou question en attente, à suivre ici.`;
  const existing = typeof section.properties.metadata.journal === "string" && section.properties.metadata.journal.trim()
    ? section.properties.metadata.journal.trimEnd() + "\n\n"
    : `# Journal — ${titleOf(section)}\n\n`;
  section.properties.metadata.journal = existing + intro + "\n" + journalLines.join("\n") + "\n";

  // The lesson gains the facts it did not state yet.
  if (toLesson.length) {
    const body = toLesson.map((p, i) => `${i + 1}. ${p}`).join("\n");
    lesson.properties.content = lessonContent.trimEnd() + "\n\n" + LESSON_HEADING + "\n" + body;
    totals.charsToLessons += body.length;
  }
  totals.sections++; totals.points += split.points.length;
  report.push(row);
}

report.sort((a, b) => Number(a.section.match(/Leçon (\d+)/)[1]) - Number(b.section.match(/Leçon (\d+)/)[1]));
console.log(JSON.stringify(totals, null, 2));
console.log("\nsection                  grille  leçon(copiée/déjà)  décision");
for (const r of report) {
  const n = r.section.match(/Leçon \d+/)[0];
  console.log(`${n.padEnd(24)} ${String(r.grille).padStart(6)}  ${String(r.leçon).padStart(5)} (${r.leçon - r.already}/${r.already})          ${String(r.décision).padStart(5)}`);
  for (const c of r.copied) console.log(`      → sur la leçon : ${c}…`);
}

if (outPath) {
  writeFileSync(resolve(outPath), JSON.stringify(graph, null, 2));
  console.log(`\nmigrated graph written to ${outPath}`);
}
