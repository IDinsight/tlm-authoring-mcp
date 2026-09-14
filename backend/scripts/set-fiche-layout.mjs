#!/usr/bin/env node
/*
 * Put the teacher fiche's layout skeleton on its formatter.
 *
 * The fixed part of a fiche — the three header cases, the OS banner, the
 * MATÉRIEL case, the two séance banners (the second starting page 2), the nine
 * phase banners in their colours with their pictograms — was recomposed by a
 * model on every production from « En-tête, bandeaux et case MATÉRIEL » and
 * « Les neuf phases ». It is now ONE template list, `properties.layout` on
 * « Guide de l'enseignant — gabarit répété d'une fiche », the formatter whose
 * prose describes that page. Each phase is a HOLE: compose_section reports it
 * under `unfilled` with `insertAt`, and the model composes the phase's lines
 * from its guide and lands them by patch. The template itself is
 * test/fixtures/senegal-fiche-layout.json, the file the composer's tests pin
 * on the Leçon 4 fiche, so what is imported is what was tested.
 *
 * Usage: node scripts/set-fiche-layout.mjs <graph.json> [--out migrated.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateLayoutSpec } from "../dist/kg-recipes/index.js";

const args = process.argv.slice(2);
const graphPath = args.find((a) => !a.startsWith("--"));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!graphPath) { console.error("usage: set-fiche-layout.mjs <graph.json> [--out migrated.json]"); process.exit(1); }
const outPath = opt("--out");

const FORMATTER = /^Guide de l'enseignant — gabarit répété d'une fiche$/;
const DOCUMENT = /^Guide d'utilisation de l'outil de l'élève$/;
const LAYOUT = JSON.parse(readFileSync(resolve("test/fixtures/senegal-fiche-layout.json"), "utf8"));

const JOURNAL_ENTRY = `=== Le squelette de la fiche devient un gabarit — 2026-09-14 — karimou.ba@idinsight.org ===
La partie fixe d'une fiche — les trois cases de l'en-tête (semaine et jour calculés depuis le rang de la leçon), le bandeau OS, la case MATÉRIEL lue dans le guide de la fiche, les deux bandeaux de séance (le second portant la rupture de page), les neuf bandeaux de phase dans leurs couleurs avec leurs pictogrammes — était recomposée par le modèle à chaque production. Elle est désormais un gabarit, \`properties.layout\` sur la mise en forme « gabarit répété d'une fiche », que le serveur remplit depuis le graphe (compose_section). Chaque phase y est un TROU : le serveur le signale avec le chemin où insérer, et le modèle compose les lignes de la phase depuis son guide, comme avant. Le crochet de la copie du maître n'est plus dessiné à la main : la cellule correcte se note sur l'image (answerCells) et le serveur trace le crochet au rendu (mark:'answer'). Gabarit testé sur la fiche de la Leçon 4 (test/fixtures/senegal-fiche-layout.json).
`;

const graph = JSON.parse(readFileSync(resolve(graphPath), "utf8"));
const titleOf = (n) => String(n?.properties?.description ?? "").split("\n")[0].trim();
const byLabel = (label, re) => graph.nodes.find((n) => (n.labels ?? []).includes(label) && re.test(titleOf(n)));
const fmt = byLabel("Formatter", FORMATTER);
const tlm = byLabel("TeachingLearningMaterial", DOCUMENT);
if (!fmt || !tlm) { console.error("anchor nodes missing", { fmt: !!fmt, tlm: !!tlm }); process.exit(1); }
if (fmt.properties.layout) { console.error("the formatter already carries a layout bag — this script writes a first one"); process.exit(1); }

const problems = validateLayoutSpec(LAYOUT, "set-fiche-layout");
if (problems.length) { console.error("layout refused by the schema:\n" + problems.join("\n")); process.exit(1); }

fmt.properties.layout = LAYOUT;
const journal = String(tlm.properties.metadata?.journal ?? "").trimEnd();
tlm.properties.metadata = { ...tlm.properties.metadata, journal: (journal || `# Journal — ${titleOf(tlm)}`) + "\n\n" + JOURNAL_ENTRY };

console.log(`formatter « ${titleOf(fmt)} »: layout written — ${LAYOUT.templates.length} templates (${LAYOUT.templates.map((t) => t.name).join(", ")}), schema OK`);
console.log(`document « ${titleOf(tlm)} »: journal entry appended (${JOURNAL_ENTRY.length} chars)`);
if (outPath) { writeFileSync(resolve(outPath), JSON.stringify(graph, null, 2)); console.log(`written to ${outPath}`); } else console.log("dry run — pass --out to write.");
