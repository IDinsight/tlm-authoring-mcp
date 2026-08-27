/*
 * CI maths: four bilans still labelled `Lesson`
 *
 * The spine holds 28 standards titled "Bilan …", each with exactly one content node
 * aligned to it. Twenty-four of those are `Assessment`; four are still `Lesson` with
 * `educationalUse: "Instruction"`. Three are palier-integration bilans ("Bilan des
 * chapitres 1 et 5 (intégration du palier 1)") and one is a chapter bilan; all four
 * are assessments the bilan migration (#210) could not see, because it selected on
 * `educationalUse` and their source records carry the wrong value.
 *
 * This is the mirror of migrate-order-104-lesson.mjs: there, a lesson's source said
 * "Assessment" and the title gave it away; here, a bilan's source says "Instruction"
 * and the alignment gives it away.
 *
 * SAFETY: only relabel when the node's OWN title and its aligned standard BOTH say
 * "Bilan". When they disagree, the node is the order-104 case — a teaching lesson
 * wrongly aligned, or wrongly titled — and a script must not guess which. Refuse and
 * let a human look.
 *
 * Transforms a raw LC envelope in place: run it on an `export-kg` dump, then feed the
 * result back with `import-kg --replace-published`. Re-runnable (bails when there is
 * nothing left to migrate).
 *
 * Run: node scripts/migrate-bilan-lessons-to-assessment.mjs <graph.json> [--dry]
 */
import { readFileSync, writeFileSync } from "node:fs";

const [graphPath] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const DRY = process.argv.includes("--dry");

if (!graphPath) {
  console.error("usage: node scripts/migrate-bilan-lessons-to-assessment.mjs <graph.json> [--dry]");
  process.exit(1);
}

const graph = JSON.parse(readFileSync(graphPath, "utf8"));
const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
const labelOf = (node) => node?.labels?.[0];
const describe = (node) => node?.properties?.description ?? node?.id;

const isBilanTitled = (text) => /^Bilan/i.test(text ?? "");

const alignedStandard = new Map();
for (const rel of graph.relationships) {
  if (rel.type === "hasEducationalAlignment" && !alignedStandard.has(rel.start)) {
    alignedStandard.set(rel.start, nodeById.get(rel.end));
  }
}

const lessons = graph.nodes.filter((node) => labelOf(node) === "Lesson");
const bilanAligned = lessons.filter((node) => isBilanTitled(describe(alignedStandard.get(node.id))));

if (bilanAligned.length === 0) {
  console.error("Refusing to run: no Lesson aligns to a bilan standard (already migrated?).");
  process.exit(1);
}

// ── Safety: title and alignment must agree before anything is relabelled ─────
const problems = [];

for (const node of bilanAligned) {
  const standard = alignedStandard.get(node.id);

  if (!isBilanTitled(describe(node))) {
    problems.push(
      `"${describe(node)}": aligned to bilan standard "${describe(standard)}" but not titled as a bilan — ` +
        `title and alignment disagree, so this is a human call, not a relabel`,
    );
  }
  if (typeof node.properties?.metadata?.order !== "number") {
    problems.push(`"${describe(node)}": no metadata.order — an Assessment's only ordinal, so it would lose its place`);
  }
  const parents = graph.relationships.filter((rel) => rel.type === "hasPart" && rel.end === node.id);
  if (parents.length !== 1) {
    problems.push(`"${describe(node)}": has ${parents.length} containment parents, expected exactly 1`);
  }
}

if (problems.length > 0) {
  console.error(`Refusing to run — ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}

// ── Make them look like the 24 bilans that were already right ───────────────
for (const node of bilanAligned) {
  node.labels = ["Assessment"];
  node.properties.normalizedType = "Assessment";
  // The source field that hid them from #210. Without this they parse as ordinary
  // lessons no matter what the label says.
  node.properties.educationalUse = "Assessment";
  // Canonical `Assessment` carries no ordinal — its place comes from metadata.order,
  // exactly as it does for the other 24.
  delete node.properties.position;
}

// ── Post-conditions — refuse to write a graph that is still wrong ────────────
const afterFix = [];
for (const node of graph.nodes.filter((n) => labelOf(n) === "Lesson")) {
  if (isBilanTitled(describe(alignedStandard.get(node.id)))) {
    afterFix.push(`"${describe(node)}" is still a Lesson aligned to a bilan standard`);
  }
}
for (const node of bilanAligned) {
  if (node.properties.position !== undefined) {
    afterFix.push(`"${describe(node)}" kept its position — an Assessment carries none`);
  }
}
if (afterFix.length > 0) {
  console.error("Refusing to write — the transform left the graph wrong:");
  for (const problem of afterFix) console.error(`  · ${problem}`);
  process.exit(1);
}

for (const node of bilanAligned) {
  console.log(`${DRY ? "[dry] " : ""}Lesson → Assessment: "${describe(node)}" (order ${node.properties.metadata.order})`);
}

if (DRY) {
  console.log("[dry] no file written");
} else {
  writeFileSync(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
  console.log(`wrote ${graphPath}`);
}
