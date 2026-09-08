#!/usr/bin/env node
/*
 * Propose which printed lines of a document are QUOTATIONS — text taken from
 * what a learner sees, which a tightening pass may never shorten.
 *
 * WHY A SCRIPT AND NOT A RULE IN THE SERVER. Which lines are quotations is not
 * derivable, and the server says so rather than guessing (`documentContract` →
 * `unavailable.quotations`). The marking is AUTHORED, into
 * `render.overflow.neverShorten` plus the prefixes it names. This is the tool
 * that drafts that authoring so a person confirms a list instead of reading
 * five thousand lines — and it lives in scripts/ beside the other per-subject
 * migrations precisely because its signals ARE subject-specific.
 *
 * IT WRITES NOTHING. It prints a proposal and, with --out, saves it as JSON.
 * Applying is a separate, reviewed step.
 *
 * THREE SIGNALS, in falling confidence. The first is proof; the others are the
 * shapes the formatter's own prose describes, and both need an eye:
 *
 *   1. ON THE PUPIL'S PAGE — the same words appear in the pupil document.
 *      Proof, not inference. Measured at 546 of 3,974 printed lines on the live
 *      ci/maths guide, and it reaches only ONE of the four protected
 *      categories: the instructions actually printed for the learner.
 *
 *   2. A SPOKEN QUESTION — a line in the teacher's speech ending in a question
 *      mark. Covers the oral questions of the opening.
 *
 *   3. AN OPTIONS LIST — a spoken line offering choices separated by "·".
 *      ADDED AFTER THE PILOT, which is the whole reason to pilot: on lesson 11
 *      the two review questions of the Objectivation phase were missed by both
 *      earlier signals. They are not on the pupil's page (they are read aloud)
 *      and they do not end in a question mark (the options follow the colon),
 *      yet the formatter's prose protects "les questions de bilan et leurs
 *      options" by name. Marking sixty lessons without this would have left the
 *      most important lines in that phase unprotected in every one of them.
 *
 * Usage (from backend/):
 *   node scripts/propose-quotation-marks.mjs <graph.json> [--lesson <substring>] [--out proposal.json]
 *
 * <graph.json> is an export of the namespace — either the /kg explorer's shape
 * or export-kg's raw envelope; both are read.
 */
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const optionOf = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
if (!file) {
  console.error("usage: node scripts/propose-quotation-marks.mjs <graph.json> [--lesson <substring>] [--out proposal.json]");
  process.exit(2);
}

const graph = JSON.parse(readFileSync(file, "utf8"));

/*
 * Both export shapes, read the same way.
 *
 * The explorer flattens a node's properties and names edges {s,t,r}; export-kg
 * keeps the raw envelope with {labels, properties} and {start,end,type}. Getting
 * this wrong is silent — every walk returns nothing and the script reports a
 * clean zero — so both are handled here rather than assumed.
 */
const nodes = graph.nodes.map((node) => ({
  id: node.id,
  label: node.label ?? (node.labels ?? [])[0] ?? "",
  title: node.desc ?? node.properties?.description ?? node.props?.description ?? "",
  guide: node.props?.assemblyGuide ?? node.properties?.metadata?.assemblyGuide ?? "",
}));
const edges = (graph.edges ?? graph.relationships ?? []).map((edge) => ({
  from: edge.s ?? edge.start,
  to: edge.t ?? edge.end,
  type: edge.r ?? edge.type,
}));

const byId = new Map(nodes.map((node) => [node.id, node]));
const children = new Map();
for (const edge of edges) {
  if (edge.type !== "hasChild" && edge.type !== "hasPart") continue;
  if (!children.has(edge.from)) children.set(edge.from, []);
  children.get(edge.from).push(edge.to);
}
const coversOf = new Map();
for (const edge of edges) {
  if (edge.type !== "covers") continue;
  if (!coversOf.has(edge.from)) coversOf.set(edge.from, []);
  coversOf.get(edge.from).push(edge.to);
}

/** Every DocumentSection at or under a node, breadth first (so, in page order). */
function sectionsUnder(rootId) {
  const found = [], seen = new Set(), queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (node?.label === "DocumentSection") found.push(node);
    for (const child of children.get(id) ?? []) queue.push(child);
  }
  return found;
}

// Compared on words alone: punctuation and spacing differ between the two
// documents without the sentence differing.
const normalise = (text) =>
  text.toLowerCase().replace(/[^a-z0-9àâçéèêëîïôûùüÿñ ]/g, " ").replace(/\s+/g, " ").trim();

const documents = nodes.filter((node) => node.label === "TeachingLearningMaterial");
if (documents.length < 2) {
  console.error(`Signal 1 needs two documents — a guide and the pupil material — and this graph has ${documents.length}.`);
  process.exit(1);
}
// The pupil document is the one the guide's lines are quoted FROM. Named by the
// caller would be better; for now the two live ci/maths documents are the case.
const guide = documents.find((doc) => /guide/i.test(doc.title)) ?? documents[0];
const pupil = documents.find((doc) => doc.id !== guide.id);

const pupilLines = [];
for (const section of sectionsUnder(pupil.id)) {
  for (const line of String(section.guide).split(/\n/)) {
    const words = normalise(line);
    if (words.length > 25) pupilLines.push(words);
  }
}

const PRINTED = /^\[(N|FR|WO)\]\s*(.*)$/;

/** Which signal, if any, says this line is a quotation. */
function signalFor(marker, body) {
  const words = normalise(body);
  if (words.length >= 12 && pupilLines.some((line) => line.includes(words) || words.includes(line))) {
    return { signal: "on-the-pupil-page", confidence: "proof" };
  }
  if (marker !== "N" && /\?\s*$/.test(body)) {
    return { signal: "spoken-question", confidence: "review" };
  }
  // Signal 3: options offered aloud, separated by "·" — the review-question
  // shape the pilot showed both other signals miss.
  if (marker !== "N" && /·/.test(body) && body.split("·").length >= 3) {
    return { signal: "spoken-options", confidence: "review" };
  }
  return null;
}

const wanted = optionOf("lesson");
const proposal = [];
let printedLines = 0;

for (const section of sectionsUnder(guide.id)) {
  if (wanted) {
    // Only the sections under the lesson section whose title matches.
    const ancestors = sectionsUnder(
      sectionsUnder(guide.id).find((candidate) => candidate.title.toLowerCase().includes(wanted.toLowerCase()))?.id ?? "",
    );
    if (!ancestors.some((candidate) => candidate.id === section.id)) continue;
  }
  for (const raw of String(section.guide).split(/\n/)) {
    const match = PRINTED.exec(raw.trim());
    if (!match) continue;
    printedLines++;
    const [, marker, body] = match;
    const verdict = signalFor(marker, body);
    if (!verdict) continue;
    proposal.push({
      sectionId: section.id,
      section: section.title,
      marker,
      line: body,
      ...verdict,
    });
  }
}

const byConfidence = { proof: 0, review: 0 };
for (const entry of proposal) byConfidence[entry.confidence]++;

for (const entry of proposal) {
  const tag = entry.confidence === "proof" ? "QUOTED " : "CONFIRM";
  console.log(`${tag} [${entry.marker}] (${entry.signal}) ${entry.line.slice(0, 76)}`);
}
console.log(`\nprinted lines examined: ${printedLines}`);
console.log(`proposed as quotations: ${proposal.length} — ${byConfidence.proof} proven, ${byConfidence.review} to confirm`);
console.log("NOTHING WAS WRITTEN. Review, then apply the marking as a separate step.");

const out = optionOf("out");
if (out) {
  writeFileSync(out, JSON.stringify(proposal, null, 1));
  console.log(`proposal saved to ${out}`);
}
