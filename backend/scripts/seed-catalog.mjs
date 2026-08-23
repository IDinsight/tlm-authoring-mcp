#!/usr/bin/env node
/*
 * Idempotent seed for the SHARED reusable-spec catalog (a cross-context library, not a
 * subject graph): every subject's routine subtrees (extracted from the installed
 * sources; non-routine content dropped) plus the workspace-agnostic formatters and
 * rubrics (house style, Senegalese art style, Annexe 7). Same slot/pointer discipline
 * as an import — slot "a", fixed ids, so a re-seed overwrites the same docs.
 *
 * Today only CI maths carries routines (the two "Fiche de leçon" + "Structure d'un
 * chapitre" entries), so that is what seeds; any subject that later gains routines is
 * picked up automatically.
 *
 * WORKSPACE libraries are NOT seeded. Their entries are authored live through
 * add_to_catalog and exist nowhere in this repo, so a seed could only ever delete them
 * — which is exactly what a run on 2026-08-22 did to 19 senegal entries. They are
 * backed up as snapshots (imports/<ws>/_catalog/routines/) and restored with
 * `import-kg --raw`. Nothing here writes a workspace namespace any more.
 *
 * SAFETY: seeding REWRITES a namespace — anything in the slot that is not in the batch
 * is deleted. The guard below still refuses to write a namespace whose live entries are
 * not all in the batch, naming what it would have destroyed; `--force` overrides.
 *
 * Usage:
 *   npm run build                         # compile TS to dist/ first
 *   node scripts/seed-catalog.mjs         # seed the catalog (Firestore)
 *   node scripts/seed-catalog.mjs --dry-run   # in-memory store; no writes, prints a summary
 *   node scripts/seed-catalog.mjs --force     # write even if live entries would be deleted
 *
 * Env: same Firebase auth as seed-kg-store (SERVICE_ACCOUNT_KEY_PATH / _JSON,
 * FIREBASE_STORAGE_BUCKET, TLM_SOURCES_DIR, TLM_BUCKET_PREFIX).
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(REPO, "dist");
if (!existsSync(DIST)) {
  console.error("seed-catalog: dist/ not found — run `npm run build` first.");
  process.exit(1);
}

const { createMemoryKgStore, createFirestoreKgStore } = await import(new URL("../dist/kg-store/index.js", import.meta.url));
// The KG lives only in the store now, so the routine subtrees are scraped from
// the committed test/fixtures/ graphs (the same graphs, as plain data). Scan the
// fixtures tree for every <workspace>/<grade>/<subject>/knowledge_graph.json.
const FIXTURES = resolve(REPO, "test/fixtures");
function fixtureGraphs() {
  const out = [];
  if (!existsSync(FIXTURES)) return out;
  for (const ws of readdirSync(FIXTURES)) {
    for (const grade of readdirSync(resolve(FIXTURES, ws))) {
      for (const subject of readdirSync(resolve(FIXTURES, ws, grade))) {
        const p = resolve(FIXTURES, ws, grade, subject, "knowledge_graph.json");
        if (existsSync(p)) out.push(p);
      }
    }
  }
  return out;
}
const { assembleCatalog, SHARED_CATALOG_NAMESPACE, CATALOG_ROOT_ID } = await import(new URL("../dist/kg-recipes/index.js", import.meta.url));

const dryRun = process.argv.slice(2).includes("--dry-run");
// Override the destroys-live-entries guard below. Deleting entries that exist only in
// the store is never accidental-safe, so it has to be asked for explicitly.
const force = process.argv.slice(2).includes("--force");

// ── Authored formatter entries ───────────────────────────────────────────────
// Formatters are catalog entries (kind=formatter) whose Material holds a house-style
// spec the generator applies. They are authored DATA (not server mechanism), so they
// live here in the seed tooling and are fed to assembleCatalog as `authored` entries —
// each a raw InstructionalRoutine + Material subtree, `catalogKind:"formatter"` on the
// entry making list_catalog report kind "formatter". The catalog machinery in
// src/kg-recipes/catalog.ts only re-homes and reads them; the content is here.
const ROUTINE_LABEL = "InstructionalRoutine";
const MATERIAL_LABEL = "Material";

// The verbatim art-look block — must reach an image prompt UNCHANGED (pasting the same
// paragraph at the start of every generate_image call is what keeps a whole book, and
// every book in the workspace, looking like one hand). Kept as its own constant so the
// Material below and any check assert against the same text.
const HOUSE_ART_STYLE_BLOCK = [
  "STYLE GRAPHIQUE : illustration vectorielle 2-D à plat, façon dessin animé, pour",
  "un manuel scolaire pour enfants. Contours brun foncé, nets et d'épaisseur",
  "régulière autour de chaque personnage et objet ; aplats de couleurs vives et",
  "saturées avec un ombrage cel simple à deux tons (une couleur de base plus une",
  "ombre légèrement plus foncée, à bord net) ; formes nettes et épurées ; palette",
  "gaie et lumineuse. Décor sénégalais — sol sableux et chaud, ciel bleu clair,",
  "vêtements colorés en wax ; personnages aux proportions rondes et amicales, aux",
  "visages simples et expressifs ; personnages sénégalais à la peau foncée. Le",
  "rendu doit évoquer un manuel de lecture / une planche de bande dessinée",
  "d'Afrique de l'Ouest.",
  "À éviter explicitement : texture aquarelle ou peinture au pinceau, dégradés",
  "doux, traits esquissés ou irréguliers, texture crayon ou pastel, réalisme",
  "photographique, rendu 3-D, couleurs ternes ou désaturées.",
].join("\n");

// SHARED: the docx house style (palette/typography/page/compression). Subject-agnostic.
const HOUSE_STYLE_FORMATTER = {
  nodes: [
    {
      id: "formatter-house-style",
      labels: [ROUTINE_LABEL],
      properties: {
        description: "Style maison MOHEBS (docx)",
        metadata: { role: "instructional-routine", catalogKind: "formatter", summary: "À appliquer à chaque .docx généré, pour une présentation cohérente d'une matière à l'autre." },
      },
    },
    {
      id: "formatter-house-style-spec",
      labels: [MATERIAL_LABEL],
      properties: {
        description: "Spécification du style maison",
        materialType: "Reference",
        metadata: { role: "instructional-routine-material" },
        content: [
          "Style maison de tout .docx généré — à appliquer de façon cohérente d'une matière à l'autre.",
          "Palette : vert principal #2E7D5E (titres, en-têtes, étiquettes clés) ; vert clair #E8F3EE (fonds des lignes d'en-tête de section/étape) ; gris #666666 (sous-titres, lignes de méta) ; orange #D4812A (étiquettes d'encadré/de repère) ; texte blanc #FFFFFF sur les fonds verts.",
          "Typographie : Calibri partout ; corps de texte 11–12 pt ; en-têtes en gras (titre du document ~17–20 pt, section ~13–14 pt).",
          "Page : A4 portrait ; marges ≈1,7 cm haut/bas, 2,0 cm gauche/droite (≈17 cm de largeur utile) ; interligne compact (interligne simple, espacement après minimal, aucun paragraphe d'espacement vide).",
          "Images : insérer un JPEG réduit — redimensionner à ~1600 px sur le grand côté, qualité ~82 ; viser quelques Mo par document, jamais un PNG en pleine résolution.",
          "La mise en page propre à une matière (tableaux à boîtes d'étapes, colonnes bilingues, ratios des images d'activité) ne fait PAS partie de ce style partagé — elle reste dans le prompt de la matière ou dans un formatter d'espace de travail.",
        ].join("\n\n"),
      },
    },
  ],
  relationships: [
    { id: "formatter-house-style-haspart", type: "hasPart", start: "formatter-house-style", end: "formatter-house-style-spec", properties: {} },
  ],
};

// SHARED: the reusable Senegalese children's-textbook art look, split out of CI-maths's
// chapter prompt. Subject-agnostic — carries the verbatim ART STYLE block + the two
// consistency rules about the *look* (prepend it; opening scene is the master that fixes
// cast+palette, later images are independent compositions, not crops). Ratios/layout/sizes
// are NOT here — those are a subject's presentation (see MATHS_ILLUSTRATION_FORMATTER).
const HOUSE_ART_STYLE_FORMATTER = {
  nodes: [
    {
      id: "formatter-art-style",
      labels: [ROUTINE_LABEL],
      properties: {
        description: "Style graphique de manuel scolaire sénégalais (images)",
        metadata: { role: "instructional-routine", catalogKind: "formatter", summary: "À placer en tête de chaque prompt d'image généré, pour que toutes les illustrations partagent un même style maison." },
      },
    },
    {
      id: "formatter-art-style-spec",
      labels: [MATERIAL_LABEL],
      properties: {
        description: "Spécification du style graphique",
        materialType: "Reference",
        metadata: { role: "instructional-routine-material" },
        content: [
          "Style graphique maison de toute illustration générée — à appliquer de façon cohérente au sein d'un ouvrage et d'une matière à l'autre.",
          "PLACER CE BLOC TEL QUEL au DÉBUT de chaque prompt generate_image / edit_image, puis ajouter ensuite la description propre à la scène ou à l'activité. Ne pas le paraphraser — c'est la reprise mot pour mot qui empêche le générateur de dériver (par ex. vers l'aquarelle). Si le style maison change un jour, ne modifier que ce bloc.",
          "```\n" + HOUSE_ART_STYLE_BLOCK + "\n```",
          "Cohérence de la scène maîtresse : la scène d'ouverture/maîtresse du document est dessinée en premier et fixe la distribution des personnages et la palette précise ; toute autre image est une composition INDÉPENDANTE dans le même univers (mêmes personnages, objets, décor, style graphique) — et NON un recadrage, un zoom ou un détourage littéral de la scène d'ouverture. Une référence/un stimulus dont une image a besoin est une nouvelle représentation dans ce style, pas une portion d'une autre image.",
        ].join("\n\n"),
      },
    },
  ],
  relationships: [
    { id: "formatter-art-style-haspart", type: "hasPart", start: "formatter-art-style", end: "formatter-art-style-spec", properties: {} },
  ],
};

// ── Authored rubric entries (evaluation grids) ───────────────────────────────
// A rubric is a catalog entry (kind=rubric) shaped like a nested routine, one level
// deeper than a formatter: entry → SECTIONS (each weighted) → CRITERIA (Materials
// holding the measurable indicator). use_rubric relabels a copy to Rubric/
// RubricSection/RubricCriterion under a document's TLM, and evaluate_document reads
// it back. Sections and criteria are written as plain JS below and expanded by
// `rubricEntry`, because a grid is ~30 criteria and the literal form would bury the
// content under boilerplate.
//
// Content convention (as elsewhere in this file): English comments, French content.

// Expand a grid into the raw {nodes, relationships} envelope assembleCatalog takes.
// `sections` is [{ slug, name, weight?, criteria: [{ slug, name, indicator }] }];
// positions are the array order, so re-ordering the source re-orders the grid.
function rubricEntry({ id, name, summary, scale, sections }) {
  const nodes = [{
    id,
    labels: [ROUTINE_LABEL],
    properties: {
      description: name,
      metadata: { role: "instructional-routine", catalogKind: "rubric", summary, scale },
    },
  }];
  const relationships = [];

  sections.forEach((section, sectionIndex) => {
    const sectionId = `${id}-${section.slug}`;
    nodes.push({
      id: sectionId,
      labels: [ROUTINE_LABEL],
      properties: {
        description: section.name,
        position: sectionIndex + 1,
        metadata: { role: "instructional-routine", ...(section.weight ? { weight: section.weight } : {}) },
      },
    });
    relationships.push({ id: `${sectionId}-haspart`, type: "hasPart", start: id, end: sectionId, properties: {} });

    section.criteria.forEach((criterion, criterionIndex) => {
      const criterionId = `${sectionId}-${criterion.slug}`;
      nodes.push({
        id: criterionId,
        labels: [MATERIAL_LABEL],
        properties: {
          description: criterion.name,
          materialType: "Reference",
          position: criterionIndex + 1,
          metadata: { role: "instructional-routine-material" },
          content: criterion.indicator,
        },
      });
      relationships.push({ id: `${criterionId}-haspart`, type: "hasPart", start: sectionId, end: criterionId, properties: {} });
    });
  });

  return { nodes, relationships };
}

// SHARED: Annexe 7's scored grid. Only its CONTENT sections (A–F) are here — G–L
// (contrôlabilité, cohérence, adaptation contextuelle, efficience, fiabilité, éthique)
// judge the authoring TOOL and the process, not the material, and stamping them into a
// document-scoped rubric would imply this server can answer them. The kept weights are
// the source document's own, so they total 80%, not 100% — score each section, then
// renormalise over the sections actually judged.
const ANNEXE_7_RUBRIC = rubricEntry({
  id: "rubric-annexe-7-materiels",
  name: "Annexe 7 — Grille d'évaluation des matériels (sections A–F)",
  scale: "0-4",
  summary: [
    "Grille NOTÉE de la qualité didactique d'un matériel produit. Échelle 0 à 4 : 0 = inexistant ou incorrect, 1 = très insuffisant, 2 = acceptable (minimum), 3 = bon, 4 = excellent. Le score global est la moyenne pondérée des sections.",
    "Ne couvre que les sections A à F de l'Annexe 7 — celles qui portent sur le MATÉRIEL. Les sections G à L de la grille d'origine (contrôlabilité, cohérence pédagogique du dispositif, adaptation contextuelle, efficience, fiabilité, éthique et biais) évaluent l'outil de production et son usage : elles se jugent avec des personnes, pas sur un document, et ne figurent donc pas ici.",
    "Les poids retenus sont ceux de la grille d'origine et totalisent 80 % ; renormaliser sur les seules sections évaluées.",
    "Certains indicateurs supposent un test de terrain (taux de compréhension par les élèves, temps de résolution). Ils ne se déduisent pas d'une lecture du document : le déclarer explicitement plutôt que d'inventer une note.",
  ].join("\n\n"),
  sections: [
    {
      slug: "a-pertinence-didactique", name: "A. Pertinence didactique", weight: "20%",
      criteria: [
        { slug: "alignement", name: "Alignement aux objectifs", indicator: "Part des contenus alignés sur les objectifs définis. Vérifier que chaque section du document se rattache à un objectif du programme, et signaler tout contenu orphelin." },
        { slug: "progression", name: "Progression pédagogique", indicator: "Présence d'une gradation claire du simple vers le complexe, observable d'une séance à la suivante." },
        { slug: "explications", name: "Qualité des explications", indicator: "Explications structurées, en étapes explicites — et non un résultat donné sans cheminement." },
        { slug: "exemples", name: "Pertinence des exemples", indicator: "Exemples en lien direct avec la notion enseignée, et non décoratifs ou hors sujet." },
        { slug: "erreurs", name: "Anticipation des erreurs", indicator: "Les erreurs typiques des élèves sont nommées et traitées, pas seulement la démarche correcte." },
      ],
    },
    {
      slug: "b-exactitude", name: "B. Exactitude disciplinaire", weight: "15%",
      criteria: [
        { slug: "contenus", name: "Exactitude des contenus", indicator: "Part d'erreurs détectées ; l'objectif est zéro. Citer chaque erreur relevée avec sa localisation." },
        { slug: "solutions", name: "Rigueur des solutions", indicator: "Les solutions proposées sont complètes et justifiées, non tronquées." },
        { slug: "coherence", name: "Cohérence interne", indicator: "Absence de contradictions entre deux passages du même document (terminologie, valeurs, consignes)." },
      ],
    },
    {
      slug: "c-adaptation-niveau", name: "C. Adaptation au niveau", weight: "10%",
      criteria: [
        { slug: "niveau-cognitif", name: "Niveau cognitif", indicator: "Adéquation avec le niveau cible (par exemple CE1) : ni au-dessous, ni hors de portée." },
        { slug: "complexite", name: "Complexité des tâches", indicator: "Progressivité observable de la difficulté des tâches au fil du document." },
        { slug: "differenciation", name: "Différenciation", indicator: "Des variantes sont proposées (facile / moyen / difficile), ou une remédiation est prévue pour les élèves en difficulté." },
      ],
    },
    {
      slug: "d-gestion-langage", name: "D. Gestion du langage", weight: "15%",
      criteria: [
        { slug: "consignes", name: "Clarté des consignes", indicator: "Taux de compréhension par les élèves (test terrain). Non déductible du seul document : le signaler si aucun test n'est disponible, et juger à défaut la lisibilité des consignes pour l'enseignant." },
        { slug: "simplicite", name: "Simplicité linguistique", indicator: "Longueur moyenne des phrases et vocabulaire contrôlé, adaptés au niveau." },
        { slug: "vocabulaire", name: "Explicitation du vocabulaire", indicator: "Les termes techniques de la discipline sont définis (Annexe 7 : « termes mathématiques »)." },
        { slug: "multilinguisme", name: "Multilinguisme", indicator: "Possibilité L1/L2 (par exemple wolof / français) prise en charge là où le dispositif le prévoit." },
        { slug: "terminologie", name: "Cohérence terminologique", indicator: "Un même objet porte un même nom d'un bout à l'autre : absence de variations confuses." },
      ],
    },
    {
      slug: "e-qualite-taches", name: "E. Qualité des tâches", weight: "10%",
      criteria: [
        { slug: "variete", name: "Variété des exercices", indicator: "Nombre de types d'activités différents proposés ; compter les types, pas les exercices." },
        { slug: "niveau-taches", name: "Niveau cognitif des tâches", indicator: "Part de tâches de réflexion par rapport aux tâches de répétition." },
        { slug: "ancrage", name: "Ancrage réel", indicator: "Présence de contextes réels et familiers aux élèves, plutôt que d'énoncés abstraits." },
      ],
    },
    {
      slug: "f-explication-feedback", name: "F. Explication & feedback", weight: "10%",
      criteria: [
        { slug: "pas-a-pas", name: "Explication pas à pas", indicator: "Les étapes détaillées sont présentes, y compris pour l'enseignant qui remédie." },
        { slug: "feedback", name: "Feedback sur les erreurs", indicator: "Les retours sur erreur sont explicatifs : ils disent pourquoi, pas seulement que c'est faux." },
        { slug: "reformulation", name: "Reformulation", indicator: "Des explications alternatives sont proposées pour l'élève qui n'a pas compris la première." },
      ],
    },
  ],
});

// Read every installed source's raw graph (assembleCatalog keeps only the routine
// subtrees), to be spliced under the SHARED catalog with the shared formatters.
const subjectSources = [];
let subjectHashes = "";
for (const bundlePath of fixtureGraphs()) {
  const bytes = readFileSync(bundlePath);
  subjectHashes += createHash("sha256").update(bytes).digest("hex");
  const parsed = JSON.parse(bytes.toString("utf8"));
  subjectSources.push({ nodes: parsed.nodes ?? [], relationships: parsed.relationships ?? parsed.edges ?? [] });
}

// Seeding a namespace REWRITES it — store.writeSlot upserts these ids and deletes
// everything else in the slot. A workspace library normally holds entries authored
// live through add_to_catalog that this file has never seen, so the guard below
// (`entriesOnlyInStore`) refuses such a write rather than trusting the reader to
// remember. Deliver a new workspace entry with add_to_catalog through the curator
// loop; use this script for `_shared`, or fold the live entries into `authored` first.
//
// The catalog namespaces to seed. `sources` are subject graphs (scraped for their
// ROUTINE subtrees only); `authored` are the formatter literals, added whole. Keeping
// them separate is what stops a subject graph's attached formatter copies (from
// use_formatter) being re-scraped into the catalog as duplicate entries. The SHARED
// library holds the cross-tenant entries (every subject's routines + the
// workspace-agnostic formatters); each workspace library holds entries local to that
// tenant (its subject-specific layout formatters).
const catalogs = [
  { namespace: SHARED_CATALOG_NAMESPACE, adapterId: "shared-routine-catalog", sources: subjectSources, authored: [HOUSE_STYLE_FORMATTER, HOUSE_ART_STYLE_FORMATTER, ANNEXE_7_RUBRIC] },
];

const store = dryRun ? createMemoryKgStore() : createFirestoreKgStore();
let failed = false;

// The entry ids filed directly under the catalog root — what list_catalog would show.
// Works on both shapes: an assembled MutationGraph (from/to) and stored edges (from/to).
function entryIdsUnderRoot(edges) {
  return new Set(edges.filter((e) => e.type === "hasPart" && e.from === CATALOG_ROOT_ID).map((e) => e.to));
}

// THE GUARD, kept as a second line of defence. store.writeSlot rewrites the WHOLE slot:
// it upserts the batch's ids and DELETES every node not in it. Dropping the workspace
// libraries from `catalogs` above is the real fix — a run on 2026-08-22 deleted 19
// entries from senegal/_catalog/routines, recoverable only because copies survived in
// the subject graph — but the shared library can drift the same way the moment someone
// files into it with add_to_catalog.
//
// So: refuse to write any namespace whose LIVE published slot holds an entry this batch
// does not carry. Returns the ids that would be destroyed, empty when the write is safe.
async function entriesOnlyInStore(namespace, batchEdges) {
  const pointer = await store.readPointer(namespace);
  if (!pointer) return [];   // never seeded — nothing to lose
  const [liveNodes, liveEdges] = await Promise.all([
    store.listNodes(namespace, pointer.publishedSlot),
    store.listEdges(namespace, pointer.publishedSlot),
  ]);
  const describe = (id) => {
    const raw = liveNodes.find((n) => n.id === id)?.properties?.raw ?? {};
    return `${id}  ${raw.description ?? "(no description)"}`;
  };
  const batchIds = entryIdsUnderRoot(batchEdges);
  return [...entryIdsUnderRoot(liveEdges)].filter((id) => !batchIds.has(id)).map(describe);
}

for (const { namespace, adapterId, sources, authored } of catalogs) {
  const { nodes, edges } = assembleCatalog(sources, namespace, CATALOG_ROOT_ID, authored);
  const routineCount = nodes.filter((n) => (n.labels ?? []).includes("InstructionalRoutine")).length;
  const entryCount = edges.filter((e) => e.type === "hasPart" && e.from === CATALOG_ROOT_ID).length;
  // Hash the actual bytes going into this catalog: the subject-bundle hashes plus the
  // authored formatter sources, so a formatter edit changes the stamp too.
  const contentHash = createHash("sha256").update(subjectHashes + JSON.stringify(sources) + JSON.stringify(authored)).digest("hex");
  const meta = { contentHash, seededAt: new Date().toISOString(), adapterId, nodeCount: nodes.length, edgeCount: edges.length };

  console.error(`seed-catalog: backend=${store.kind}, ns='${namespace}', ${entryCount} entries, ${nodes.length} nodes, ${edges.length} edges.`);

  const wouldDestroy = await entriesOnlyInStore(namespace, edges);
  if (wouldDestroy.length && !force) {
    console.error(`seed-catalog: REFUSED '${namespace}' — ${wouldDestroy.length} live entr(y/ies) exist only in the store and would be DELETED:`);
    for (const line of wouldDestroy) console.error(`    ${line}`);
    console.error(`  These were authored through add_to_catalog and are not in this file. Add a new entry with add_to_catalog instead of seeding,`);
    console.error(`  or fold these into \`authored\` first. Pass --force only if you genuinely intend to delete them.`);
    failed = true;
    continue;
  }

  try {
    const existing = await store.readPointer(namespace);
    await store.writeSlot(namespace, "a", { nodes, edges, meta });
    await store.ensurePointer(namespace, "a");
    const after = await store.readPointer(namespace);
    const note = existing && after && after.publishedSlot !== "a"
      ? ` (WARNING: publishedSlot is '${after.publishedSlot}', not 'a' — this re-seed wrote a non-published slot)`
      : "";
    console.error(`seed-catalog: OK '${namespace}' — ${entryCount} entries, ${routineCount} routine nodes, hash=${contentHash.slice(0, 12)}…${note}`);
  } catch (e) {
    console.error(`seed-catalog: FAILED '${namespace}' — ${(e && e.message) || e}`);
    failed = true;
  }
}

if (failed) process.exit(2);
console.error("seed-catalog: done.");
