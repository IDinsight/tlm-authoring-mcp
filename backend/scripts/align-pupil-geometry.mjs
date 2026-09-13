#!/usr/bin/env node
/*
 * Give the pupil book its layout settings, aligned with the delivered lessons.
 *
 * The pupil-book formatters carried prose only — no `render` bag — so
 * render_document refused every pupil page and the page rules had nothing to
 * check against. The twenty delivered lessons (Outputs/Lessons, FR and WO,
 * 38 of 40 files at two pages; scripts measured by the same method as the
 * fiches, pinned in test/fixtures/reference-pupil-1-20.json) are the
 * reference: one page geometry throughout, Andika 11.5 pt body, the header
 * line and the oral questions at 10.5, bands 16 cm wide and up to 6 cm tall
 * under their directive, the scene inside the question box, the fixed
 * section pictograms at 0.42 cm and the shape markers at 0.95. (The answer
 * signs under the cells are declared at the marker's size: no delivered file
 * carries them as pictures yet — the rule that puts them there is newer than
 * the corpus.)
 *
 * The typography paragraph declared 12 pt body, 16 pt Avenir Black title,
 * 11 pt labels — sizes no delivered file uses, because at those sizes no
 * lesson fits two pages. As for the fiches in September, the declaration
 * becomes what is done, the paragraph says so, and the document's journal
 * records the decision.
 *
 * Usage: node scripts/align-pupil-geometry.mjs <graph.json> [--out migrated.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateRenderSpec } from "../dist/kg-recipes/index.js";

const args = process.argv.slice(2);
const graphPath = args.find((a) => !a.startsWith("--"));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!graphPath) { console.error("usage: align-pupil-geometry.mjs <graph.json> [--out migrated.json]"); process.exit(1); }
const outPath = opt("--out");

const FORMATTER = /^CI maths V2 — production et typographie de l'Outil de l'élève$/;
const SPEC = /^Production et typographie — Outil de l'élève V2$/;
const DOCUMENT = /^Outil de l'élève$/;

// Every number here is a measurement of the delivered corpus, or derived from
// one (the character budgets scale the teacher formatter's calibration — 88
// characters at 12 pt over 18.46 cm — to this width and size).
const RENDER = {
  page: { size: "A4", orientation: "portrait", marginsCm: { top: 1.5, bottom: 1.2, left: 1.7, right: 1.7 } },
  type: { family: "Andika", sizePt: 11.5, leadingRule: "auto", colour: "000000" },
  budget: { maxPages: 2, linesPerPage: 56, maxCharsPerLine: 87, maxCharsBesideImage: 47, reserveBottomCm: 1.5 },
  blocks: {
    "en-tete":        { bold: true, sizePt: 10.5, keepWithNext: true, maxChars: 100 },
    "question-orale": { sizePt: 10.5, maxCharsBesideImage: 47 },
    "directive":      { sizePt: 11.5, maxChars: 87, keepWithNext: true },
    "etiquette":      { sizePt: 10.5 },
    "encadre":        { fill: "FDF7F0", border: "thin", cellMarginsCm: 0.15 },
    "grille":         { border: "none", cellMarginsCm: 0.05 },
  },
  images: {
    placement: "full-width",
    maxHeightCm: { bande: 6, vignette: 6, amorce: 4.6, "je-retiens": 3.8 },
    maxWidthCm: 16,
    inlineHeightCm: { "picto-section": 0.42, repere: 0.95, signe: 0.95 },
    gutterCm: 0.3,
    caption: false,
    paragraphLeadingRule: "auto",
  },
  pagination: { oneSectionPerPage: false, pageBreakCarrier: "paragraph" },
  language: {
    strategy: "per-file",
    variants: [
      { id: "FR", lang: "fr", fileSuffix: "-FR" },
      { id: "WO", lang: "wo", fileSuffix: "-WO" },
    ],
  },
  overflow: { policy: "tighten-text", neverAdjust: ["margins", "leading", "typeSize"] },
};

const OLD_START = "TYPOGRAPHIE — relevée sur le modèle du Ministère et à reproduire telle quelle, dans les trois fichiers :";
const OLD_END = "INTERLIGNAGE :";
const NEW_TYPOGRAPHY = `TYPOGRAPHIE — CELLE DES VINGT LEÇONS LIVRÉES, déclarée dans \`render\` de cette mise en forme et à reproduire telle quelle dans les fichiers FR et WO. Mesurée le 13 septembre 2026 sur les fichiers livrés des Leçons 1 à 20 (test/fixtures/reference-pupil-1-20.json) :
• Page A4, marges 1,5 cm en tête, 1,2 cm en pied, 1,7 cm de chaque côté (\`render.page\`).
• Corps de texte (directives, énoncés) : Andika, 11,5 pt, interligne simple (\`render.type\`, style \`directive\`).
• Ligne d'en-tête « Unité N · Leçon N · titre » : Andika Bold, 10,5 pt, sur une seule ligne (style \`en-tete\`).
• Questions orales de l'amorce, dans leur encadré : Andika, 10,5 pt (style \`question-orale\`).
• Étiquettes des schémas (« Légumes », « Aubergines ») : Andika, 10,5 pt, composées dans le document au point d'ancrage donné par le dossier d'illustration (style \`etiquette\`).
• Signes de réponse X / O / – : PAS un caractère de police — ce sont des actifs fixes (pastille noire à symbole blanc) posés DANS LE DOCUMENT, SOUS chaque vignette et CENTRÉS sur elle, à 0,95 cm (\`render.images.inlineHeightCm.signe\`), à partir de leurs fichiers du dépôt des médias (\`assets/signe-*\`, voir « CI maths V2 — pictogrammes et symboles »). Les pictogrammes de section se posent à 0,42 cm et les repères de numérotation (★ ▲ ■ ●) à 0,95 cm, en début de ligne, à la place du chiffre.
• Bande d'activité : 16 cm de large, 6 cm de haut au plus, sous sa directive (\`render.images.maxHeightCm.bande\`, \`maxWidthCm\`) ; scène d'amorce 4,6 cm de haut au plus, dans l'encadré des questions ; image de la notion 3,8 cm au plus.
• Dans le dossier d'illustration, la description de chaque image est composée en Andika 11 pt dans un encadré à filet fin, sous un intertitre en gras qui la nomme, la fiche d'identité venant en tête de l'encadré.

Andika est la police de littératie de SIL, dessinée pour les lecteurs débutants : formes de lettres non ambiguës, a à un seul étage, l et I nettement distincts. Ce choix est pédagogique, pas décoratif — ne pas y substituer une police généraliste. Elle est libre de droits (SIL OFL) et couvre les caractères du wolof (ñ, ŋ), ce qui permet de composer les deux versions dans la même police.

(La déclaration antérieure — corps Andika 12 pt, titre Avenir Black 16 pt en capitales, repères Andika Bold 12 pt, étiquettes 11 pt — relevait le modèle du Ministère ; aucune leçon livrée ne l'applique, parce qu'à ces corps aucune ne tient en deux pages. Voir le journal du document, 13 septembre 2026.)

`;

const JOURNAL_ENTRY = `=== La mise en forme de l'Outil de l'élève reçoit sa géométrie — 2026-09-13 — karimou.ba@idinsight.org ===
Jusqu'ici aucune mise en forme de l'Outil de l'élève ne portait de sac \`render\` : le serveur refusait de mettre en page une page de l'élève, et les règles de page n'avaient aucune limite à lire. Les vingt leçons livrées (Leçons 1 à 20, FR et WO, 38 fichiers sur 40 en deux pages, la Leçon 5 en une seule séance et une page) ont été mesurées par la même méthode que les fiches du maître (test/fixtures/reference-pupil-1-20.json) : A4, marges 1,5 / 1,2 / 1,7 / 1,7 ; Andika 11,5 pt en corps, 10,5 pt pour l'en-tête, les questions orales et les étiquettes ; bandes de 16 cm de large et 2,4 à 6 cm de haut, jamais flottantes ; scènes jusqu'à 4,6 cm de haut dans l'encadré des questions ; pictogrammes de section à 0,42 cm, repères de numérotation à 0,95 cm (les signes de réponse sous les vignettes, règle plus récente que le corpus, sont déclarés à la même taille) ; une rupture de page explicite après JE RETIENS.
Décision de Karimou Ba : la mise en forme « production et typographie » déclare ces valeurs, et son paragraphe TYPOGRAPHIE dit désormais ce qui est fait. La déclaration antérieure (corps 12 pt, titre Avenir Black 16 pt, étiquettes 11 pt) relevait le modèle du Ministère et n'a été appliquée par aucune leçon livrée : à ces corps, aucune ne tient en deux pages. Les leçons 1 à 20 sont la référence dont la mesure fait foi ; un test tient les plafonds déclarés sous les valeurs livrées.
`;

const graph = JSON.parse(readFileSync(resolve(graphPath), "utf8"));
const titleOf = (n) => String(n?.properties?.description ?? "").split("\n")[0].trim();
const byLabel = (label, re) => graph.nodes.find((n) => (n.labels ?? []).includes(label) && re.test(titleOf(n)));
const fmt = byLabel("Formatter", FORMATTER);
const spec = byLabel("FormatterSpec", SPEC);
const tlm = byLabel("TeachingLearningMaterial", DOCUMENT);
if (!fmt || !spec || !tlm) { console.error("anchor nodes missing", { fmt: !!fmt, spec: !!spec, tlm: !!tlm }); process.exit(1); }
if (fmt.properties.render) { console.error("the formatter already carries a render bag — this script writes a first one"); process.exit(1); }

const problems = validateRenderSpec(RENDER, "align-pupil-geometry");
if (problems.length) { console.error("render bag refused by the schema:\n" + problems.join("\n")); process.exit(1); }

const content = String(spec.properties.content);
const start = content.indexOf(OLD_START);
const end = content.indexOf(OLD_END);
if (start < 0 || end < 0 || end < start) { console.error("typography paragraph not found where expected"); process.exit(1); }
const replaced = content.slice(start, end);

fmt.properties.render = RENDER;
spec.properties.content = content.slice(0, start) + NEW_TYPOGRAPHY + content.slice(end);
const journal = String(tlm.properties.metadata?.journal ?? "").trimEnd();
tlm.properties.metadata = { ...tlm.properties.metadata, journal: (journal || `# Journal — ${titleOf(tlm)}`) + "\n\n" + JOURNAL_ENTRY };

console.log(`formatter « ${titleOf(fmt)} »: render bag written (${JSON.stringify(RENDER).length} chars, schema OK)`);
console.log(`spec « ${titleOf(spec)} »: typography paragraph replaced (${replaced.length} → ${NEW_TYPOGRAPHY.length} chars)`);
console.log(`document « ${titleOf(tlm)} »: journal entry appended (${JOURNAL_ENTRY.length} chars)`);
console.log("\n── replaced paragraph ──\n" + replaced.trim());
if (outPath) { writeFileSync(resolve(outPath), JSON.stringify(graph, null, 2)); console.log(`\nwritten to ${outPath}`); } else console.log("\ndry run — pass --out to write.");
