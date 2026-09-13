#!/usr/bin/env node
/*
 * Rebuild the fiche evaluation grid as a mirror of the checklist.
 *
 * The Guide carries a Rubric (« Contrôle d'une fiche du Guide de l'enseignant »)
 * that evaluate_document hands to the reviewing model: ten yes/no questions.
 * The formatter's own spec « Le contrôle de la fiche » lists twenty-seven
 * points a fiche must satisfy before it ships. Eleven were in the grid in some
 * form; sixteen were not, so a fiche could pass the grid with three bands
 * stacked at the margin or two questions at the objectivation.
 *
 * This reads the 27 points off the spec (they are the source; the grid is its
 * evaluation form), and rebuilds the rubric as five sections — the spec's own
 * groups — holding one criterion per point, whose content is the point WORD
 * FOR WORD plus one line saying HOW it is answered: by a server check (named),
 * by a measure on the PDF, or by eye. Existing criteria keep their ids where
 * they map onto a point, so past evaluations still refer to something.
 *
 * Also sets `maxChars: 88` on the formatter's « puce » style, so point 4 (no
 * bullet takes two lines) becomes the page rule page-line-over-max-chars.
 *
 * The rubric's MASTER lives in the workspace catalog (senegal/_catalog/routines),
 * stored in the catalog's routine shape — the grid and its sections labelled
 * InstructionalRoutine, the criteria Material — and relabelled when use_rubric
 * attaches a copy. `--catalog` writes that shape, and `--spec-from <ci-maths
 * graph>` supplies the checklist the catalog graph does not hold.
 *
 * Usage: node scripts/rebuild-fiche-rubric.mjs <graph.json> [--out migrated.json] [--catalog --spec-from <graph.json>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const graphPath = args.find((a) => !a.startsWith("--"));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!graphPath) { console.error("usage: rebuild-fiche-rubric.mjs <graph.json> [--out migrated.json]"); process.exit(1); }
const outPath = opt("--out");
const catalogMode = args.includes("--catalog");
const specFrom = opt("--spec-from");

// Short titles, one per point, and how each is answered.
const TITLES = {
  1: "Deux pages, une par séance", 2: "Blanc réservé au bas de page", 3: "Corps, interligne et marges de la mise en forme", 4: "Aucune puce sur deux lignes", 5: "Bandeaux entiers, aucun cadre vide",
  6: "Une seule couleur de parole par fiche", 7: "Mêmes puces et mêmes images dans les deux fiches", 8: "Aucune ligne [WO] dans les guides", 9: "Parenthèse finale noire et non traduite",
  10: "Aucune couleur, aucun code, aucun intertitre imprimé", 11: "Rien d'utile laissé sans marqueur", 12: "Phrases-types appelées et résolues", 13: "Pictogrammes de la mise en forme, une pastille par activité", 14: "Aucun renvoi resté au placeholder", 15: "Le guide ne commente pas le matériel", 16: "Ni nom propre ni comparaison",
  17: "Images de l'Outil de l'élève, à jour, dans leur sens", 18: "Clé relue, un crochet par bande", 19: "Aucune légende, aucun cadre, aucun blanc autour d'une image",
  20: "Somme des durées", 21: "Le nombre d'activités suit la leçon, la dernière question à l'évaluation", 22: "Aucune lettre A / B / C", 23: "La révision s'ouvre par un geste", 24: "Chaque notion modelée par un geste", 25: "Case MATÉRIEL et gestes concordent", 26: "PT-07 avec son exemple, PT-17 avec son image", 27: "Objectivation et évaluation au format",
};
const BY_EYE = "À l'œil, sur le PDF, sur les deux fiches.";
const HOW = {
  1: "Mesuré sur le rendu (mesureur : pages, début de la séance 2). Le seuil `render.budget.maxPages` est la référence.",
  2: "Mesuré sur le rendu (mesureur : blanc résiduel contre `render.budget.reserveBottomCm`).",
  3: "Garanti par le serveur : le rendu applique `render.type` et `render.page` ; reste à vérifier qu'aucune prose ne les réécrit.",
  4: "Vérifié avant le rendu par lint_content (page-line-over-max-chars, style « puce » à 88 caractères) ; les exceptions nommées se confirment à l'œil.",
  5: "Vérifié en partie par lint_content (page-band-floats-above-threshold) ; le reste à l'œil sur le PDF.",
  6: "Sur le fichier : compter les variantes `FR` et `WO` de `render.language` dans chaque fiche.",
  7: BY_EYE + " Les deux fiches se lisent côte à côte.",
  8: "À l'œil, sur les guides des sections (walk_document_section), pas sur le PDF.",
  9: BY_EYE,
  10: BY_EYE,
  11: "À l'œil, le guide de chaque section à côté de la fiche rendue.",
  12: "À l'œil : chaque `{pt:…}` de la fiche rendue est devenu sa phrase, et aucune ligne du guide ne recopie une phrase du répertoire.",
  13: "Vérifié en partie par lint_content (page-missing-media, page-picture-not-attached) ; la pastille unique à l'œil.",
  14: "À l'œil : chercher « p. ● » et « à la page » dans la fiche rendue.",
  15: BY_EYE,
  16: BY_EYE,
  17: "Vérifié en partie par lint_content (page-picture-not-attached : les images sont celles attachées au curriculum) et par `sourceFreshness` sur la lecture ; le sens et les caches à l'œil.",
  18: "La réponse imprimée est vérifiée par lint_content (page-answer-differs, contre l'activité couverte) ; le crochet, sa place et son unicité à l'œil sur la bande agrandie.",
  19: BY_EYE,
  20: "Vérifié par lint_content sur la routine (total déclaré contre la somme des étapes) ; à l'œil sur la fiche.",
  21: "Le nombre d'activités est vérifié par lint_content (page-directive-missing : chaque activité couverte a sa consigne sur la page) ; la place de la dernière question à l'œil.",
  22: BY_EYE,
  23: BY_EYE,
  24: BY_EYE,
  25: BY_EYE,
  26: BY_EYE,
  27: BY_EYE,
};
// Existing criteria that map onto a point keep their id (title as it is today → point).
const KEEP = { "Pagination et typographie, mesurées sur le rendu": 1, "Absence de ligne wolof dans le guide": 8, "Rien d'utile laissé en spécification": 11, "Phrases-types appelées et résolues": 12, "Aucun renvoi resté au placeholder": 14, "Ni nom propre ni comparaison": 16, "Somme des durées": 20, "Nombre d'activités": 21, "Aucune lettre de choix": 22 };

const graph = JSON.parse(readFileSync(resolve(graphPath), "utf8"));
const byId = new Map(graph.nodes.map((n) => [n.id, n]));
const titleOf = (n) => String(n?.properties?.description ?? "").split("\n")[0].trim();
const labelsOf = (n) => n?.labels ?? [];
const childrenOf = (id) => graph.relationships.filter((e) => e.type === "hasPart" && e.start === id).sort((a, b) => (a.properties?.orderInParent ?? 0) - (b.properties?.orderInParent ?? 0)).map((e) => byId.get(e.end));

const specGraph = specFrom ? JSON.parse(readFileSync(resolve(specFrom), "utf8")) : graph;
const spec = specGraph.nodes.find((n) => labelsOf(n).includes("FormatterSpec") && /^Le contrôle de la fiche$/.test(titleOf(n)));
const RUBRIC_LABEL = catalogMode ? "InstructionalRoutine" : "Rubric";
const SECTION_LABEL = catalogMode ? "InstructionalRoutine" : "RubricSection";
const CRITERION_LABEL = catalogMode ? "Material" : "RubricCriterion";
const rubric = graph.nodes.find((n) => labelsOf(n).includes(RUBRIC_LABEL) && /^Contrôle d'une fiche du Guide/.test(titleOf(n)) && (!catalogMode || n.properties?.metadata?.catalogKind === "rubric"));
if (!spec || !rubric) { console.error("spec or rubric not found"); process.exit(1); }

// 1. The points, grouped by the spec's own « •• … •• » headings.
const groups = []; let current = null;
for (const line of spec.properties.content.split("\n")) {
  const h = line.match(/^••\s*(.+?)\s*••$/); if (h) { current = { name: h[1], points: [] }; groups.push(current); continue; }
  const p = line.match(/^(\d+)\.\s+(.*)$/); if (p && current) { current.points.push({ n: Number(p[1]), text: p[2].trim() }); continue; }
  if (current && current.points.length && line.trim()) current.points[current.points.length - 1].text += "\n" + line.trim();
}
const total = groups.reduce((a, g) => a + g.points.length, 0);
if (total !== 27) { console.error(`expected 27 points, parsed ${total}`); process.exit(1); }

// 2. Old grid: sections + criteria, and which criterion ids survive.
const oldSections = childrenOf(rubric.id).filter((n) => labelsOf(n).includes(SECTION_LABEL));
const oldCriteria = oldSections.flatMap((s) => childrenOf(s.id)).filter((n) => labelsOf(n).includes(CRITERION_LABEL));
// The catalog marks its shape with metadata roles; the attached copy carries none.
const sectionMeta = catalogMode ? { metadata: { role: "instructional-routine" } } : {};
const criterionMeta = catalogMode ? { metadata: { role: "instructional-routine-material" } } : {};
const idForPoint = new Map(); const retired = [];
for (const c of oldCriteria) { const point = KEEP[titleOf(c)]; if (point && !idForPoint.has(point)) idForPoint.set(point, c.id); else retired.push(titleOf(c)); }
const boilerplate = Object.fromEntries(["license", "provider", "attributionStatement", "inLanguage", "academicSubject"].filter((k) => oldCriteria[0]?.properties[k] !== undefined).map((k) => [k, oldCriteria[0].properties[k]]));

// 3. Remove the old subtree (nodes + edges), then write the new one.
const removeIds = new Set([...oldSections, ...oldCriteria].map((n) => n.id));
graph.nodes = graph.nodes.filter((n) => !removeIds.has(n.id));
graph.relationships = graph.relationships.filter((e) => !removeIds.has(e.start) && !removeIds.has(e.end));
const add = (node, parentId, position) => { graph.nodes.push(node); graph.relationships.push({ id: `hasPart:${parentId}->${node.id}`, type: "hasPart", start: parentId, end: node.id, properties: { orderInParent: position } }); };
const LETTERS = "ABCDE";
const printed = [];
groups.forEach((g, gi) => {
  const section = { id: randomUUID(), labels: [SECTION_LABEL], properties: { ...boilerplate, identifier: undefined, description: `${LETTERS[gi]}. ${g.name.charAt(0) + g.name.slice(1).toLowerCase()}`, position: gi + 1, ...(catalogMode ? {} : { normalizedType: "Material", materialType: "Reference" }), ...sectionMeta } };
  section.properties.identifier = section.id; add(section, rubric.id, gi + 1);
  printed.push(`\n${section.properties.description}`);
  g.points.forEach((p, pi) => {
    const id = idForPoint.get(p.n) ?? randomUUID();
    const content = `Point ${p.n} de « Le contrôle de la fiche » : ${p.text}\n\nComment on répond — ${HOW[p.n]}`;
    add({ id, labels: [CRITERION_LABEL], properties: { ...boilerplate, identifier: id, description: `${p.n}. ${TITLES[p.n]}`, content, position: pi + 1, normalizedType: "Material", materialType: "Reference", ...criterionMeta } }, section.id, pi + 1);
    printed.push(`  ${String(p.n).padStart(2)}. ${TITLES[p.n]}${idForPoint.has(p.n) ? "  (id conservé)" : ""}\n      → ${HOW[p.n]}`);
  });
});
rubric.properties.metadata = { ...rubric.properties.metadata, summary: String(rubric.properties.metadata?.summary ?? "").replace(/^Grille de CONTRÔLE/, "Grille de CONTRÔLE — les 27 points de « Le contrôle de la fiche », un par question, mot pour mot ; chaque question dit comment on y répond (par l'outil, par la mesure, ou à l'œil)") };

// 4. Point 4 becomes a page rule: the bullet style declares its line budget.
const fmt = graph.nodes.find((n) => labelsOf(n).includes("Formatter") && /^Guide de l'enseignant — gabarit répété d'une fiche$/.test(titleOf(n)));
const puceBefore = fmt?.properties.render?.blocks?.puce?.maxChars;
if (fmt?.properties.render?.blocks) fmt.properties.render.blocks.puce = { ...fmt.properties.render.blocks.puce, maxChars: fmt.properties.render.budget?.maxCharsPerLine ?? 88 };

console.log(`grid: ${groups.length} sections, ${total} criteria (${idForPoint.size} ids kept, ${retired.length} retired: ${retired.join("; ")})`);
console.log(fmt ? `« puce ».maxChars: ${puceBefore ?? "(unset)"} → ${fmt.properties.render.blocks.puce.maxChars}` : "(no formatter in this graph — catalog mode)");
console.log(printed.join("\n"));
if (outPath) { writeFileSync(resolve(outPath), JSON.stringify(graph, null, 2)); console.log(`\nwritten to ${outPath}`); } else console.log("\ndry run — pass --out to write.");
