#!/usr/bin/env node
/*
 * Take the document-wide rules out of the section guides that repeat them.
 *
 * Measured on ci/maths after the journal migration, 79 distinct lines appear
 * verbatim in eight or more sections. Read one by one against the formatter
 * specs of the two documents, they are three different things:
 *
 *   • POINTERS — « PHASE 4 — NOUS FAISONS. Bandeau, durée et cadrage : mise en
 *     forme « … » » (460 lines). The formatter travels with every section read,
 *     and its own spec « Ce qui est gabarit » says this opening sentence is
 *     template, written once there. Deleted.
 *   • RULES THE SPEC ALREADY STATES — « PRÉSENTATION : pictogramme TU FAIS en
 *     marge, UNE SEULE FOIS », « NUMÉROTATION : TRIANGLE (= 2), en début de
 *     ligne », « SECTION JE RETIENS — ferme la page 1 »… Each is a sentence of
 *     « Structure d'une leçon » or « Les neuf phases » copied onto every page
 *     of that kind. The page's own instance is in its title (the ▲ that says
 *     which question this is — checked: every NUMÉROTATION line's symbol is in
 *     its section's title). Deleted, the covering spec named in the report.
 *   • RULES NO SPEC STATES YET — two of them. Hoisted into the spec that owns
 *     them, once, then the copies are deleted.
 *
 * What stays, on purpose: DISPOSITION lines (a per-page choice among four
 * layouts, not a rule), the « [N] … » lines (they are the fiche's printed
 * text — it repeats because the fiche repeats), the « •• … •• » and
 * « === … === » headings (content follows them), and any repeated line whose
 * rule was not found in a spec (listed in the report for a person to decide).
 *
 * Only a line repeated VERBATIM in `--min` sections (default 5) is a candidate,
 * and it is deleted only where it matches a family below — a page-specific
 * variant (« LA DERNIÈRE PHRASE reprend l'objectif — « Former des
 * sous-ensembles »… ») is never touched, since it is not verbatim.
 *
 * Usage:
 *   node scripts/migrate-repeated-rules.mjs <graph.json> [--out migrated.json] [--min 5]
 * <graph.json> is an export-kg envelope (the /kg export strips guides).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const graphPath = args.find((a) => !a.startsWith("--"));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!graphPath) { console.error("usage: migrate-repeated-rules.mjs <graph.json> [--out migrated.json] [--min 5]"); process.exit(1); }
const outPath = opt("--out");
const minSections = Number(opt("--min") ?? 5);

// Each family: how a repeated line is recognised, what happens to it, and where
// the rule lives once the copies are gone.
const FAMILIES = [
  // — teacher's guide —
  { id: "phase-pointer", action: "delete", statedIn: "Ce qui est gabarit, ce qui est de la leçon",
    test: (l) => /Bandeau, durée et cadrage : mise en forme «/.test(l) },
  { id: "scene-right", action: "delete", statedIn: "Les neuf phases — phase 2 (« quand ce n'est pas à droite »)",
    test: (l) => /^L'image de la scène se place À DROITE du bloc de questions\.$/.test(l) },
  { id: "questions-verbatim", action: "delete", statedIn: "Les neuf phases — phase 2",
    test: (l) => /^LES (TROIS|QUATRE|CINQ) QUESTIONS SONT CELLES DE LA LEÇON, mot pour mot/.test(l) },
  { id: "point-le-signe", action: "delete", statedIn: "Les neuf phases — phase 4",
    test: (l) => /^LE POINT À NE PAS RATER : les trois directives disent LE SIGNE/.test(l) },
  { id: "not-reprinted", action: "delete", statedIn: "Les images de la fiche (« qu'à sa première apparition »)",
    test: (l) => /^L'IMAGE (DE LA NOTION|D'AMORCE) N'EST PAS RÉIMPRIMÉE/.test(l) },
  { id: "last-sentence", action: "hoist", spec: /^Les neuf phases/,
    anchor: /^\[N\] Réponse attendue : ⟨ce que la leçon a appris/,
    text: "LA DERNIÈRE PHRASE reprend l'objectif de la leçon. Elle ne l'explique pas : elle l'annonce.",
    test: (l) => /^LA DERNIÈRE PHRASE reprend l'objectif de la leçon\. Elle ne l'explique pas : elle l'annonce\.$/.test(l) },
  { id: "phase4-clear-directives", action: "hoist", spec: /^Le répertoire des phrases-types/,
    anchor: /^PT-09 · phases 7 et 9/,
    text: "⚠ EN PHASE 4, LES ACTIVITÉS QUI SUIVENT LA PREMIÈRE N'APPELLENT AUCUNE PHRASE-TYPE : PT-04 ne s'appelle qu'à la première activité, et PT-09 n'est prévue qu'aux phases 7 et 9. Leurs directives s'écrivent donc en clair, et ce n'est pas un appel oublié.",
    test: (l) => /^NOTE DE SPÉCIFICATION — POURQUOI DEUX DIRECTIVES RESTENT EN CLAIR ICI/.test(l) },
  // — pupil's book —
  { id: "section-opener", action: "delete", statedIn: "Structure d'une leçon — Outil de l'élève V2 (kinds, order, pages, pictogram once)",
    test: (l) => /^SECTION (JE FAIS|NOUS FAISONS|JE RETIENS|TU FAIS) — /.test(l) },
  { id: "numbering", action: "delete", statedIn: "Structure d'une leçon + Repères de numérotation (shape = rank, restarts per section; the section title carries the shape)",
    // Integration lessons (« … dans cette situation ») have no student-book spec verified yet: left alone.
    test: (l) => /^NUMÉROTATION : ((ÉTOILE|TRIANGLE|CARRÉ|CERCLE) \(= \d\)|aucune — la section ne comporte pas de question)/.test(l) && !/situation/i.test(l) },
  { id: "presentation", action: "delete", statedIn: "Structure d'une leçon — Outil de l'élève V2 (one paragraph per section kind)",
    test: (l) => /^PRÉSENTATION : (pictogramme (JE FAIS|NOUS FAISONS|JE RETIENS|TU FAIS) en marge|pas de pictogramme\. Directive, puis image\.$)/.test(l) },
  { id: "page-break", action: "delete", statedIn: "Structure d'une leçon (« La page 1 se termine sur cette section »)",
    test: (l) => /^LA RUPTURE DE PAGE TOMBE JUSTE APRÈS CETTE SECTION\.$/.test(l) },
  // — kept on purpose —
  { id: "disposition", action: "keep", why: "a per-page choice among four layouts",
    test: (l) => /^DISPOSITION : /.test(l) },
  { id: "printed-line", action: "keep", why: "the fiche's own printed text",
    test: (l) => /^\[(N|FR!?|WO)\]/.test(l) },
  { id: "heading", action: "keep", why: "a heading; page-specific content follows",
    test: (l) => /^(••|===|CONSIGNES DE L'ÉLÈVE)/.test(l) },
  { id: "two-bilan-questions", action: "keep", why: "says TWO bilan questions where the spec says one — a contradiction for a person, not a copy",
    test: (l) => /^LES DEUX QUESTIONS SONT LES QUESTIONS DE BILAN/.test(l) },
];

const graph = JSON.parse(readFileSync(resolve(graphPath), "utf8"));
const titleOf = (n) => String(n?.properties?.description ?? "").split("\n")[0].trim();
const sections = graph.nodes.filter((n) => (n.labels ?? []).includes("DocumentSection") && typeof n.properties?.metadata?.assemblyGuide === "string");

// 1. Candidates: lines repeated verbatim across enough sections.
const occurrences = new Map();
for (const s of sections) {
  const seen = new Set();
  for (const raw of s.properties.metadata.assemblyGuide.split("\n")) {
    const line = raw.trim();
    if (line.length < 30 || seen.has(line)) continue;
    seen.add(line);
    occurrences.set(line, (occurrences.get(line) ?? 0) + 1);
  }
}
const candidates = new Map([...occurrences].filter(([, n]) => n >= minSections));
const familyOf = (line) => FAMILIES.find((f) => f.test(line)) ?? null;

// 2. Rewrite the guides.
const stats = Object.fromEntries(FAMILIES.map((f) => [f.id, { lines: 0, sections: new Set(), chars: 0, distinct: new Set() }]));
const unmatched = new Map();
const samples = [];
let charsBefore = 0, charsAfter = 0, touched = 0, emptied = 0;
for (const s of sections) {
  const before = s.properties.metadata.assemblyGuide;
  charsBefore += before.length;
  const kept = [];
  const removedHere = new Set();
  for (const raw of before.split("\n")) {
    const line = raw.trim();
    const family = candidates.has(line) ? familyOf(line) : null;
    if (candidates.has(line) && !family) unmatched.set(line, candidates.get(line));
    if (family && family.action !== "keep") {
      const st = stats[family.id]; st.lines++; st.chars += raw.length + 1; st.sections.add(s.id); st.distinct.add(line);
      removedHere.add(family.id);
      continue;
    }
    if (family) { const st = stats[family.id]; st.lines++; st.sections.add(s.id); st.distinct.add(line); }
    kept.push(raw);
  }
  const after = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  charsAfter += after.length;
  if (after === before.trim() && removedHere.size === 0) continue;
  touched++;
  if (after === "") emptied++;
  s.properties.metadata = { ...s.properties.metadata, assemblyGuide: after };
  if (samples.length < 2 && removedHere.size >= 2) samples.push({ title: titleOf(s), before, after });
}

// 3. Hoist the two rules no spec states, once each, after their anchor line.
const hoisted = [];
for (const f of FAMILIES.filter((f) => f.action === "hoist")) {
  const spec = graph.nodes.find((n) => (n.labels ?? []).includes("FormatterSpec") && f.spec.test(titleOf(n)));
  if (!spec) { console.error(`hoist ${f.id}: no FormatterSpec matches ${f.spec}`); process.exit(1); }
  const lines = String(spec.properties.content ?? "").split("\n");
  if (lines.includes(f.text)) { hoisted.push({ id: f.id, spec: titleOf(spec), already: true }); continue; }
  const at = lines.findIndex((l) => f.anchor.test(l));
  if (at < 0) { console.error(`hoist ${f.id}: anchor ${f.anchor} not found in « ${titleOf(spec)} »`); process.exit(1); }
  lines.splice(at + 1, 0, f.text);
  spec.properties.content = lines.join("\n");
  hoisted.push({ id: f.id, spec: titleOf(spec), after: lines[at].slice(0, 80), text: f.text });
}

// 4. Report.
console.log(JSON.stringify({ sectionsWithGuide: sections.length, sectionsTouched: touched, guidesLeftEmpty: emptied, guideCharsBefore: charsBefore, guideCharsAfter: charsAfter, removedPct: (100 * (charsBefore - charsAfter) / charsBefore).toFixed(1), candidateLines: candidates.size }, null, 2));
console.log("\nDELETED — the rule lives in the named spec:");
for (const f of FAMILIES.filter((f) => f.action === "delete")) { const st = stats[f.id]; console.log(`  ${String(st.lines).padStart(4)} lines  ${String(st.sections.size).padStart(4)} sections  ${String(st.chars).padStart(6)} chars  ${st.distinct.size} distinct  ${f.id}\n        → ${f.statedIn}`); }
console.log("\nHOISTED, then the copies deleted:");
for (const h of hoisted) { const st = stats[h.id]; console.log(`  ${String(st.lines).padStart(4)} lines  ${String(st.sections.size).padStart(4)} sections  ${h.id} → « ${h.spec} »${h.already ? " (already there)" : `, inserted after « ${h.after}… »:\n        ${h.text}`}`); }
console.log("\nKEPT on purpose:");
for (const f of FAMILIES.filter((f) => f.action === "keep")) { const st = stats[f.id]; console.log(`  ${String(st.lines).padStart(4)} lines  ${String(st.distinct.size).padStart(3)} distinct  ${f.id} — ${f.why}`); }
console.log(`\nREPEATED (≥${minSections} sections) BUT IN NO FAMILY — left as is, for a person to decide:`);
for (const [line, n] of [...unmatched].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}×  ${line.slice(0, 150)}`);
for (const smp of samples) console.log(`\n===== SAMPLE « ${smp.title} »\n--- before:\n${smp.before.slice(0, 900)}\n--- after:\n${smp.after.slice(0, 900)}`);

if (outPath) { writeFileSync(resolve(outPath), JSON.stringify(graph, null, 2)); console.log(`\nmigrated graph written to ${outPath}`); }
else console.log("\ndry run — pass --out <file> to write the migrated graph.");
