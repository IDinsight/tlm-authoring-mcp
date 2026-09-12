#!/usr/bin/env node
/*
 * Move a section's dated history out of its assembly guide and into its own
 * decision journal (`metadata.journal`) — the field a document already keeps
 * for the history of its formatter rules, and that no generation read sends.
 *
 * Measured on ci/maths (2026-09-12), a third of every section guide was
 * provenance: where a question came from in the expert's file (ORIGINE), what
 * was kept or changed against that file, what a review pass left to validate,
 * and the « •• REPRISE APRÈS LE RETOUR DE STÉPHANE •• » blocks that date a
 * rewrite. All of it answers "why is this page so" — for a person — and none of
 * it is needed to compose the page. It rode every section read anyway.
 *
 * The boundary is the PARAGRAPH (blank-line separated) and the paragraph's
 * first words: a paragraph moves when it opens with a history heading, and
 * stays otherwise. Measured before writing this, a history paragraph is never
 * followed by an unheaded continuation (710 checked: each is either last in
 * its guide or followed by a new heading), so nothing needs to be carried
 * along with it. A « •• … •• » banner moves only when its title says history
 * (a return, a receipt, a re-read, a decision to confirm, what was discarded);
 * « •• RÈGLE LA PLUS IMPORTANTE DE CETTE LEÇON •• » and the illustration
 * briefs of the experts are the page's own rules and stay.
 *
 * Kept paragraphs keep their order and text; the journal keeps the moved
 * paragraphs in their order under a heading naming the section. A section
 * whose guide would be left empty is NOT touched — it is listed instead.
 *
 * Usage:
 *   node scripts/migrate-section-journal.mjs <graph.json> [--out migrated.json] [--samples N]
 *
 * <graph.json> is an export-kg envelope; the public /kg export will not do, it
 * strips assembly guides. Without --out this is a dry run: the report only.
 * With --out, the migrated graph is written, to import with
 *   node scripts/import-kg.mjs senegal ci maths <out> --replace-published
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const graphPath = args.find((a) => !a.startsWith("--"));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!graphPath) {
  console.error("usage: migrate-section-journal.mjs <graph.json> [--out migrated.json] [--samples N]");
  process.exit(1);
}
const outPath = opt("--out");
const sampleCount = Number(opt("--samples") ?? 12);

// A paragraph that opens with one of these is history.
const HISTORY_HEADINGS = [
  /^ORIGINE\b/,
  /^À VALIDER\b/,
  /^CE QUI A CHANGÉ PAR RAPPORT/,
  /^CE QUI CHANGE PAR RAPPORT/,
  /^ERREURS? MATÉRIELLES?\b/,
  /^PASS \d/,
];

// A « •• TITLE •• » banner is history when its title says so.
// (`\b` is ASCII-only in JavaScript, so a boundary after an accented letter is
// spelled out as "not followed by a letter".)
const HISTORY_BANNERS = [
  /APRÈS LE RETOUR/,                    // reprise / refaite / revue / vérifiée / conservée après le retour de …
  /CE QUE LE RETOUR DE .* CHANGE/,
  /REÇUE LE/,                           // version finale des experts — reçue le …
  /SOURCE RELUE/,
  /HISTORIQUE/,
  /CE QUE CETTE PLACE PORTAIT/,
  /À (LUI |LEUR )?(FAIRE )?CONFIRMER/,  // ce qui reste à faire confirmer ; décision à confirmer
  /À (LUI |LEUR )?SIGNALER/u,           // réserves, défauts de leur fichier, points ouverts — for the expert
  /À LUI SOUMETTRE/,
  /À DEMANDER À/,
  /POINTS? OUVERTS?(?!\p{L})/u,
  /EST GARDÉE/,                         // pourquoi cette tâche est gardée (the reviewer's letter, dated)
  /A DE BON/,                           // ce que sa leçon a de bon, et qui est repris
  /ÉCARTÉE?(?!\p{L})/u,                 // ce qui a été écarté … et pourquoi
  /CE QUI A CHANGÉ PAR RAPPORT/,
  /CE QUI DIFFÈRE DE SON FICHIER/,
  /CE QUI N'EST PAS REPRODUIT/,
  /CE QU'ILS ONT CHANGÉ/,
  /CHANGE DE NOTION/,
  /UN POINT A ÉTÉ CHANGÉ/,
  /REPROCHÉ À TORT/,
  /EST CLOS(?!\p{L})/u,
  /RESTAURÉE?(?!\p{L})/u,               // amorce restaurée ; substitution annulée, original restauré
  /LA RÉSERVE .* EST LEVÉE/,
  /FICHIER FINAL|FIDÉLITÉ AU FICHIER|DOCUMENT REÇU/,
];

const bannerTitle = (paragraph) => paragraph.match(/^••\s*([^•]+?)\s*••/)?.[1] ?? null;

function isHistory(paragraph) {
  if (HISTORY_HEADINGS.some((re) => re.test(paragraph))) return true;
  const title = bannerTitle(paragraph);
  return title !== null && HISTORY_BANNERS.some((re) => re.test(title));
}

// The label under which the report counts a moved paragraph: its heading, with
// numbers and dates normalized so « PASS 2 » and « PASS 3 » are one line.
function headingOf(paragraph) {
  const title = bannerTitle(paragraph);
  const head = title ?? paragraph.split("\n")[0].replace(/\s*[:—–].*$/, "");
  return (title ? "•• " : "") + head.replace(/\d+/g, "N").replace(/\(.*?\)/g, "").trim().slice(0, 64);
}

const graph = JSON.parse(readFileSync(resolve(graphPath), "utf8"));
const titleOf = (n) => String(n?.properties?.description ?? "").split("\n")[0].trim();

const moved = {};        // heading → { paragraphs, chars }
const keptBanners = {};  // banner title → count (so a reader can check nothing history-like stayed)
const samples = [];
const emptied = [];
let sections = 0, touched = 0, charsBefore = 0, charsMoved = 0, alreadyJournaled = 0;

for (const node of graph.nodes) {
  if (!(node.labels ?? []).includes("DocumentSection")) continue;
  const metadata = node.properties?.metadata;
  const guide = metadata?.assemblyGuide;
  if (typeof guide !== "string" || guide === "") continue;
  sections++;
  charsBefore += guide.length;
  if (typeof metadata.journal === "string" && metadata.journal !== "") alreadyJournaled++;

  const paragraphs = guide.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p !== "");
  const history = paragraphs.filter(isHistory);
  if (history.length === 0) {
    for (const p of paragraphs) { const t = bannerTitle(p); if (t) keptBanners[t] = (keptBanners[t] ?? 0) + 1; }
    continue;
  }
  const kept = paragraphs.filter((p) => !isHistory(p));
  for (const p of kept) { const t = bannerTitle(p); if (t) keptBanners[t] = (keptBanners[t] ?? 0) + 1; }
  for (const p of history) {
    const key = headingOf(p);
    moved[key] = moved[key] ?? { paragraphs: 0, chars: 0 };
    moved[key].paragraphs++;
    moved[key].chars += p.length;
    charsMoved += p.length;
    if (samples.length < sampleCount) samples.push(`[${titleOf(node)}] ${p.slice(0, 140).replace(/\n/g, " ⏎ ")}`);
  }

  if (kept.length === 0) { emptied.push(titleOf(node)); continue; }
  touched++;

  const heading = `# Journal — ${titleOf(node)}`;
  const entries = history.join("\n\n");
  const existing = typeof metadata.journal === "string" && metadata.journal !== "" ? metadata.journal.trimEnd() + "\n\n" : "";
  node.properties.metadata = {
    ...metadata,
    assemblyGuide: kept.join("\n\n"),
    journal: existing + heading + "\n\n" + entries,
  };
}

const pct = (a, b) => (b === 0 ? "0" : (100 * a / b).toFixed(1));
console.log(JSON.stringify({
  sectionsWithGuide: sections,
  sectionsTouched: touched,
  sectionsAlreadyJournaled: alreadyJournaled,
  guideCharsBefore: charsBefore,
  charsMovedToJournal: charsMoved,
  movedPct: pct(charsMoved, charsBefore),
  leftEmptyAndSkipped: emptied.length,
}, null, 2));

console.log("\nmoved, by heading:");
for (const [key, v] of Object.entries(moved).sort((a, b) => b[1].chars - a[1].chars)) {
  console.log(`  ${String(v.chars).padStart(7)} chars  ${String(v.paragraphs).padStart(4)} ¶  ${key}`);
}
console.log("\n« •• » banners KEPT in the guides (check none is history):");
for (const [key, v] of Object.entries(keptBanners).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${key.slice(0, 90)}`);
}
if (emptied.length) console.log("\nsections whose guide is history only — left untouched:\n  - " + emptied.join("\n  - "));
console.log("\nsamples of moved paragraphs:\n  - " + samples.join("\n  - "));

if (outPath) {
  writeFileSync(resolve(outPath), JSON.stringify(graph, null, 2));
  console.log(`\nmigrated graph written to ${outPath}`);
} else {
  console.log("\ndry run — pass --out <file> to write the migrated graph.");
}
