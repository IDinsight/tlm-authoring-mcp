/*
 * Bilan lessons become canonical `Assessment` nodes
 *
 * A CI-maths end-of-chapter bilan was a `Lesson` carrying `educationalUse:
 * "Assessment"` — valid-ish (the enum allows it) but LC has a first-class
 * `Assessment` label, so the node mis-described itself. This relabels them.
 *
 * Nothing moves: `LessonGrouping ─hasPart→ Assessment` and `Assessment
 * ─hasEducationalAlignment→ SFI` are both canonical, so the existing edges stay
 * exactly as they are. Two property changes ride along:
 *   - `normalizedType` follows the label (the parser reads the label, but the
 *     stored mirror would otherwise still say "Lesson");
 *   - `position` is DROPPED — canonical `Assessment` has no ordinal field. Maths
 *     sequences from `metadata.order` (its profile's numberFrom is "order"), which
 *     mirrors the same number, so ordering is unaffected. The script refuses to run
 *     if any bilan lacks that mirror.
 *
 * Transforms a raw LC envelope in place: run it on an `export-kg` dump, then feed
 * the result back with `import-kg --replace-published`. Re-runnable (bails when
 * there is nothing left to migrate).
 *
 * Run: node scripts/migrate-bilan-assessment.mjs <graph.json> [--dry]
 */
import { readFileSync, writeFileSync } from "node:fs";

const [graphPath] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const DRY = process.argv.includes("--dry");

if (!graphPath) {
  console.error("usage: node scripts/migrate-bilan-assessment.mjs <graph.json> [--dry]");
  process.exit(1);
}

const graph = JSON.parse(readFileSync(graphPath, "utf8"));
const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

const isBilanLesson = (node) =>
  (node.labels ?? []).length === 1 &&
  node.labels[0] === "Lesson" &&
  node.properties?.educationalUse === "Assessment";

const bilans = graph.nodes.filter(isBilanLesson);
if (bilans.length === 0) {
  console.error("Refusing to run: no Lesson carries educationalUse 'Assessment' (already migrated?).");
  process.exit(1);
}

// ── Safety checks — all must pass before a single node is touched ────────────
// Canon allows `Assessment ─hasPart→ Material` and nothing else below it, and
// allows it to hang under a Lesson or LessonGrouping. Anything outside that would
// become an illegal edge the moment the label changes, so refuse rather than
// quietly produce an off-canon graph.
const LEGAL_PARENT_LABELS = new Set(["Lesson", "LessonGrouping"]);
const problems = [];

for (const bilan of bilans) {
  const title = bilan.properties?.description ?? bilan.id;

  const hasOrderMirror = typeof bilan.properties?.metadata?.order === "number";
  if (!hasOrderMirror) {
    problems.push(`${title}: no metadata.order — dropping 'position' would lose its place in the week`);
  }

  for (const rel of graph.relationships) {
    if (rel.type === "hasPart" && rel.start === bilan.id) {
      const childLabel = nodeById.get(rel.end)?.labels?.[0];
      if (childLabel !== "Material") {
        problems.push(`${title}: has a ${childLabel} child — an Assessment may only contain Material`);
      }
    }
    if (rel.type === "hasPart" && rel.end === bilan.id) {
      const parentLabel = nodeById.get(rel.start)?.labels?.[0];
      if (!LEGAL_PARENT_LABELS.has(parentLabel)) {
        problems.push(`${title}: sits under a ${parentLabel} — an Assessment may only hang under a Lesson or LessonGrouping`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`Refusing to run — ${problems.length} node(s) would become off-canon:`);
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}

// ── Apply ───────────────────────────────────────────────────────────────────
for (const bilan of bilans) {
  bilan.labels = ["Assessment"];
  bilan.properties.normalizedType = "Assessment";
  delete bilan.properties.position;
}

console.log(`${DRY ? "[dry] " : ""}relabelled ${bilans.length} bilan Lesson(s) → Assessment`);
for (const bilan of bilans.slice(0, 3)) {
  console.log(`   e.g. ${bilan.properties.description} (order ${bilan.properties.metadata.order})`);
}

if (DRY) {
  console.log("[dry] no file written");
} else {
  writeFileSync(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
  console.log(`wrote ${graphPath}`);
}
