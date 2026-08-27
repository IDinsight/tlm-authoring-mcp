/*
 * Fold a routine's text onto the routine nodes themselves, and drop the Materials
 *
 * A routine's prose lived in two places a reader had to know about: the root's
 * `metadata.summary` (cross-cutting rules) and a `Material` child's `content` (each
 * step's script). After this, every routine node carries its own text in
 * `description` and no `Material` hangs under a routine at all.
 *
 * The two subjects shaped their routines differently, so the transform handles both:
 *
 *   ci/maths (nested)          ce1/reading (flat)
 *   root ─ summary             root ─ summary
 *     └ step (routine)           ├ Material  ← the step ITSELF
 *         └ Material  ← spec     └ Material
 *
 * A Material under a STEP is that step's spec → fold it into the step and delete it.
 * A Material under a ROOT is a step in its own right → PROMOTE it to an
 * InstructionalRoutine so the step survives as a node, then delete nothing. Folding a
 * root's Materials into the root instead would collapse four or five separate steps
 * into one blob.
 *
 * CATALOG SAFETY: in a catalog library, formatters and rubrics use this same
 * `InstructionalRoutine + Material` shape and a formatter only becomes a
 * `FormatterSpec` when use_formatter RELABELS its Materials on the way out. Stripping
 * those would break it. Entry kind is read with the same rule the server uses
 * (kg-recipes/catalog.ts::kindOf) so the two cannot drift: metadata.catalogKind
 * "rubric"/"formatter", or metadata.role "formatter" — anything else is a routine.
 *
 * Transforms a raw LC envelope in place: run it on an `export-kg` dump, then feed the
 * result back with `import-kg --replace-published`. Re-runnable (bails when there is
 * nothing left to migrate).
 *
 * Run: node scripts/migrate-routine-materials-inline.mjs <graph.json> [--dry]
 */
import { readFileSync, writeFileSync } from "node:fs";

const [graphPath] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const DRY = process.argv.includes("--dry");

if (!graphPath) {
  console.error("usage: node scripts/migrate-routine-materials-inline.mjs <graph.json> [--dry]");
  process.exit(1);
}

const ROUTINE_LABEL = "InstructionalRoutine";
const MATERIAL_LABEL = "Material";
const CONTAINMENT = "hasPart";

const graph = JSON.parse(readFileSync(graphPath, "utf8"));
const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

const labelsOf = (node) => node?.labels ?? [];
const isRoutine = (node) => labelsOf(node).includes(ROUTINE_LABEL);
const isMaterial = (node) => labelsOf(node).includes(MATERIAL_LABEL);
const describe = (node) => node?.properties?.description ?? node?.id;
const metaOf = (node) => node?.properties?.metadata ?? {};

// Mirrors kg-recipes/catalog.ts::kindOf. An untagged entry is a routine — that is how
// the seeded shared library reads, so the default must stay "routine".
const kindOf = (node) => {
  const meta = metaOf(node);
  if (meta.catalogKind === "rubric") return "rubric";
  if (meta.catalogKind === "formatter" || meta.role === "formatter") return "formatter";
  return "routine";
};

const childrenOf = (id) =>
  graph.relationships.filter((rel) => rel.type === CONTAINMENT && rel.start === id).map((rel) => nodeById.get(rel.end)).filter(Boolean);

const routineParentOf = (id) =>
  graph.relationships
    .filter((rel) => rel.type === CONTAINMENT && rel.end === id)
    .map((rel) => nodeById.get(rel.start))
    .find(isRoutine);

// A root is a routine no other routine contains.
const routineRoots = graph.nodes.filter((node) => isRoutine(node) && routineParentOf(node.id) === undefined);
const targets = routineRoots.filter((root) => kindOf(root) === "routine");
const skipped = routineRoots.filter((root) => kindOf(root) !== "routine");

// ── Plan the whole change before touching anything ──────────────────────────
const problems = [];
const summariesToFold = [];   // roots carrying metadata.summary
const materialsToFold = [];   // { material, step }  — spec under a step
const materialsToPromote = []; // Material that IS a step, under a root

for (const root of targets) {
  if (typeof metaOf(root).summary === "string" && metaOf(root).summary.length > 0) {
    summariesToFold.push(root);
  }

  for (const child of childrenOf(root.id)) {
    if (isRoutine(child)) {
      const specs = childrenOf(child.id).filter(isMaterial);
      const nested = childrenOf(child.id).filter(isRoutine);
      if (nested.length > 0) {
        problems.push(`"${describe(child)}": a step containing further steps — deeper than this transform handles`);
      }
      for (const spec of specs) materialsToFold.push({ material: spec, step: child });
    } else if (isMaterial(child)) {
      materialsToPromote.push({ material: child, root });
    } else {
      problems.push(`"${describe(root)}": unexpected child "${describe(child)}" (${labelsOf(child).join("/")})`);
    }
  }
}

if (summariesToFold.length === 0 && materialsToFold.length === 0 && materialsToPromote.length === 0) {
  console.error("Refusing to run: no routine summaries or Materials left to fold (already migrated?).");
  process.exit(1);
}

// A Material must belong to exactly one parent, or folding it into that parent moves
// text out from under a second owner that still expects it.
for (const { material } of [...materialsToFold, ...materialsToPromote]) {
  const parents = graph.relationships.filter((rel) => rel.type === CONTAINMENT && rel.end === material.id);
  if (parents.length !== 1) {
    problems.push(`"${describe(material)}": has ${parents.length} parents, expected exactly 1`);
  }
  if (typeof material.properties?.content !== "string" || material.properties.content.length === 0) {
    problems.push(`"${describe(material)}": no content to fold`);
  }
  if (childrenOf(material.id).length > 0) {
    problems.push(`"${describe(material)}": has children of its own, which would be orphaned`);
  }
}

if (problems.length > 0) {
  console.error(`Refusing to run — ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}

/** Append `text` under the node's existing description, keeping the name as line 1. */
function appendToDescription(node, text) {
  const existing = typeof node.properties.description === "string" ? node.properties.description : "";
  node.properties.description = existing.length > 0 ? `${existing}\n\n${text}` : text;
}

// ── 1. The root's cross-cutting rules ───────────────────────────────────────
for (const root of summariesToFold) {
  appendToDescription(root, root.properties.metadata.summary);
  delete root.properties.metadata.summary;
}

// ── 2. A spec Material folds into the step it describes ─────────────────────
for (const { material, step } of materialsToFold) {
  appendToDescription(step, material.properties.content);
}

// ── 3. A Material that IS a step becomes one ────────────────────────────────
// Material-only fields go; identity fields are copied from the root so the promoted
// step matches the graph's own routines rather than a shape invented here.
const MATERIAL_ONLY_PROPS = ["content", "materialType", "name", "audience", "educationalUse", "providerDateCreated", "providerDateModified"];

for (const { material, root } of materialsToPromote) {
  appendToDescription(material, material.properties.content);
  material.labels = [ROUTINE_LABEL];

  for (const prop of MATERIAL_ONLY_PROPS) delete material.properties[prop];

  const rootNormalized = root.properties.normalizedType;
  if (typeof rootNormalized === "string") {
    material.properties.normalizedType = rootNormalized;
  } else {
    delete material.properties.normalizedType;
  }
  if (material.properties.metadata?.role !== undefined) {
    material.properties.metadata.role = metaOf(root).role ?? "instructional-routine";
  }
}

// ── 4. Drop the folded Materials and every edge touching them ───────────────
const foldedIds = new Set(materialsToFold.map(({ material }) => material.id));
graph.nodes = graph.nodes.filter((node) => !foldedIds.has(node.id));
const edgesBefore = graph.relationships.length;
graph.relationships = graph.relationships.filter((rel) => !foldedIds.has(rel.start) && !foldedIds.has(rel.end));

// ── Post-conditions — refuse to write a graph that is still wrong ───────────
const afterFix = [];
for (const root of targets) {
  if (metaOf(root).summary !== undefined) afterFix.push(`"${describe(root)}" still carries metadata.summary`);
}
for (const node of graph.nodes.filter(isMaterial)) {
  if (routineParentOf(node.id) !== undefined) {
    afterFix.push(`"${describe(node)}" is still a Material under a routine`);
  }
}
for (const rel of graph.relationships) {
  if (!nodeById.has(rel.start) || !nodeById.has(rel.end)) continue; // untouched by us
  if (foldedIds.has(rel.start) || foldedIds.has(rel.end)) afterFix.push(`edge ${rel.id} still points at a deleted Material`);
}
if (afterFix.length > 0) {
  console.error("Refusing to write — the transform left the graph wrong:");
  for (const problem of afterFix) console.error(`  · ${problem}`);
  process.exit(1);
}

const tag = DRY ? "[dry] " : "";
console.log(`${tag}routine entries: ${targets.length} migrated, ${skipped.length} skipped (${skipped.map((n) => kindOf(n)).join(", ") || "none"})`);
console.log(`${tag}summaries folded into description: ${summariesToFold.length}`);
console.log(`${tag}spec Materials folded into their step + deleted: ${materialsToFold.length}`);
console.log(`${tag}Materials promoted to routine steps: ${materialsToPromote.length}`);
console.log(`${tag}nodes ${graph.nodes.length + foldedIds.size} → ${graph.nodes.length}, edges ${edgesBefore} → ${graph.relationships.length}`);

if (DRY) {
  console.log("[dry] no file written");
} else {
  writeFileSync(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
  console.log(`wrote ${graphPath}`);
}
