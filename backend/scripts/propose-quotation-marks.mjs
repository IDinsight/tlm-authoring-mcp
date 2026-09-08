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
 * TWO SIGNALS, both of which the formatter's own prose describes:
 *
 *   1. ON THE PUPIL'S PAGE — the same words appear in the pupil document.
 *      Proof, not inference. Measured at 537 of 5,119 printed lines on the live
 *      ci/maths guide, and it reaches only ONE of the four protected
 *      categories: the instructions actually printed for the learner.
 *
 *   2. AN OPTIONS LIST — a spoken line offering choices separated by "·".
 *      ADDED AFTER THE PILOT, which is the whole reason to pilot: on lesson 11
 *      the two review questions of the Objectivation phase were missed by every
 *      other signal. They are not on the pupil's page (they are read aloud) and
 *      they do not end in a question mark (the options follow the colon), yet
 *      the formatter's prose protects "les questions de bilan et leurs options"
 *      by name. Marking sixty lessons without this would have left the most
 *      important lines of that phase unprotected in every one of them.
 *
 * A THIRD SIGNAL WAS TRIED AND DROPPED: any spoken line ending in a question
 * mark, meant to catch the oral questions of the opening. On lesson 11 it
 * proposed eight lines and three were a bare « Pourquoi ? » — a follow-up
 * prompt, which the same prose puts in the SHORTEN category, not the protected
 * one. Wrong a third of the time, sixty times over, is worse than leaving those
 * lines to a person: a reviewer who learns to click past a noisy signal stops
 * reading the accurate ones too. The opening questions are marked by hand.
 *
 * Usage (from backend/):
 *   node scripts/propose-quotation-marks.mjs <graph.json> [--quoted «»] [--lesson <substring>] [--out proposal.json]
 *
 * --quoted gives the pair of characters this document's language quotes with
 * (opening half then closing half). Without it, only numbered lines and
 * questions are read as utterances, which under-matches rather than over-matches.
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
  console.error("usage: node scripts/propose-quotation-marks.mjs <graph.json> [--quoted «»] [--lesson <substring>] [--out proposal.json]");
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

/*
 * The pupil document's lines, indexed by their words.
 *
 * THE FLOOR IS LOAD-BEARING and was wrong. At 25 characters, « Quel objet est
 * court » — twenty — never entered the index, so a guide line quoting it could
 * not match however exact the quotation was. Short printed instructions are
 * common, and they were invisible: a first pass marked 568 lines where 606 were
 * matchable. Fifteen is the floor now.
 *
 * Not lower. At twelve the index starts holding fragments like « écris le
 * signe », which appears all over both documents, and a line is then protected
 * for sharing a stock phrase rather than being a quotation. Over-protection is
 * not the safe direction it looks: lock too much and the tightening pass cannot
 * reach the page budget, so it refuses and the sheet is produced by hand again.
 */
const MIN_MATCH = 15;

/*
 * What a pupil line contributes to the index: only what the CHILD is given.
 *
 * The pupil document carries no prefixes — it is one prose field mixing the
 * printed instructions with notes to whoever builds the page — so indexing
 * whole lines matched a teacher's note against a pupil-side note and protected
 * it as though it were a quotation. Both documents' guides repeat the same
 * authored prose, so « RÉPONSE ATTENDUE… » matched itself. 37 lines were marked
 * that way and were caught in review, one step before publishing.
 *
 * What separates an utterance from a note is STRUCTURAL, not semantic: an
 * utterance is quoted, numbered, or a question. A note is none of those. A
 * semantic rule would have to know the subject, and this script must not.
 *
 * The quote delimiters are an ARGUMENT for the same reason: which characters
 * quote a phrase is a fact about the document's language.
 */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const quoted = optionOf("quoted") ?? "";
const OPEN = quoted.slice(0, quoted.length / 2);
const CLOSE = quoted.slice(quoted.length / 2);
const NUMBERED = /^\s*\d+\s*[.)]\s+/;

/** The utterances a pupil-document line offers to the index, if any. */
function utterancesIn(line) {
  const trimmed = line.trim();
  if (OPEN && CLOSE) {
    const spans = [...trimmed.matchAll(
      new RegExp(`${escapeRe(OPEN)}([^${escapeRe(CLOSE)}]*)${escapeRe(CLOSE)}`, "g"),
    )];
    // A quoting line gives up ONLY its quoted spans. The prose around them is
    // the note that introduces the instruction, not the instruction.
    if (spans.length) return spans.map((m) => m[1]);
  }
  if (NUMBERED.test(trimmed)) return [trimmed.replace(NUMBERED, "")];
  if (trimmed.endsWith("?")) return [trimmed];
  return [];
}

const pupilLines = [];
for (const section of sectionsUnder(pupil.id)) {
  for (const line of String(section.guide).split(/\n/)) {
    for (const utterance of utterancesIn(line)) {
      const words = normalise(utterance);
      if (words.length >= MIN_MATCH) pupilLines.push(words);
    }
  }
}

/*
 * A GUIDE line quotes a PUPIL line when the shared text is most of the guide
 * line — not merely present in it.
 *
 * Length alone was doing a proportion's job, and it showed: « E. fait poser le
 * doigt sur la grande image, ET FAIT RETROUVER LE GARÇON… » was marked because
 * fifteen characters of it appear on the child's page. That is a stage
 * direction which happens to name something the child can see, and it is freely
 * rewordable. Fifty-two lines were locked that way — all of them the teacher's
 * own prose.
 *
 * A line that only PARTLY quotes can be rewritten around the quotation, so it is
 * shortenable and must not be protected. At 70% the 52 go, along with 17 genuine
 * borderline cases; 537 remain.
 *
 * The asymmetry is deliberate. Marking too little is the dangerous error — a
 * real quotation gets shortened and nobody sees it. Marking too much is only
 * obstructive. But fifty-two obviously wrong marks teach a reviewer to distrust
 * the whole set, and a set nobody trusts protects nothing.
 */
const MIN_SHARE = 0.7;

function quotes(pupilLine, guideLine) {
  const [shorter, longer] = pupilLine.length <= guideLine.length
    ? [pupilLine, guideLine]
    : [guideLine, pupilLine];
  if (shorter.length < MIN_MATCH || !longer.includes(shorter)) return false;
  return shorter.length / guideLine.length >= MIN_SHARE;
}

const PRINTED = /^\[(N|FR|WO)\]\s*(.*)$/;

/** Which signal, if any, says this line is a quotation. */
function signalFor(marker, body) {
  const words = normalise(body);
  if (pupilLines.some((line) => quotes(line, words))) {
    return { signal: "on-the-pupil-page", confidence: "proof" };
  }
  // Signal 2: options offered aloud, separated by "·" — the review-question
  // shape the pupil-page match cannot see.
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
