/*
 * CI maths: one teaching lesson wrongly labelled `Assessment`
 *
 * "se repérer dans la semaine : les jours de la semaine" (metadata.order 104) is a
 * taught lesson, not a bilan. Its source record carries `educationalUse:
 * "Assessment"` — a data-entry error — so the bilan migration (#210) faithfully
 * relabelled it `Assessment` and stripped its `position` along with the 24 real
 * bilans. This puts it back and fixes the source field that caused it.
 *
 * The node is selected by what actually separates a bilan from a lesson HERE: a
 * bilan aligns to a spine standard titled "Bilan du chapitre N"; a lesson aligns to
 * an ordinary objective. This one aligns to a `Mesure` objective, and it is the only
 * `Assessment` that does. That is data, not a title heuristic on the node itself —
 * the same distinction the graph guide tells authors to trust.
 *
 * Transforms a raw LC envelope in place: run it on an `export-kg` dump, then feed the
 * result back with `import-kg --replace-published`. Re-runnable (bails when there is
 * nothing left to migrate).
 *
 * Run: node scripts/migrate-order-104-lesson.mjs <graph.json> [--dry]
 */
import { readFileSync, writeFileSync } from "node:fs";

const [graphPath] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const DRY = process.argv.includes("--dry");

if (!graphPath) {
  console.error("usage: node scripts/migrate-order-104-lesson.mjs <graph.json> [--dry]");
  process.exit(1);
}

const graph = JSON.parse(readFileSync(graphPath, "utf8"));
const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
const labelOf = (node) => node?.labels?.[0];
const describe = (node) => node?.properties?.description ?? node?.id;

const isBilanTitled = (text) => /^Bilan/i.test(text ?? "");

// A node's first alignment IS its objective — every Lesson and Assessment here has
// exactly one, so there is no ambiguity to resolve.
const alignedStandard = new Map();
for (const rel of graph.relationships) {
  if (rel.type === "hasEducationalAlignment" && !alignedStandard.has(rel.start)) {
    alignedStandard.set(rel.start, nodeById.get(rel.end));
  }
}

const assessments = graph.nodes.filter((node) => labelOf(node) === "Assessment");
const misfiled = assessments.filter((node) => !isBilanTitled(describe(alignedStandard.get(node.id))));

if (misfiled.length === 0) {
  console.error("Refusing to run: every Assessment aligns to a bilan standard (already migrated?).");
  process.exit(1);
}

// ── Safety: prove this is the shape the script was written for ───────────────
const problems = [];

if (misfiled.length > 1) {
  problems.push(`expected ONE misfiled assessment, found ${misfiled.length} — inspect before migrating`);
}

for (const node of misfiled) {
  const order = node.properties?.metadata?.order;
  const standard = alignedStandard.get(node.id);

  if (typeof order !== "number") {
    problems.push(`${describe(node)}: no metadata.order — it would lose its place in the course sequence`);
  }
  if (isBilanTitled(describe(node))) {
    problems.push(`${describe(node)}: titled like a bilan — the alignment and the title disagree, so check by hand`);
  }
  if (standard == null) {
    problems.push(`${describe(node)}: aligns to nothing — cannot tell a lesson from a bilan without its objective`);
  }
  // A lesson lives in the content tree under its week, exactly like the bilan did.
  const parents = graph.relationships.filter((rel) => rel.type === "hasPart" && rel.end === node.id);
  if (parents.length !== 1) {
    problems.push(`${describe(node)}: has ${parents.length} containment parents, expected exactly 1`);
  }
}

if (problems.length > 0) {
  console.error(`Refusing to run — ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}

// ── Put it back the way a lesson looks ──────────────────────────────────────
for (const node of misfiled) {
  node.labels = ["Lesson"];
  node.properties.normalizedType = "Lesson";
  // The ordinal #210 deleted. Maths lessons carry position == metadata.order, so the
  // course sequence is what restores it.
  node.properties.position = node.properties.metadata.order;
  // The root error. Left as "Assessment", parseGraph would set isAssessment on a
  // Lesson and the next migration would relabel it right back.
  node.properties.educationalUse = "Instruction";
}

// ── Post-conditions — refuse to write a graph that is still wrong ────────────
const afterFix = [];
for (const node of graph.nodes.filter((n) => labelOf(n) === "Assessment")) {
  if (!isBilanTitled(describe(alignedStandard.get(node.id)))) {
    afterFix.push(`${describe(node)} is still an Assessment aligned to a non-bilan objective`);
  }
}
for (const node of misfiled) {
  if (node.properties.educationalUse === "Assessment") {
    afterFix.push(`${describe(node)} still carries educationalUse "Assessment" — it would parse as a bilan again`);
  }
}
if (afterFix.length > 0) {
  console.error("Refusing to write — the transform left the graph wrong:");
  for (const problem of afterFix) console.error(`  · ${problem}`);
  process.exit(1);
}

for (const node of misfiled) {
  console.log(`${DRY ? "[dry] " : ""}Assessment → Lesson: "${describe(node)}" (order ${node.properties.metadata.order}, position restored, educationalUse → Instruction)`);
}

if (DRY) {
  console.log("[dry] no file written");
} else {
  writeFileSync(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
  console.log(`wrote ${graphPath}`);
}
