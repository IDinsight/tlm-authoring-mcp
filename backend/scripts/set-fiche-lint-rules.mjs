#!/usr/bin/env node
/*
 * Put the fiche's recurring-defect rules on the teacher formatter, as data.
 *
 * Six defects were re-found and re-arbitrated by hand on every fiche of the
 * 13 and 14 September runs (PT-07 without its example, the objective
 * announcement prefixed [FR], a RÉPONSE line running to a justification, an
 * amorce question with no answer in its parenthesis, a bullet over one line,
 * a letter A/B/C on the page). Each is a question the guide's own lines
 * answer, so each is now a `lintRules` entry on « Guide de l'enseignant —
 * gabarit répété d'une fiche », run by lint_content and silenced per node with
 * metadata.lintIgnore. A curator edits the list without a deploy. The list is
 * test/fixtures/senegal-fiche-lint-rules.json, the file the tests pin.
 *
 * Usage: node scripts/set-fiche-lint-rules.mjs <graph.json> [--out migrated.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateLintRules } from "../dist/kg-recipes/index.js";

const args = process.argv.slice(2);
const graphPath = args.find((a) => !a.startsWith("--"));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!graphPath) { console.error("usage: set-fiche-lint-rules.mjs <graph.json> [--out migrated.json]"); process.exit(1); }
const outPath = opt("--out");

const FORMATTER = /^Guide de l'enseignant — gabarit répété d'une fiche$/;
const { lintRules } = JSON.parse(readFileSync(resolve("test/fixtures/senegal-fiche-lint-rules.json"), "utf8"));

const graph = JSON.parse(readFileSync(resolve(graphPath), "utf8"));
const titleOf = (n) => String(n?.properties?.description ?? "").split("\n")[0].trim();
const fmt = graph.nodes.find((n) => (n.labels ?? []).includes("Formatter") && FORMATTER.test(titleOf(n)));
if (!fmt) { console.error("the teacher formatter is not in this graph"); process.exit(1); }
const problems = validateLintRules(lintRules, "set-fiche-lint-rules");
if (problems.length) { console.error("rules refused by the schema:\n" + problems.join("\n")); process.exit(1); }
fmt.properties.lintRules = lintRules;
console.log(`formatter « ${titleOf(fmt)} »: ${lintRules.length} lint rules written (${lintRules.map((r) => r.id).join(", ")}), schema OK`);
if (outPath) { writeFileSync(resolve(outPath), JSON.stringify(graph, null, 2)); console.log(`written to ${outPath}`); } else console.log("dry run — pass --out to write.");
