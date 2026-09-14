#!/usr/bin/env node
/*
 * Put the pupil book's layout templates on its structure formatter.
 *
 * The page shape of a pupil lesson — header line, question box with the
 * scene beside it, a directive with its marker then its band, the notion box,
 * the break before the second group — lived as prose in fifty-two section
 * guides, re-read by a model on every production. It is now ONE template
 * list, `properties.layout` on « CI maths V2 — structure d'une leçon de
 * l'Outil de l'élève », the formatter whose prose describes that page; the
 * composer (compose_section) fills it from the graph. The template itself is
 * test/fixtures/senegal-pupil-layout.json, the same file the composer's tests
 * pin, so what is imported is what was tested.
 *
 * Validated by the same schema edit_nodes applies; the document's journal
 * gets the dated decision.
 *
 * Usage: node scripts/set-pupil-layout.mjs <graph.json> [--out migrated.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateLayoutSpec } from "../dist/kg-recipes/index.js";

const args = process.argv.slice(2);
const graphPath = args.find((a) => !a.startsWith("--"));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!graphPath) { console.error("usage: set-pupil-layout.mjs <graph.json> [--out migrated.json]"); process.exit(1); }
const outPath = opt("--out");

const FORMATTER = /^CI maths V2 — structure d'une leçon de l'Outil de l'élève$/;
const DOCUMENT = /^Outil de l'élève$/;
const LAYOUT = JSON.parse(readFileSync(resolve("test/fixtures/senegal-pupil-layout.json"), "utf8"));

const JOURNAL_ENTRY = `=== La structure de la page de l'élève devient un gabarit — 2026-09-14 — karimou.ba@idinsight.org ===
La forme d'une page de l'Outil de l'élève — ligne d'en-tête, encadré des questions avec la scène à côté, directive avec son repère puis sa bande, encadré de la notion, rupture avant le second groupe — était décrite en prose dans chaque section, et le modèle la recomposait à chaque production (constat du 12 septembre 2026 : deux productions d'une même leçon ne se ressemblaient pas). Elle est désormais un gabarit, \`properties.layout\` sur la mise en forme « structure d'une leçon », que le serveur remplit depuis le graphe (compose_section) : la directive est le titre de l'activité, l'image est celle qui lui est attachée, le repère suit le rang. Même graphe, même page, à chaque appel ; ce qu'un gabarit ne couvre pas est signalé, jamais inventé. Les guides de section gardent ce qu'un gabarit ne dit pas : les demandes d'illustration, les raisons, les anomalies. Décision de Karimou Ba ; gabarit testé sur la Leçon 23 (test/fixtures/senegal-pupil-layout.json).
`;

const graph = JSON.parse(readFileSync(resolve(graphPath), "utf8"));
const titleOf = (n) => String(n?.properties?.description ?? "").split("\n")[0].trim();
const byLabel = (label, re) => graph.nodes.find((n) => (n.labels ?? []).includes(label) && re.test(titleOf(n)));
const fmt = byLabel("Formatter", FORMATTER);
const tlm = byLabel("TeachingLearningMaterial", DOCUMENT);
if (!fmt || !tlm) { console.error("anchor nodes missing", { fmt: !!fmt, tlm: !!tlm }); process.exit(1); }
if (fmt.properties.layout) { console.error("the formatter already carries a layout bag — this script writes a first one"); process.exit(1); }

const problems = validateLayoutSpec(LAYOUT, "set-pupil-layout");
if (problems.length) { console.error("layout refused by the schema:\n" + problems.join("\n")); process.exit(1); }

fmt.properties.layout = LAYOUT;
const journal = String(tlm.properties.metadata?.journal ?? "").trimEnd();
tlm.properties.metadata = { ...tlm.properties.metadata, journal: (journal || `# Journal — ${titleOf(tlm)}`) + "\n\n" + JOURNAL_ENTRY };

console.log(`formatter « ${titleOf(fmt)} »: layout written — ${LAYOUT.templates.length} templates (${LAYOUT.templates.map((t) => t.name).join(", ")}), schema OK`);
console.log(`document « ${titleOf(tlm)} »: journal entry appended (${JOURNAL_ENTRY.length} chars)`);
if (outPath) { writeFileSync(resolve(outPath), JSON.stringify(graph, null, 2)); console.log(`written to ${outPath}`); } else console.log("dry run — pass --out to write.");
