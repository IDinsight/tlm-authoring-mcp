#!/usr/bin/env node
/*
 * Align the teacher formatter's image geometry with the delivered fiches.
 *
 * Measured on the ten delivered fiches of Leçons 21–30 (the batch produced
 * with the six tightening levers, two pages each, accepted by the experts;
 * scripts/measure-fiches.mjs, pinned in test/fixtures/reference-fiches-21-30.json):
 * bands are 7.5 cm wide at most and 1.2–2.33 cm tall, scenes 1.8–2.2 cm tall
 * and under 5.2 cm wide, and EVERY band floats beside the text, including the
 * 63 of 76 wider than 4:1. The declared geometry said bands 2.5 cm tall up to
 * 10.5 cm wide and « plus allongée que 4 pour 1 → pleine largeur »: at those
 * values a typical band is 11.5 cm wide, and three of them floated stack and
 * crop (the Leçon 23 note of 12 September). The renderer draws a picture AT
 * its cap, so the caps are sizes, and they are set to what was delivered:
 *
 *   images.maxHeightCm  bande 2.5 → 2.3 · amorce 2.6 → 2.2 · notion 2.2 → 1.8 · scene 2.8 → 2.2
 *   images.maxWidthCm   10.5 → 7.5          (with the height following a capped width, #267)
 *   images.fullWidthAboveAspectRatio  4 → 7  (no delivered band reaches 7:1; the rule stops firing)
 *
 * The spec sentence that stated the 4:1 rule is rewritten to say what is done,
 * and the document's journal gets the dated decision.
 *
 * Usage: node scripts/align-geometry-to-reference.mjs <graph.json> [--out migrated.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const graphPath = args.find((a) => !a.startsWith("--"));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!graphPath) { console.error("usage: align-geometry-to-reference.mjs <graph.json> [--out migrated.json]"); process.exit(1); }
const outPath = opt("--out");

const ALIGNED = { maxHeightCm: { amorce: 2.2, notion: 1.8, bande: 2.3, scene: 2.2 }, maxWidthCm: 7.5, fullWidthAboveAspectRatio: 7 };
const OLD_SENTENCE = "UNE BANDE PLUS ALLONGÉE QUE 4 POUR 1 SE POSE EN PLEINE LARGEUR, juste sous sa directive, et non calée à droite.";
const NEW_SENTENCE = "UNE BANDE FLOTTE À DROITE DE SA DIRECTIVE QUELLE QUE SOIT SA PROPORTION, À 7,5 CM DE LARGE AU PLUS ET 2,3 CM DE HAUT AU PLUS — c'est ce que font les dix fiches livrées des Leçons 21 à 30, dont 63 bandes sur 76 dépassent 4 pour 1, toutes flottantes, toutes en deux pages. La pleine largeur ne se déclenche qu'au-delà de 7 pour 1 (`render.images.fullWidthAboveAspectRatio`), proportion qu'aucune bande livrée n'atteint.";
const JOURNAL_ENTRY = `## 13 septembre 2026 — la géométrie des images alignée sur les fiches livrées

Mesure des dix fiches livrées (Leçons 21 à 30, deux pages chacune) : bandes 7,5 cm de large au plus, 1,2 à 2,33 cm de haut, toutes flottantes ; scènes 1,8 à 2,2 cm. La géométrie déclarait des bandes de 2,5 cm de haut jusqu'à 10,5 cm de large et « plus allongée que 4 pour 1, pleine largeur » — valeurs qu'aucune fiche livrée n'a appliquées, et qui font empiler trois bandes flottantes (constat du 12 septembre sur la Leçon 23). Décision de Karimou Ba : les plafonds prennent les valeurs livrées (bande 2,3 · amorce 2,2 · notion 1,8 · scène 2,2 · largeur 7,5) et le seuil de pleine largeur passe à 7 pour 1 ; la phrase de la spécification « Les images de la fiche » dit désormais ce qui est fait. Les fiches 21 à 30 sont la référence dont la mesure fait foi (test/fixtures/reference-fiches-21-30.json).`;

const graph = JSON.parse(readFileSync(resolve(graphPath), "utf8"));
const titleOf = (n) => String(n?.properties?.description ?? "").split("\n")[0].trim();
const fmt = graph.nodes.find((n) => (n.labels ?? []).includes("Formatter") && /^Guide de l'enseignant — gabarit répété d'une fiche$/.test(titleOf(n)));
const spec = graph.nodes.find((n) => (n.labels ?? []).includes("FormatterSpec") && /^Les images de la fiche$/.test(titleOf(n)));
const tlm = graph.nodes.find((n) => (n.labels ?? []).includes("TeachingLearningMaterial") && /^Guide/.test(titleOf(n)));
if (!fmt?.properties?.render?.images || !spec || !tlm) { console.error("anchor nodes missing"); process.exit(1); }

const before = JSON.parse(JSON.stringify(fmt.properties.render.images));
fmt.properties.render.images = { ...fmt.properties.render.images, ...ALIGNED, maxHeightCm: { ...fmt.properties.render.images.maxHeightCm, ...ALIGNED.maxHeightCm } };
const n = spec.properties.content.split(OLD_SENTENCE).length - 1;
if (n !== 1) { console.error(`spec sentence found ${n} times, expected 1`); process.exit(1); }
spec.properties.content = spec.properties.content.replace(OLD_SENTENCE, NEW_SENTENCE);
const journal = String(tlm.properties.metadata?.journal ?? "").trimEnd();
tlm.properties.metadata = { ...tlm.properties.metadata, journal: journal + "\n\n" + JOURNAL_ENTRY + "\n" };

console.log("geometry before:", JSON.stringify({ maxHeightCm: before.maxHeightCm, maxWidthCm: before.maxWidthCm, fullWidthAboveAspectRatio: before.fullWidthAboveAspectRatio }));
console.log("geometry after: ", JSON.stringify({ maxHeightCm: fmt.properties.render.images.maxHeightCm, maxWidthCm: fmt.properties.render.images.maxWidthCm, fullWidthAboveAspectRatio: fmt.properties.render.images.fullWidthAboveAspectRatio }));
console.log("spec « Les images de la fiche »: sentence replaced\njournal: entry appended (" + JOURNAL_ENTRY.length + " chars)");
if (outPath) { writeFileSync(resolve(outPath), JSON.stringify(graph, null, 2)); console.log(`written to ${outPath}`); } else console.log("dry run — pass --out to write.");
