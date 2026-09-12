#!/usr/bin/env node
/*
 * Two rules the produced corpus settles, written once into the specs, and the
 * section lines that restated (or contradicted) them taken out.
 *
 * 1. THE BILAN QUESTION. The teacher's guide prints ONE bilan question at the
 *    objectivation (phase 8): the spec says so, the document's journal dates
 *    the decision (Karimou, on ARED's review of fiches 12–15), and the produced
 *    fiches confirm it — Leçons 21 to 30 print one; 11 to 20, produced before
 *    the decision, printed two. Twenty-five phase-8 section guides still open
 *    with « LES DEUX / TROIS QUESTIONS SONT LES QUESTIONS DE BILAN… » — the
 *    pre-decision wording, which the producer of 21–30 rightly ignored. That
 *    sentence pair goes; whatever page-specific remark follows it stays. The
 *    spec's « quand ce bloc en porte DEUX » becomes « PLUSIEURS »: the JE FAIS
 *    blocks list up to five.
 *
 * 2. THE INTEGRATION LESSON, PUPIL SIDE. Eight lessons (17, 18, 28, 34, 40,
 *    49, 54, 58) have no JE FAIS / NOUS FAISONS / JE RETIENS / TU FAIS. The
 *    teacher's formatter has a spec for them; the pupil's book had none, so
 *    every one of the eight lesson guides carried the same « •• FORMAT D'UNE
 *    LEÇON D'INTÉGRATION •• » block, and their situation sections the same
 *    openers, PRÉSENTATION and NUMÉROTATION lines. The rules are derived from
 *    those eight blocks, the eight section spines, the two produced pupil
 *    pages (17, 18) and the experts' final files, and written as one new
 *    FormatterSpec under the pupil's structure formatter. The generic lines
 *    then go; every page-specific sentence stays (a strict full-line match —
 *    a line with a tail is never touched).
 *
 * Usage:
 *   node scripts/migrate-integration-and-bilan.mjs <graph.json> [--out migrated.json]
 * <graph.json> is an export-kg envelope (the /kg export strips guides).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const graphPath = args.find((a) => !a.startsWith("--"));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!graphPath) { console.error("usage: migrate-integration-and-bilan.mjs <graph.json> [--out migrated.json]"); process.exit(1); }
const outPath = opt("--out");

const INTEGRATION_LESSONS = [17, 18, 28, 34, 40, 49, 54, 58];
const STRUCTURE_FORMATTER = /^CI maths V2 — structure d'une leçon de l'Outil de l'élève$/;
const STRUCTURE_SPEC = /^Structure d'une leçon — Outil de l'élève V2$/;
const PHASES_SPEC = /^Les neuf phases — tableau et cadrage fixe/;
const NEW_SPEC_TITLE = "Structure d'une leçon d'intégration — Outil de l'élève V2";

const NEW_SPEC_CONTENT = `Structure d'une leçon d'intégration de l'Outil de l'élève (Planification V2). Huit leçons du manuel sont des leçons d'intégration — 17, 18, 28, 34, 40, 49, 54 et 58. Une leçon d'intégration n'enseigne rien de neuf : elle fait mobiliser, dans des situations numérotées, ce que les leçons précédentes ont installé. Elle n'a PAS les quatre sections d'une leçon ordinaire — ni JE FAIS, ni NOUS FAISONS, ni JE RETIENS, ni TU FAIS — et donc AUCUN PICTOGRAMME DE SECTION. Ce que la fiche du maître en fait — résolution guidée, correction, tableau de compilation — est dans la mise en forme du Guide, spécification « Les leçons d'intégration ».

EN-TÊTE (page 1) : la même ligne unique que pour une leçon ordinaire — « Unité N · Leçon N · INTÉGRATION … », le titre en capitales. Quand la leçon remobilise une liste de notions, une seconde ligne peut les nommer (Leçon 18 : « Droite/gauche, Devant/derrière, … »).

DEUX SITUATIONS, UNE PAR PAGE. La Situation n° 1 occupe la page 1, la Situation n° 2 la page 2 : LA RUPTURE DE PAGE TOMBE ENTRE LES DEUX SITUATIONS, jamais ailleurs. Chaque situation porte QUATRE QUESTIONS AU PLUS.

UNE SITUATION S'OUVRE PAR SON TITRE, SON CONTEXTE ET SON IMAGE. Le titre « Situation n° N — … » en Andika Bold 12 pt ; puis un encadré portant le CONTEXTE — une ou deux phrases, celles de l'expert, mot pour mot ; le maître le lit à voix haute, l'élève ne le lit pas — et l'image de la scène, ~16:9, placée À CÔTÉ de l'encadré. Ni forme géométrique ni pictogramme sur le contexte.

L'IMAGE DE LA SITUATION EST LA RÉFÉRENCE COMMUNE DE SES QUESTIONS. Elle est en tête de la situation, SUR LA MÊME PAGE que ses questions ; les bandes de questions n'ont donc PAS de cadre de référence — elles ne portent que leurs trois vignettes d'option. La règle d'or tient : tout ce qu'il faut pour répondre est sous les yeux de l'élève, sur la même page. Si une page doit être resserrée, on réduit d'abord le texte du contexte, jamais cette image.

LES QUESTIONS ONT LA FORME DES QUESTIONS DU TU FAIS : une DIRECTIVE (une phrase), puis sa bande d'options ~3:1 en pleine largeur, SOUS la directive. La numérotation par formes (étoile = 1, triangle = 2, carré = 3, cercle = 4) REDÉMARRE À CHAQUE SITUATION et s'y arrête à quatre. Les lettres A / B / C de la source deviennent les signes X / O / – ; l'élève écrit le signe sur son ardoise.

PLUSIEURS SIGNES SONT ADMIS DANS UNE LEÇON D'INTÉGRATION, ET LÀ SEULEMENT (décision de Karimou Ba du 30 août 2026). Une question peut avoir deux bonnes réponses ; sa directive le dit alors AU PLURIEL — « Écris LES SIGNES… » — sans quoi l'élève s'arrête au premier signe trouvé. Partout ailleurs dans le manuel, une question n'admet qu'un seul signe.

UNE SITUATION PEUT PORTER UNE TÂCHE DE PRODUCTION — reproduire, tracer, continuer une frise — à la place d'une question à choix : une seule image, sans option ni signe, et une consigne qui dit le geste, une ligne par geste. Elle prend sa forme dans la numérotation comme une question.`;

const STRUCTURE_POINTER = "Huit leçons — 17, 18, 28, 34, 40, 49, 54 et 58 — sont des leçons d'intégration et ne suivent pas cette structure : voir « Structure d'une leçon d'intégration — Outil de l'élève V2 ».";
const TLM_GUIDE_POINTER = `## Integration lessons

Eight lessons — 17, 18, 28, 34, 40, 49, 54 and 58 — are integration lessons: nothing new is taught, and the page has none of the four sections above. It is two numbered **situations**, one per page, each with its context, its scene and up to four questions; the form is in the formatter spec « Structure d'une leçon d'intégration — Outil de l'élève V2 », and each lesson's own guide says what its situations remobilise.`;

// ── 1. the bilan sentence pair, and nothing after it ─────────────────────────
const STALE_BILAN = /^LES (?:DEUX|TROIS) QUESTIONS SONT LES QUESTIONS DE BILAN DE LA LEÇON[^\n.]*\. Elles se prennent dans le bloc « QUESTIONS DU BILAN — À GARDER RÉPONDABLES DEVANT CETTE IMAGE » du guide d'assemblage de la section JE FAIS de l'Outil de l'élève(?:, avec leur consigne d'ouverture|,? qui les recopie de la source)?\.\s*/;

// ── 2. the generic lines of the eight integration lessons ────────────────────
// Lesson-level « •• FORMAT D'UNE LEÇON D'INTÉGRATION •• » block: a line goes
// only when the WHOLE line is the rule; a line with a page-specific tail stays.
const FORMAT_BANNER = /^•• FORMAT D'UNE LEÇON D'INTÉGRATION ••$/;
const FORMAT_RULE_LINES = [
  /^Une leçon d'intégration n'a PAS les quatre sections d'une leçon ordinaire\..*AUCUN PICTOGRAMME DE SECTION(?: en marge)?\.$/,
  /^LA NUMÉROTATION PAR FORMES, ELLE, EST BIEN PRÉSENTE : .*REDÉMARRE à chaque situation\.$/,
  /^DEUX SITUATIONS, QUATRE QUESTIONS AU PLUS PAR SITUATION\..*(ENTRE LES DEUX(?: SITUATIONS)?|page 2)\.$/,
  /^L'IMAGE DE LA SITUATION EST LA RÉFÉRENCE COMMUNE DE SES QUESTIONS.*(même page|de référence)\.$/,
  /^LES LETTRES A \/ B \/ C (?:DE SES CONSIGNES )?DEVIENNENT LES SIGNES X \/ O \/ –(?:, composés sur l'image)?\.$/,
];
// The « plusieurs signes » line mixes the rule with the lesson's own case: the
// rule sentence (with its dated decision) goes, the case stays.
const PLURAL_SIGNS_RULE = /^PLUSIEURS SIGNES SONT ADMIS DANS UNE LEÇON D'INTÉGRATION, ET LÀ SEULEMENT(?:\s*\(décision de Karimou du 30 août 2026\)\.|\. Décision de Karimou du 30 août 2026\.|\.)\s*/;

// Situation sections: openers, PRÉSENTATION and NUMÉROTATION — strict full-line.
const SITUATION_LINES = [
  /^SITUATION N° [12] — (?:ouvre la page [12](?:, qui lui est entièrement consacrée)?|(?:première|deuxième|troisième|quatrième|seule|seconde)(?: et (?:dernière|seule))? (?:question|tâche)(?: de la situation)?|\d questions)(?: ; le jeu de formes s'arrête ici)?\.(?: Pas de pictogramme(?: de section)?(?: : une leçon d'intégration n'a pas de sections nommées)?\.)?(?: Elle ferme la (?:page 1|leçon)(?: : la rupture de page tombe juste après)?\.)?$/,
  /^PRÉSENTATION : le titre (?:« Situation n° [12] »|de la situation) en Andika Bold 12 pt, puis un encadré portant le CONTEXTE, et l'image de la scène placée À CÔTÉ de l'encadré(?:, en ~16:9)?\.$/,
  /^NUMÉROTATION : aucune pour le contexte\.(?: (?:Les|La) (?:deux |trois )?(?:questions?|tâches?) qui sui(?:t|vent) repart(?:ent)? de l'ÉTOILE(?: — la numérotation redémarre à chaque situation)?\.)?$/,
  /^NUMÉROTATION : ÉTOILE \(= 1\) — la numérotation REDÉMARRE dans cette situation\.$/,
  /^NUMÉROTATION : TRIANGLE \(= 2\) — la numérotation a redémarré à l'étoile dans cette situation\.$/,
  /^NUMÉROTATION : (?:TRIANGLE|CARRÉ) \(= \d\)\.$/,
];

const graph = JSON.parse(readFileSync(resolve(graphPath), "utf8"));
const byId = new Map(graph.nodes.map((n) => [n.id, n]));
const parentOf = new Map(); for (const e of graph.relationships) if (e.type === "hasPart") parentOf.set(e.end, e.start);
const titleOf = (n) => String(n?.properties?.description ?? "").split("\n")[0].trim();
const labelsOf = (n) => n?.labels ?? [];
const lessonOf = (id) => { let c = id; for (let i = 0; i < 20 && c; i++) { const m = titleOf(byId.get(c)).match(/Leçon (\d+)/i); if (m) return Number(m[1]); c = parentOf.get(c); } return null; };
const rootOf = (id) => { let c = id; for (let i = 0; i < 20 && parentOf.has(c); i++) c = parentOf.get(c); return c; };
const guideOf = (n) => n.properties?.metadata?.assemblyGuide;
const setGuide = (n, text) => { n.properties.metadata = { ...n.properties.metadata, assemblyGuide: text }; };

const studentTlm = graph.nodes.find((n) => labelsOf(n).includes("TeachingLearningMaterial") && /^Outil de l'élève$/.test(titleOf(n)));
const sections = graph.nodes.filter((n) => labelsOf(n).includes("DocumentSection") && typeof guideOf(n) === "string");
const report = { bilan: [], formatBlock: [], situationLines: [] };

// 1. bilan
for (const s of sections) {
  const paras = guideOf(s).split(/\n\s*\n/);
  let hit = false;
  const kept = paras.map((p) => {
    const t = p.trim();
    if (!STALE_BILAN.test(t)) return p;
    hit = true;
    const rest = t.replace(STALE_BILAN, "").trim();
    report.bilan.push({ lesson: lessonOf(s.id), removed: t.slice(0, t.length - rest.length).trim(), kept: rest });
    return rest;
  }).filter((p) => p.trim() !== "");
  if (hit) setGuide(s, kept.join("\n\n"));
}
const phasesSpec = graph.nodes.find((n) => labelsOf(n).includes("FormatterSpec") && PHASES_SPEC.test(titleOf(n)));
const OLD_TWO = "QUAND CE BLOC EN PORTE DEUX, LA PREMIÈRE S'IMPRIME et la seconde reste sans préfixe";
const NEW_MANY = "QUAND CE BLOC EN PORTE PLUSIEURS, LA PREMIÈRE S'IMPRIME et les autres restent sans préfixe";
const phasesTouched = phasesSpec.properties.content.includes(OLD_TWO);
if (phasesTouched) phasesSpec.properties.content = phasesSpec.properties.content.replace(OLD_TWO, NEW_MANY);

// 2. integration — the new spec
const formatter = graph.nodes.find((n) => labelsOf(n).includes("Formatter") && STRUCTURE_FORMATTER.test(titleOf(n)));
const structureSpec = graph.nodes.find((n) => labelsOf(n).includes("FormatterSpec") && STRUCTURE_SPEC.test(titleOf(n)));
if (!formatter || !structureSpec || !studentTlm || !phasesSpec) { console.error("anchor node missing", { formatter: !!formatter, structureSpec: !!structureSpec, studentTlm: !!studentTlm, phasesSpec: !!phasesSpec }); process.exit(1); }
const alreadyThere = graph.nodes.find((n) => labelsOf(n).includes("FormatterSpec") && titleOf(n) === NEW_SPEC_TITLE);
let newSpecId = alreadyThere?.id ?? null;
if (!alreadyThere) {
  newSpecId = randomUUID();
  const position = graph.relationships.filter((e) => e.type === "hasPart" && e.start === formatter.id).length + 1;
  graph.nodes.push({ id: newSpecId, labels: ["FormatterSpec"], properties: { identifier: newSpecId, description: NEW_SPEC_TITLE, position, materialType: "Reference", content: NEW_SPEC_CONTENT } });
  graph.relationships.push({ id: `hasPart:${formatter.id}->${newSpecId}`, type: "hasPart", start: formatter.id, end: newSpecId, properties: { orderInParent: position } });
}
const structurePointerAdded = !structureSpec.properties.content.includes(STRUCTURE_POINTER);
if (structurePointerAdded) {
  const lines = structureSpec.properties.content.split("\n");
  lines.splice(1, 0, "", STRUCTURE_POINTER);   // right under the opening paragraph
  structureSpec.properties.content = lines.join("\n");
}
const tlmGuide = guideOf(studentTlm) ?? "";
const tlmPointerAdded = !tlmGuide.includes("## Integration lessons");
if (tlmPointerAdded) {
  const at = tlmGuide.indexOf("## Two passes, three files");
  const next = at >= 0 ? tlmGuide.slice(0, at) + TLM_GUIDE_POINTER + "\n\n" + tlmGuide.slice(at) : tlmGuide.trimEnd() + "\n\n" + TLM_GUIDE_POINTER + "\n";
  setGuide(studentTlm, next);
}

// 2b. integration — the eight lesson guides and their situation sections
const integrationSections = sections.filter((s) => rootOf(s.id) === studentTlm.id && INTEGRATION_LESSONS.includes(lessonOf(s.id)));
for (const s of integrationSections) {
  const L = lessonOf(s.id);
  const isLessonGuide = /^V2 — Leçon \d+/.test(titleOf(s));
  const before = guideOf(s);
  let out;
  if (isLessonGuide) {
    out = before.split(/\n\s*\n/).map((p) => {
      const lines = p.split("\n");
      if (!FORMAT_BANNER.test(lines[0].trim())) return p;
      const kept = [];
      for (const raw of lines.slice(1)) {
        const t = raw.trim();
        if (FORMAT_RULE_LINES.some((re) => re.test(t))) { report.formatBlock.push({ lesson: L, removed: t }); continue; }
        if (PLURAL_SIGNS_RULE.test(t)) {
          const rest = t.replace(PLURAL_SIGNS_RULE, "").trim();
          report.formatBlock.push({ lesson: L, removed: t.slice(0, t.length - rest.length).trim(), kept: rest });
          if (rest) kept.push(rest);
          continue;
        }
        kept.push(raw);
      }
      if (kept.length === 0) { report.formatBlock.push({ lesson: L, removed: lines[0].trim() }); return ""; }
      return [lines[0], ...kept].join("\n");   // the banner stays over what is left
    }).filter((p) => p.trim() !== "").join("\n\n");
  } else {
    const kept = [];
    for (const raw of before.split("\n")) {
      const t = raw.trim();
      if (SITUATION_LINES.some((re) => re.test(t))) { report.situationLines.push({ lesson: L, section: titleOf(s), removed: t }); continue; }
      kept.push(raw);
    }
    out = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  if (out !== before) setGuide(s, out);
}

// ── report ───────────────────────────────────────────────────────────────────
const count = (arr, key) => arr.reduce((m, x) => m.set(x[key], (m.get(x[key]) ?? 0) + 1), new Map());
console.log(JSON.stringify({
  bilanParagraphsTrimmed: report.bilan.length, bilanLessons: [...new Set(report.bilan.map((x) => x.lesson))].sort((a, b) => a - b),
  phasesSpecWordingUpdated: phasesTouched,
  newSpec: alreadyThere ? "already present" : `added under « ${titleOf(formatter)} » (${NEW_SPEC_CONTENT.length} chars)`,
  structureSpecPointerAdded: structurePointerAdded, studentGuidePointerAdded: tlmPointerAdded,
  formatBlockLinesRemoved: report.formatBlock.length, situationLinesRemoved: report.situationLines.length,
  situationSectionsTouched: new Set(report.situationLines.map((x) => x.section + x.lesson)).size,
}, null, 2));
console.log("\n── 1. bilan: what goes (one form per line) and what stays after it");
for (const [removed, n] of count(report.bilan, "removed")) console.log(`  ${String(n).padStart(2)}×  ${removed.slice(0, 160)}…`);
for (const x of report.bilan.filter((x) => x.kept)) console.log(`  L${x.lesson} keeps: ${x.kept.slice(0, 200)}`);
console.log("\n── 2. integration lesson guides: every removed line, in full");
for (const x of report.formatBlock) console.log(`  L${x.lesson}  − ${x.removed}${x.kept ? `\n        keeps: ${x.kept}` : ""}`);
console.log("\n── 2b. situation sections: removed lines by form");
for (const [removed, n] of [...count(report.situationLines, "removed")].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(2)}×  ${removed}`);
console.log("\n── new spec « " + NEW_SPEC_TITLE + " »\n" + NEW_SPEC_CONTENT);

if (outPath) { writeFileSync(resolve(outPath), JSON.stringify(graph, null, 2)); console.log(`\nmigrated graph written to ${outPath}`); }
else console.log("\ndry run — pass --out <file> to write the migrated graph.");
