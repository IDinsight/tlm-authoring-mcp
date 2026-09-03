/*
 * Module: curriculum · content lint (the lint_content rules)
 *
 * The THIRD checker, beside two that already exist and must not absorb it:
 *
 *   check_draft   — WIRING. Is it connected? Mechanical, subject-agnostic.
 *   review_draft  — COVERAGE. Does it teach what the guide expects? A judgement
 *                   the calling model makes from the subject's prose.
 *   lint_content  — CONTENT. Is what is written internally consistent?
 *
 * The split is a rule, not an accident (docs/design-notes/self-serve-authoring.md,
 * D4). "This routine says 30 minutes and its steps add up to 35" is neither
 * wiring nor pedagogy: nothing is disconnected, and no subject knowledge is
 * needed to see that two numbers disagree. That is this module's whole territory
 * — statements in the authored data that contradict each other.
 *
 * WHAT EACH RULE NEEDS, AND WHY IT IS DECLARED
 *
 * The roadmap defines this checker over a rendered BLOCK TREE — the ordered
 * banners, bullets and image slots a renderer produces. That block tree does not
 * exist yet (it is WP4's, and WP4 is blocked). But most of the rules that pay for
 * themselves today read the GRAPH, not a page: whether a total matches its parts
 * has nothing to do with how anything is printed.
 *
 * So every rule declares its `requires`. The graph rules run now; the block-tree
 * rules are added against the same interface when there is a page to read, with
 * no redesign. `lintableRules()` is what the tool runs; the rest are advertised
 * as pending so what is NOT yet checked stays visible.
 *
 * FINDINGS ARE ENGLISH, like every other server-authored string — one deployment
 * serves six workspaces and only one works in French, so the payload cannot pick
 * a language and the calling model relays each finding in the expert's own. They
 * are warnings, never blocks.
 */

import type { LintFinding, MutationGraph, MutationNode } from "../kg-store/index.js";
import { displayName } from "../utils/index.js";

const CONTAINMENT = "hasPart";
const ROUTINE_LABEL = "InstructionalRoutine";

const rawOf = (node: MutationNode): Record<string, unknown> => (node.properties?.raw as Record<string, unknown>) ?? {};
const metaOf = (node: MutationNode): Record<string, unknown> => (rawOf(node).metadata as Record<string, unknown>) ?? {};
const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** The node's display name — line 1 of its description, as every other read uses. */
const titleOf = (node: MutationNode): string =>
  displayName(str(rawOf(node).description)) || str(node.properties?.title) || str(node.properties?.text) || node.id;

/*
 * A per-node escape hatch, declared as DATA rather than deployed as code.
 *
 * It exists because the first rule written here would have fired a false
 * positive on its first run: the Annexe 7 grid's weights sum to 80%, and that is
 * deliberate — sections were removed pending human review. A linter whose
 * opening finding is wrong teaches its reader to skim past it.
 *
 * `metadata.lintIgnore: ["rubric-weights-sum"]` on the node suppresses that rule
 * there, and only there. A curator adds one without a deploy.
 */
function ignoredRules(node: MutationNode): Set<string> {
  const declared = metaOf(node).lintIgnore;
  return new Set(Array.isArray(declared) ? declared.filter((rule): rule is string => typeof rule === "string") : []);
}

// ── Reading durations, in the two spellings the live data uses ────────────────

/**
 * Minutes from an ISO-8601 duration ("PT30M", "PT1H30M"), or null.
 *
 * This is the machine-readable spelling — the one a rule can trust, and the one
 * 5 of 16 live routines actually carry on their steps.
 */
export function minutesFromIso(value: unknown): number | null {
  const match = /^P(?:T(?:(\d+)H)?(?:(\d+)M)?)$/.exec(str(value));
  if (!match || (match[1] === undefined && match[2] === undefined)) {
    return null;
  }
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
}

/**
 * Minutes stated in a human title — "(30 min)", "— 60 min", "45 mn".
 *
 * Every live routine states its total this way and only some state it as a
 * field, so a rule that read the field alone would silently check almost
 * nothing. Reading the title is not a licence to keep durations there: rule
 * `routine-step-untimed` says so directly.
 */
export function minutesFromTitle(title: string): number | null {
  const match = /(\d+)\s*(?:min|mn|minutes)\b/i.exec(title);
  return match ? Number(match[1]) : null;
}

/** A node's declared duration, preferring the field over the title. */
const declaredMinutes = (node: MutationNode): number | null =>
  minutesFromIso(rawOf(node).timeRequired) ?? minutesFromTitle(titleOf(node));

// ── The lint's input ─────────────────────────────────────────────────────────

export type ContentLintInput = {
  /** The graph being checked — a subject namespace, or a catalog library. */
  graph: MutationGraph;
  /**
   * Every id a reference may legally resolve to. Wider than `graph` on purpose:
   * a catalog entry may cite a node in another library, and flagging that as
   * dangling would be wrong. Defaults to the graph's own ids.
   */
  knownIds?: Set<string>;
};

export type ContentRule = {
  id: string;
  /**
   * What the rule reads. "graph" runs today; "blockTree" waits for a renderer
   * (WP4) and is advertised, not run, so the gap stays visible.
   */
  requires: "graph" | "blockTree";
  summary: string;
  check: (input: ContentLintInput) => LintFinding[];
};

// Children of a node along the containment axis, in stored order.
function childrenOf(graph: MutationGraph, parentId: string): MutationNode[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  return graph.edges
    .filter((edge) => edge.type === CONTAINMENT && edge.from === parentId)
    .map((edge) => byId.get(edge.to))
    .filter((node): node is MutationNode => node !== undefined);
}

const MATERIAL_LABEL = "Material";
const isRoutine = (node: MutationNode): boolean => (node.labels ?? []).includes(ROUTINE_LABEL);
const isMaterial = (node: MutationNode): boolean => (node.labels ?? []).includes(MATERIAL_LABEL);

/**
 * An entry's kind, as the catalog tags it. Untagged means routine — the original
 * kind, and how the seeded shared library reads.
 */
function kindOf(entry: MutationNode): string {
  const meta = metaOf(entry);
  const tagged = str(meta.catalogKind) || str(meta.role);
  return tagged === "formatter" || tagged === "rubric" ? tagged : "routine";
}

/**
 * An entry's STEPS, in either shape the catalog actually holds.
 *
 * A step is normally a child InstructionalRoutine with its text in a Material
 * grandchild. But an entry authored with add_nodes and filed with add_to_catalog
 * is FLAT: its steps are direct `Material` children carrying their own name,
 * order and timing. Both shapes are live, and reading only the nested one would
 * silently check nothing on the flat entries — the rules would look like they
 * passed.
 *
 * A formatter's direct Materials are its SPEC, not steps, and a rubric's are its
 * criteria; only a routine's flat children are steps. That is the same line
 * `describeEntry` draws when it renders the catalog.
 */
function stepsOf(graph: MutationGraph, entry: MutationNode): MutationNode[] {
  const children = childrenOf(graph, entry.id);
  const nested = children.filter(isRoutine);
  if (nested.length > 0) {
    return nested;
  }
  return kindOf(entry) === "routine" ? children.filter(isMaterial) : [];
}

/**
 * A grid's weighted SECTIONS, in either shape — the same two a routine's steps
 * come in. A grid authored with add_nodes holds its sections as direct Material
 * children, and reading only the nested shape would skip it silently: no
 * sections found means no weights found means nothing reported, which is
 * indistinguishable from a grid that adds up.
 */
function sectionsOf(graph: MutationGraph, entry: MutationNode): MutationNode[] {
  const children = childrenOf(graph, entry.id);
  const nested = children.filter(isRoutine);
  return nested.length > 0 ? nested : children.filter(isMaterial);
}

/*
 * A routine ENTRY, as opposed to the library root or an individual step.
 *
 * The catalog nests three deep — root ─hasPart→ entry ─hasPart→ step — and all
 * three carry the same label, so the tier has to be derived rather than read off
 * the node. An entry is a routine whose parent is a ROOT: a routine that has no
 * routine parent of its own. That is the same middle tier `listCatalogEntries`
 * selects, and deriving it this way hard-codes no id.
 *
 * "Has a routine parent" is NOT enough, and getting that wrong is not academic:
 * a nested step also has a routine parent, so it would be treated as an entry,
 * and its Material body — the step's text — would be read as an untimed step of
 * it. On the shape this module's own comments call normal, that reported "1 of
 * this routine's 1 steps carry no duration" against a step's body.
 */
function routineEntries(graph: MutationGraph): MutationNode[] {
  const routineIds = new Set(graph.nodes.filter(isRoutine).map((node) => node.id));
  const hasRoutineParent = new Set(
    graph.edges.filter((edge) => edge.type === CONTAINMENT && routineIds.has(edge.from)).map((edge) => edge.to),
  );

  const rootIds = new Set(
    graph.nodes.filter((node) => isRoutine(node) && !hasRoutineParent.has(node.id)).map((node) => node.id),
  );
  const childrenOfRoots = new Set(
    graph.edges.filter((edge) => edge.type === CONTAINMENT && rootIds.has(edge.from)).map((edge) => edge.to),
  );
  return graph.nodes.filter((node) => isRoutine(node) && childrenOfRoots.has(node.id));
}

// ── Rule: a declared total must equal the sum of its parts ───────────────────

const durationMismatch: ContentRule = {
  id: "routine-duration-mismatch",
  requires: "graph",
  summary: "A routine's declared duration must equal the sum of its steps'.",
  check: ({ graph }) => {
    const findings: LintFinding[] = [];
    for (const entry of routineEntries(graph)) {
      if (ignoredRules(entry).has("routine-duration-mismatch")) {
        continue;
      }
      const total = declaredMinutes(entry);
      const steps = stepsOf(graph, entry);
      if (total === null || steps.length === 0) {
        continue;
      }

      const stepMinutes = steps.map((step) => minutesFromIso(rawOf(step).timeRequired));
      // Only comparable when EVERY step is timed; a partial sum is not a
      // contradiction, it is the missing-timings rule's business.
      if (stepMinutes.some((minutes) => minutes === null)) {
        continue;
      }

      const summed = stepMinutes.reduce((a, b) => (a ?? 0) + (b ?? 0), 0) ?? 0;
      if (summed === total) {
        continue;
      }
      findings.push({
        rule: "routine-duration-mismatch",
        severity: "warning",
        nodeId: entry.id,
        title: titleOf(entry),
        message: `This routine declares ${total} minutes, but its ${steps.length} steps add up to ${summed}.`,
        fix: `Either correct the step timings so they total ${total} minutes, or restate the routine's own duration as ${summed}. A teacher plans the lesson from the total and runs it from the steps, so the two disagreeing misleads whichever one they trust.`,
      });
    }
    return findings;
  },
};

// ── Rule: a timed routine must time every step ───────────────────────────────

const stepUntimed: ContentRule = {
  id: "routine-step-untimed",
  requires: "graph",
  summary: "Every step of a routine that declares a duration must carry one too.",
  check: ({ graph }) => {
    const findings: LintFinding[] = [];
    for (const entry of routineEntries(graph)) {
      if (ignoredRules(entry).has("routine-step-untimed")) {
        continue;
      }
      // A routine that declares no duration at all is untimed by choice, not by
      // omission — flagging it would be inventing a requirement.
      if (declaredMinutes(entry) === null) {
        continue;
      }

      const steps = stepsOf(graph, entry);
      const untimed = steps.filter((step) => minutesFromIso(rawOf(step).timeRequired) === null);
      if (untimed.length === 0) {
        continue;
      }
      findings.push({
        rule: "routine-step-untimed",
        severity: "warning",
        nodeId: entry.id,
        title: titleOf(entry),
        message: `${untimed.length} of this routine's ${steps.length} steps carry no duration: ${untimed.map(titleOf).join("; ")}.`,
        fix: "Set `timeRequired` on each step (ISO-8601, e.g. 'PT8M'). A duration written into a step's NAME cannot be read, summed or checked — the field is what makes the routine's total verifiable.",
      });
    }
    return findings;
  },
};

// ── Rule: weighted sections must total 100% ──────────────────────────────────

const weightsSum: ContentRule = {
  id: "rubric-weights-sum",
  requires: "graph",
  summary: "A weighted grid's section weights must total 100%.",
  check: ({ graph }) => {
    const findings: LintFinding[] = [];
    for (const entry of routineEntries(graph)) {
      if (ignoredRules(entry).has("rubric-weights-sum")) {
        continue;
      }
      const sections = sectionsOf(graph, entry);
      const weights = sections.map((section) => {
        const declared = /(\d+)\s*%/.exec(str(metaOf(section).weight));
        return declared ? Number(declared[1]) : null;
      });

      // Unweighted grids are normal (a yes/no checklist has no weights); a
      // PARTLY weighted one is the ambiguous case and is left to a person.
      const weighted = weights.filter((weight): weight is number => weight !== null);
      if (weighted.length === 0 || weighted.length !== sections.length) {
        continue;
      }

      const total = weighted.reduce((a, b) => a + b, 0);
      if (total === 100) {
        continue;
      }
      findings.push({
        rule: "rubric-weights-sum",
        severity: "warning",
        nodeId: entry.id,
        title: titleOf(entry),
        message: `This grid's ${sections.length} weighted sections total ${total}%, not 100%.`,
        fix: `Correct the weights, or — if the shortfall is deliberate, because sections were removed pending review — declare it on the grid with metadata.lintIgnore: ["rubric-weights-sum"] so this stops being reported.`,
      });
    }
    return findings;
  },
};

// ── Rule: a cited id must resolve ────────────────────────────────────────────

/**
 * Ids cited in a piece of authored text.
 *
 * Live references are written TRUNCATED with an ellipsis — `3e43c5d3-…` — so a
 * full-UUID pattern matches nothing at all. Scanning the whole live catalog with
 * one found zero references and pronounced it clean, while seven were broken.
 * Hence the 8-hex prefix form, and hence prefix comparison below.
 */
export function citedIds(text: string): string[] {
  const cited = new Set<string>();
  for (const [, full] of text.matchAll(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/g)) {
    cited.add(full);
  }
  // The truncated form: eight hex digits, a hyphen, then an ellipsis.
  for (const [, prefix] of text.matchAll(/\b([0-9a-f]{8})-(?:…|\.\.\.)/g)) {
    cited.add(prefix);
  }
  return [...cited];
}

const danglingReference: ContentRule = {
  id: "dangling-reference",
  requires: "graph",
  summary: "Every id cited in authored text must resolve to something that exists.",
  check: ({ graph, knownIds }) => {
    const known = knownIds ?? new Set(graph.nodes.map((node) => node.id));
    const knownPrefixes = new Set([...known].map((id) => id.slice(0, 8)));

    const findings: LintFinding[] = [];
    for (const node of graph.nodes) {
      if (ignoredRules(node).has("dangling-reference")) {
        continue;
      }
      // Every field that carries authored prose on any node kind.
      const raw = rawOf(node);
      const text = [str(raw.description), str(raw.content), str(metaOf(node).summary), str(metaOf(node).assemblyGuide)].join("\n");

      const unresolved = citedIds(text)
        .filter((cited) => (cited.length === 8 ? !knownPrefixes.has(cited) : !known.has(cited)));
      if (unresolved.length === 0) {
        continue;
      }
      findings.push({
        rule: "dangling-reference",
        severity: "warning",
        nodeId: node.id,
        title: titleOf(node),
        message: `This text cites ${unresolved.length} id(s) that resolve to nothing: ${unresolved.map((id) => `${id}…`).join(", ")}.`,
        fix: "Either the id is wrong — find the entry by NAME and cite its real id — or the thing it names was never authored, in which case the reference is describing work still to do and should say so instead of pointing at nothing.",
      });
    }
    return findings;
  },
};

// ── Rule: a formatter's declared values must not contradict its own prose ────

/** Every "N cm" in a piece of text, French decimal comma included. */
const centimetresIn = (text: string): number[] =>
  [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*cm\b/gi)].map(([, value]) => Number(value.replace(",", ".")));

/** Every explicit point size — "12 points", "11 pt". */
const pointsIn = (text: string): number[] =>
  [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:pt|points?)\b/gi)].map(([, value]) => Number(value.replace(",", ".")));

const renderContradictsProse: ContentRule = {
  id: "render-contradicts-prose",
  requires: "graph",
  summary: "A formatter's `render` values must not contradict the prose beside them.",
  check: ({ graph }) => {
    const findings: LintFinding[] = [];
    for (const node of graph.nodes) {
      if (ignoredRules(node).has("render-contradicts-prose")) {
        continue;
      }
      const render = rawOf(node).render as Record<string, any> | undefined;
      const prose = str(rawOf(node).content);
      if (!render || !prose) {
        continue;
      }

      const conflicts: string[] = [];

      // Page size: only when the prose names exactly one, so "A4 or A5" is not
      // read as a contradiction.
      // Compared case-insensitively, but REPORTED as each side actually spells
      // it — a finding that shouts "LETTER" back at an author who wrote "Letter"
      // reads like a different value.
      const namedSizes = [...prose.matchAll(/\b(A3|A4|A5|Letter|Legal)\b/gi)].map(([, size]) => size);
      const distinctSizes = [...new Map(namedSizes.map((size) => [size.toUpperCase(), size])).values()];
      const declaredSize = str(render.page?.size);
      if (declaredSize && distinctSizes.length === 1 && distinctSizes[0].toUpperCase() !== declaredSize.toUpperCase()) {
        conflicts.push(`render says the page is ${declaredSize}, the prose says ${distinctSizes[0]}`);
      }

      // Body size: the prose of a formatter states one body size or none.
      const declaredPt = render.type?.sizePt;
      const namedPts = [...new Set(pointsIn(prose))];
      if (typeof declaredPt === "number" && namedPts.length === 1 && namedPts[0] !== declaredPt) {
        conflicts.push(`render says the body is ${declaredPt} pt, the prose says ${namedPts[0]} pt`);
      }

      // Margins: only when the prose states a single measurement, which is how
      // a formatter with equal margins on four sides writes it.
      const declaredMargins = render.page?.marginsCm as Record<string, number> | undefined;
      const uniqueDeclared = declaredMargins ? [...new Set(Object.values(declaredMargins))] : [];
      const namedCm = [...new Set(centimetresIn(prose))];
      if (uniqueDeclared.length === 1 && namedCm.length === 1 && namedCm[0] !== uniqueDeclared[0]) {
        conflicts.push(`render says the margins are ${uniqueDeclared[0]} cm, the prose says ${namedCm[0]} cm`);
      }

      if (conflicts.length === 0) {
        continue;
      }
      findings.push({
        rule: "render-contradicts-prose",
        severity: "warning",
        nodeId: node.id,
        title: titleOf(node),
        message: `This formatter's declared values disagree with its own prose: ${conflicts.join("; ")}.`,
        fix: "Make them agree. The prose is what an author reads and the declared values are what a renderer obeys, so while they differ the page and the instructions cannot both be right.",
      });
    }
    return findings;
  },
};

// ── The registry ─────────────────────────────────────────────────────────────

export const CONTENT_RULES: ContentRule[] = [
  durationMismatch,
  stepUntimed,
  weightsSum,
  danglingReference,
  renderContradictsProse,
];

/** The rules that can run against stored content today. */
export const lintableRules = (): ContentRule[] => CONTENT_RULES.filter((rule) => rule.requires === "graph");

export type ContentLintOptions = {
  /** Restrict to these rule ids. */
  rules?: string[];
  /** Restrict findings to these nodes — what a draft actually touched. */
  onlyNodes?: Set<string>;
};

/**
 * Run every runnable rule, warnings first, then stable by rule and node so two
 * runs read the same.
 */
export function lintContent(input: ContentLintInput, options: ContentLintOptions = {}): LintFinding[] {
  const wanted = options.rules?.length ? new Set(options.rules) : null;
  const rules = lintableRules().filter((rule) => !wanted || wanted.has(rule.id));

  const findings = rules.flatMap((rule) => rule.check(input));
  const scoped = options.onlyNodes ? findings.filter((finding) => options.onlyNodes!.has(finding.nodeId)) : findings;

  return scoped.sort((a, b) =>
    (a.severity === b.severity ? 0 : a.severity === "warning" ? -1 : 1)
    || a.rule.localeCompare(b.rule)
    || a.nodeId.localeCompare(b.nodeId));
}
