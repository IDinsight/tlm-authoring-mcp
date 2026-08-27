/*
 * CE1 reading: the last two off-canon `hasChild` shapes
 *
 * `hasChild` nests the STANDARDS tree only — it may never point at content, and
 * content may never point back. Reading still had both, left from before its
 * content Course existed. Two fixes, independent of each other:
 *
 * 1. `Palier ─hasChild→ Semaine` (×21). Since the Course landed, every week
 *    already hangs under it by `hasPart`, so this edge no longer carries
 *    containment — only "this week belongs to palier N". Reversed into the
 *    canonical content→standards bridge: `Semaine ─hasEducationalAlignment→
 *    Palier`. Read-model neutral: parseGraph folds alignment edges into the
 *    hierarchy exactly like containment, so the week keeps the same place. The
 *    22nd such edge belongs to fix 2's node, not to a real week — see below.
 *
 * 2. `"1 à 8" ─hasChild→ SFI` (×3). "1 à 8" is not a week at all — it is a
 *    référentiel row covering weeks 1–8 that lists three standards, mislabelled
 *    `LessonGrouping` with `groupName "Semaine"`. Relabelled to
 *    `StandardsFrameworkItem`, which makes its own parent edge, all three child
 *    edges, and its place in the standards tree canonical in one move. Its
 *    `Course ─hasPart→` edge goes with it (a Course may not hold a standard) —
 *    which also removes a phantom empty 23rd week from the teacher's guide.
 *
 * Transforms a raw LC envelope in place: run it on an `export-kg` dump, then feed
 * the result back with `import-kg --replace-published`. Re-runnable (bails when
 * there is nothing left to migrate).
 *
 * Run: node scripts/migrate-reading-off-canon-edges.mjs <graph.json> [--dry]
 */
import { readFileSync, writeFileSync } from "node:fs";

const [graphPath] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const DRY = process.argv.includes("--dry");

if (!graphPath) {
  console.error("usage: node scripts/migrate-reading-off-canon-edges.mjs <graph.json> [--dry]");
  process.exit(1);
}

const graph = JSON.parse(readFileSync(graphPath, "utf8"));
const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
const labelOf = (id) => nodeById.get(id)?.labels?.[0];
const d = (id) => nodeById.get(id)?.properties?.description ?? id;

const contentToStandard = graph.relationships.filter(
  (rel) => rel.type === "hasChild" && labelOf(rel.start) === "LessonGrouping" && labelOf(rel.end) === "StandardsFrameworkItem",
);

// The groupings fix 2 turns into standards rows. Fix 1 must SKIP their incoming
// edges: "1 à 8" still looks like a LessonGrouping here, so reversing its parent
// edge would leave a standards row aligned to another standards row (off-canon)
// with no containment parent at all. Its parent edge is already canonical
// SFI→SFI once the label changes, so it needs no work.
const mislabelledIds = new Set(contentToStandard.map((edge) => edge.start));

const weekEdges = graph.relationships.filter(
  (rel) =>
    rel.type === "hasChild" &&
    labelOf(rel.start) === "StandardsFrameworkItem" &&
    labelOf(rel.end) === "LessonGrouping" &&
    !mislabelledIds.has(rel.end),
);

if (weekEdges.length === 0 && contentToStandard.length === 0) {
  console.error("Refusing to run: no off-canon hasChild edges left (already migrated?).");
  process.exit(1);
}

// ── Safety: a week may only lose this edge if the Course already holds it ────
// Dropping containment from a week that has no other parent would strand it and
// every day and session beneath it.
const problems = [];
const hasCourseParent = (weekId) =>
  graph.relationships.some((rel) => rel.type === "hasPart" && rel.end === weekId && labelOf(rel.start) === "Course");

for (const edge of weekEdges) {
  const week = nodeById.get(edge.end);
  if (!hasCourseParent(edge.end)) {
    problems.push(`Semaine ${week?.properties?.description}: no Course parent — converting its hasChild would strand it`);
  }
}

// Every content→standard edge must come from the one known référentiel row. A
// second such node would mean a shape this script has not been told about.
if (mislabelledIds.size > 1) {
  problems.push(`expected ONE mislabelled grouping, found ${mislabelledIds.size} — inspect before migrating`);
}

if (problems.length > 0) {
  console.error(`Refusing to run — ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}

// ── 1. Palier ─hasChild→ Semaine  ⇒  Semaine ─hasEducationalAlignment→ Palier ─
for (const edge of weekEdges) {
  const palierId = edge.start;
  const weekId = edge.end;

  edge.type = "hasEducationalAlignment";
  edge.start = weekId;
  edge.end = palierId;
  // The edge's own descriptive fields still describe a hasChild; re-point the
  // ones a re-export would otherwise contradict.
  if (edge.properties) {
    edge.properties.description = "A hasEducationalAlignment relationship links content to the standards item it teaches.";
    edge.properties.relationshipType = "hasEducationalAlignment";
    delete edge.properties.orderIndex; // an alignment carries no ordinal
  }
}

// ── 2. "1 à 8" is a standards row, not a week ───────────────────────────────
for (const nodeId of mislabelledIds) {
  const node = nodeById.get(nodeId);
  node.labels = ["StandardsFrameworkItem"];

  // `kindOf` reads groupName FIRST, so leaving it would keep this parsing as a
  // "Semaine" no matter what the label says. Its kind then falls to
  // statementType ("activités"), like every other reading standards row.
  delete node.properties.groupName;
  delete node.properties.groupLevel;
  delete node.properties.normalizedType; // reading's standards items carry none
  // metadata.role said "week", which was never true. Drop it rather than invent
  // a replacement — the parser stopped reading roles anyway.
  if (node.properties.metadata) delete node.properties.metadata.role;
}

// A Course may hold LessonGroupings and Materials, never a standard.
const strandedCourseEdges = graph.relationships.filter(
  (rel) => rel.type === "hasPart" && mislabelledIds.has(rel.end),
);
graph.relationships = graph.relationships.filter((rel) => !strandedCourseEdges.includes(rel));

// ── Post-conditions — the two fixes above touch overlapping edges, so prove
// they did not collide rather than trusting the selection above.
const afterFix = [];
for (const rel of graph.relationships) {
  if (rel.type === "hasEducationalAlignment" && labelOf(rel.start) === "StandardsFrameworkItem") {
    afterFix.push(`${d(rel.start)} aligns to a standard — alignment runs content→standards only`);
  }
}
for (const nodeId of mislabelledIds) {
  const hasParent = graph.relationships.some((rel) => rel.type === "hasChild" && rel.end === nodeId);
  if (!hasParent) afterFix.push(`${d(nodeId)} has no containment parent left`);
}
if (afterFix.length > 0) {
  console.error("Refusing to write — the transform left the graph off-canon:");
  for (const problem of afterFix) console.error(`  · ${problem}`);
  process.exit(1);
}

console.log(`${DRY ? "[dry] " : ""}reversed ${weekEdges.length} Palier→Semaine edges into hasEducationalAlignment`);
console.log(`${DRY ? "[dry] " : ""}relabelled ${mislabelledIds.size} grouping → StandardsFrameworkItem (${contentToStandard.length} child edges now canonical)`);
console.log(`${DRY ? "[dry] " : ""}dropped ${strandedCourseEdges.length} Course hasPart edge(s) to it`);

if (DRY) {
  console.log("[dry] no file written");
} else {
  writeFileSync(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
  console.log(`wrote ${graphPath}`);
}
