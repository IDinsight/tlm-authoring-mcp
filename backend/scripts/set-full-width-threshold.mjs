#!/usr/bin/env node
/*
 * Write the full-width threshold into the teacher formatter's geometry.
 *
 * The spec « Les images de la fiche » says « UNE BANDE PLUS ALLONGÉE QUE 4 POUR
 * 1 SE POSE EN PLEINE LARGEUR ». The renderer applies exactly that rule when the
 * `render.images.fullWidthAboveAspectRatio` key is set, and the page lint's
 * band rule reads the same key — but no formatter carried it, so neither could
 * act on the sentence. This sets it to 4 on the formatter whose spec states the
 * rule. Data only; the curator loop (edit_nodes → properties.render) is the
 * other way to do it.
 *
 * Usage: node scripts/set-full-width-threshold.mjs <graph.json> [--out migrated.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const graphPath = args.find((a) => !a.startsWith("--"));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!graphPath) { console.error("usage: set-full-width-threshold.mjs <graph.json> [--out migrated.json]"); process.exit(1); }
const outPath = opt("--out");
const THRESHOLD = 4;

const graph = JSON.parse(readFileSync(resolve(graphPath), "utf8"));
const titleOf = (n) => String(n?.properties?.description ?? "").split("\n")[0].trim();
const formatter = graph.nodes.find((n) => (n.labels ?? []).includes("Formatter") && /^Guide de l'enseignant — gabarit répété d'une fiche$/.test(titleOf(n)));
if (!formatter?.properties?.render?.images) { console.error("teacher formatter with an images geometry not found"); process.exit(1); }
const before = formatter.properties.render.images.fullWidthAboveAspectRatio;
formatter.properties.render.images.fullWidthAboveAspectRatio = THRESHOLD;
console.log(`« ${titleOf(formatter)} » render.images.fullWidthAboveAspectRatio: ${before ?? "(unset)"} → ${THRESHOLD}`);
if (outPath) { writeFileSync(resolve(outPath), JSON.stringify(graph, null, 2)); console.log(`written to ${outPath}`); } else console.log("dry run — pass --out to write.");
