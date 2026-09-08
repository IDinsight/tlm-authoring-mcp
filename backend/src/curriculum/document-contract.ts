/*
 * Everything needed to produce one document, resolved, in one call.
 *
 * WHY. Writing one lesson's teacher sheet needs facts from six places in the
 * graph, and nothing gathered them: the September run gathered them by hand and
 * pasted them into a chat message. That is why eight parallel writers each had
 * to be handed the same long instruction, and why only one of them knew what the
 * others had decided about translations. This module holds what a person was
 * holding in their head.
 *
 * WHAT IT ADDS over `walk_document` and `walk_document_section`, which already
 * return the spine, the curriculum and the formatter stack:
 *
 *   • The MERGED render settings. The stack comes back as a list today and every
 *     caller merges it themselves, which is a nearest-wins deep merge nobody
 *     should be reimplementing per caller.
 *   • The repeated-sentence table, resolved (`boilerplate.ts`).
 *   • An explicit statement of what the DATA does not mark — see below.
 *
 * WHAT IT REFUSES TO GUESS. Two of the six parts the brief asked for cannot be
 * answered from the graph as it stands, and both would be easy to fake:
 *
 *   • CONTROL POINTS. ci/maths states its checks as a numbered list under a
 *     heading — and it states its LEVERS, its phases and its page structure as
 *     numbered lists too, 16 and 15 and 9 items long. Nothing distinguishes
 *     them: no label, no property, no marker. Returning "every numbered item"
 *     would hand a reviewer a list of mostly-not-checks, which is worse than
 *     handing them nothing, because they would work through it.
 *   • QUOTATIONS. Which lines are quoted from what a learner sees — and so may
 *     never be shortened — is not marked anywhere. Today a Python script guesses
 *     from French keywords. A wrong guess here shortens a quoted instruction
 *     silently, which is the one failure the trimming pass exists to prevent.
 *
 * Both come back in `unavailable`, naming what is missing and what would fix it.
 * Silence would be indistinguishable from "this document has no checks", and
 * this codebase has already paid for a check that reported success while
 * checking nothing.
 */
import type { CurriculumModel } from "../types.js";
import { documentSubgraph, formatterStackFor, type DocumentSectionOut } from "./documents.js";
import { resolveBoilerplate, type BoilerplateTable, type ProseSource } from "./boilerplate.js";
import { resolveRenderSpec, type ResolvedSpec } from "../render/index.js";

const ROUTINE_EDGE = "usesRoutine";

/** A part the graph cannot answer, and what would make it answerable. */
export type UnavailablePart = {
  part: "controlPoints" | "quotations";
  why: string;
  wouldNeed: string;
};

export type DocumentContract = {
  documentId: string;
  /** The document's own assembly guidance, as authored. */
  assemblyGuide: string | null;
  /** Its sections in reading order, each with what it covers. */
  spine: {
    sections: DocumentSectionOut[];
    total: number;
    truncated?: true;
    nextCursor?: string;
  };
  /**
   * The step sequence this document renders, and which node carried the edge.
   *
   * Nearest wins: the document's own edge, else one on the curriculum it covers.
   * Looking only at the document would answer "none" for ci/maths, whose routine
   * edges were collapsed onto the Course — a wrong answer that reads like a real
   * one. null means no routine applies, which is normal.
   *
   * A SECTION may still name its own, and that is not duplicated here: ask
   * `walk_document_section`, which resolves it per section and is the only place
   * the answer can differ between sections.
   */
  routine: { id: string; resolvedFrom: string; scope: "document" | "curriculum" } | null;
  /** The formatter stack in precedence order — document-wide first. */
  formatterStack: string[];
  /** Those formatters' `render` bags, merged nearest-wins, or the errors. */
  render: ResolvedSpec;
  /** The sentences written once and called by reference. */
  boilerplate: BoilerplateTable;
  /**
   * The line prefixes marking text that may never be shortened, when this
   * document declares any. null means the document does not mark quotations —
   * and `unavailable` then says so, because a tightening pass reading null as
   * "nothing is protected" would cut a quoted instruction silently.
   */
  quotations: { markedBy: string[] } | null;
  /** What the data does not mark, stated rather than guessed. */
  unavailable: UnavailablePart[];
};

/** Everything authored on a node that a reference could be written in. */
function proseOf(node: { id: string; properties?: Record<string, any> }): ProseSource | null {
  const raw = node.properties?.raw ?? node.properties ?? {};
  const text = [raw.content, raw.metadata?.assemblyGuide, raw.metadata?.summary, raw.description]
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .join("\n");
  return text ? { nodeId: node.id, text } : null;
}

/**
 * The routine a document renders — its own, else the curriculum's.
 *
 * Two hops and no further. A document covers curriculum directly, and that is
 * where ci/maths' routine sits after the edges were collapsed onto the Course;
 * walking deeper would start finding routines a document does not render.
 */
function resolveRoutine(
  raw: CurriculumModel["rawGraph"], documentId: string,
): DocumentContract["routine"] {
  if (!raw) return null;
  const target = (nodeId: string) =>
    raw.relationships.find((edge) => edge.type === ROUTINE_EDGE && edge.start === nodeId)?.end ?? null;

  const own = target(documentId);
  if (own) return { id: own, resolvedFrom: documentId, scope: "document" };

  for (const edge of raw.relationships) {
    if (edge.type !== "covers" || edge.start !== documentId) continue;
    const inherited = target(edge.end);
    if (inherited) return { id: inherited, resolvedFrom: edge.end, scope: "curriculum" };
  }
  return null;
}

const NO_CONTROL_POINTS: UnavailablePart = {
  part: "controlPoints",
  why: "Nothing in the graph distinguishes a check from any other numbered list. On the live ci/maths formatters, numbered lists hold levers, phases and page structure as often as checks — 16 items in one spec, 15 in another — and no label, property or marker tells them apart.",
  wouldNeed: "An evaluation grid attached to the document (use_rubric), which evaluate_document already reads. Until then read the formatter prose: `formatterStack` names every node whose text to read.",
};

const NO_QUOTATIONS: UnavailablePart = {
  part: "quotations",
  why: "This document does not mark which lines are quoted from what a learner sees, so nothing says which may never be shortened. Matching against the pupil document reaches only the lines actually printed there — one of the four protected categories — and never the three that are spoken aloud.",
  wouldNeed: "`render.overflow.neverShorten`, listing the line prefixes that mark a quotation, and those prefixes applied in the guides. Until then a tightening pass must refuse rather than choose what to cut.",
};

/**
 * Resolve a document's production rules.
 *
 * Returns null when `documentId` is not a document in this graph — the same
 * answer `documentSubgraph` gives, for the same reason: a caller that named the
 * wrong node should be told, not handed a plausible empty contract.
 */
export function documentContract(
  model: CurriculumModel,
  documentId: string,
  options: { limit?: number; cursor?: string } = {},
): DocumentContract | { error: string } | null {
  const scope = documentSubgraph(model, documentId, options);
  if (scope === null) return null;
  if ("error" in scope) return scope;

  const stack = formatterStackFor(model, documentId) ?? [];
  const raw = model.rawGraph;

  /*
   * References are called from the document's OWN prose — its sections and their
   * assembly guidance. Definitions live in the formatter stack, PLUS the render
   * settings' own names: ci/maths calls `{img:picto-materiel}`, and that picture
   * is named in `images.inlineHeightCm`, not in any sentence. Passing the
   * settings' keys as definitions is what stops a correctly-declared picture
   * being reported as a broken reference.
   */
  const stackProse = stack.map(proseOf).filter((source): source is ProseSource => source !== null);
  const merged = resolveRenderSpec(stack);
  const declaredNames: ProseSource[] = merged.ok
    ? [{
        nodeId: documentId,
        text: [
          ...Object.keys(merged.spec.images?.maxHeightCm ?? {}),
          ...Object.keys(merged.spec.images?.inlineHeightCm ?? {}),
          ...Object.keys(merged.spec.blocks ?? {}),
        ].join("\n"),
      }]
    : [];

  const neverShorten = (merged.ok ? merged.spec.overflow?.neverShorten : undefined) ?? [];

  const documentIds = new Set([documentId, ...scope.sections.map((section) => section.id)]);
  const documentProse = (raw?.nodes ?? [])
    .filter((node) => documentIds.has(node.id))
    .map(proseOf)
    .filter((source): source is ProseSource => source !== null);

  return {
    documentId,
    assemblyGuide: scope.assemblyGuide,
    spine: {
      sections: scope.sections,
      total: scope.sectionsTotal,
      ...(scope.sectionsTruncated ? { truncated: true as const } : {}),
      ...(scope.nextCursor ? { nextCursor: scope.nextCursor } : {}),
    },
    routine: resolveRoutine(raw, documentId),
    formatterStack: stack.map((node) => node.id),
    render: merged,
    boilerplate: resolveBoilerplate(
      [...documentProse, ...stackProse],
      [...stackProse, ...declaredNames],
    ),
    quotations: neverShorten.length > 0 ? { markedBy: neverShorten } : null,
    unavailable: [
      NO_CONTROL_POINTS,
      ...(neverShorten.length > 0 ? [] : [NO_QUOTATIONS]),
    ],
  };
}
