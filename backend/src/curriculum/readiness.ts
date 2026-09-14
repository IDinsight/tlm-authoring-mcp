/*
 * Is a document ready to be produced? One report, read off the graph's shape.
 *
 * Until now the answer came piecemeal and late: a render refused for want of
 * layout settings, a review came back thin for want of a grid, a wiring lint
 * named a document with no formatter — each in its own place, each after
 * someone had already started producing. This asks every question at once,
 * for a named document, and says which verb closes each gap.
 *
 * Every check reads the graph's SHAPE — labels and edges — never a subject's
 * vocabulary, so the same report holds for a pupil book, a teacher guide, or
 * a document in another workspace. It reports; it blocks nothing. Whether a
 * document without a grid may still be produced is the person's call.
 */

import type { CurriculumModel, RawGraphSnapshot } from "../types.js";
import { resolveRenderSpec } from "../render/index.js";
import { resolveLayout } from "../kg-recipes/index.js";
import { formatterStackFor } from "./documents.js";

type RawNode = RawGraphSnapshot["nodes"][number];

const TLM_LABEL = "TeachingLearningMaterial";
const SECTION_LABEL = "DocumentSection";
const FORMATTER_LABEL = "Formatter";
const RUBRIC_LABEL = "Rubric";
const CONTAINMENT = "hasPart";
const STANDARDS_CONTAINMENT = "hasChild";
const COVERS = "covers";
const ROUTINE_EDGE = "usesRoutine";

const labelsOf = (node: RawNode | undefined): string[] => node?.labels ?? [];
const titleOf = (node: RawNode | undefined): string => String((node?.properties as Record<string, unknown> | undefined)?.description ?? "").split("\n")[0].trim();

export type ReadinessStatus = "ok" | "missing" | "info";

export type ReadinessCheck = {
  id: "covers" | "sections" | "formatter" | "render" | "layout" | "rubric" | "routine";
  status: ReadinessStatus;
  detail: string;
  /** The verb that closes the gap, when there is one. */
  fix?: string;
};

export type DocumentReadiness = {
  document: { id: string; title: string };
  /** True when the document can be produced at all: it covers something, has sections, a formatter, and layout settings. */
  ready: boolean;
  checks: ReadinessCheck[];
};

function descendantsVia(raw: RawGraphSnapshot, rootId: string, edgeType: string): Set<string> {
  const out = new Set<string>();
  const queue = [rootId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const e of raw.relationships) {
      if (e.type === edgeType && e.start === current && !out.has(e.end)) { out.add(e.end); queue.push(e.end); }
    }
  }
  return out;
}

function ancestorsVia(raw: RawGraphSnapshot, startIds: string[], edgeTypes: Set<string>): Set<string> {
  const out = new Set<string>();
  const queue = [...startIds];
  while (queue.length) {
    const current = queue.shift()!;
    for (const e of raw.relationships) {
      if (edgeTypes.has(e.type) && e.end === current && !out.has(e.start)) { out.add(e.start); queue.push(e.start); }
    }
  }
  return out;
}

/**
 * The readiness of one document. Null when `tlmId` is not a document in the
 * model. Reads the same formatter stack the renderer and the composer resolve,
 * so "has layout settings" here means "render_document would accept it".
 */
export function documentReadiness(model: CurriculumModel, tlmId: string): DocumentReadiness | null {
  const raw = model.rawGraph;
  if (!raw) return null;
  const tlm = raw.nodes.find((n) => n.id === tlmId);
  if (!tlm || !labelsOf(tlm).includes(TLM_LABEL)) return null;

  const byId = new Map(raw.nodes.map((n) => [n.id, n]));
  const under = descendantsVia(raw, tlmId, CONTAINMENT);
  const sections = [...under].filter((id) => labelsOf(byId.get(id)).includes(SECTION_LABEL));
  const formatters = [...under].filter((id) => labelsOf(byId.get(id)).includes(FORMATTER_LABEL));
  const rubrics = [...under].filter((id) => labelsOf(byId.get(id)).includes(RUBRIC_LABEL));

  const coversFrom = (ids: string[]): string[] => raw.relationships.filter((e) => e.type === COVERS && ids.includes(e.start)).map((e) => e.end);
  const documentCovers = coversFrom([tlmId]);
  const sectionCovers = coversFrom(sections);
  const sectionsCoveringNothing = sections.filter((id) => coversFrom([id]).length === 0);

  const checks: ReadinessCheck[] = [];

  const coveredCount = new Set([...documentCovers, ...sectionCovers]).size;
  checks.push(coveredCount > 0
    ? { id: "covers", status: "ok", detail: `covers ${coveredCount} curriculum node(s)${documentCovers.length ? " (the document itself" + (sectionCovers.length ? " and its sections)" : ")") : " through its sections"}.` }
    : { id: "covers", status: "missing", detail: "covers nothing — generation would read an empty document.", fix: "create_document wires the document to what it covers; add_section wires each section to its curriculum." });

  checks.push(sections.length > 0
    ? { id: "sections", status: "ok", detail: `${sections.length} section(s)${sectionsCoveringNothing.length ? `; ${sectionsCoveringNothing.length} cover nothing (front matter, or a section still to wire)` : ""}.` }
    : { id: "sections", status: "missing", detail: "no sections — there is no page to produce.", fix: "add_section, one per slot, each naming what it covers." });

  checks.push(formatters.length > 0
    ? { id: "formatter", status: "ok", detail: `${formatters.length} formatter(s) attached: ${formatters.map((id) => `« ${titleOf(byId.get(id))} »`).join(", ")}.` }
    : { id: "formatter", status: "missing", detail: "no formatter attached — nothing says what a page looks like.", fix: "use_formatter from the catalog, or duplicate_entry to adapt one." });

  const stack = formatterStackFor(model, tlmId) ?? [];
  const render = resolveRenderSpec(stack);
  if (!render.ok) {
    checks.push({ id: "render", status: "missing", detail: `a formatter's layout settings are invalid: ${render.errors.join("; ")}`, fix: "edit_nodes on that formatter (properties.render)." });
  } else if (render.from.length === 0) {
    checks.push({ id: "render", status: "missing", detail: "no formatter declares layout settings (`render`) — render_document and the page check refuse this document.", fix: "edit_nodes on the formatter with properties.render (page, type, budget, blocks, images…)." });
  } else {
    checks.push({ id: "render", status: "ok", detail: `layout settings declared by ${render.from.length} formatter(s).` });
  }

  const layout = resolveLayout(stack);
  if (!layout.ok) {
    checks.push({ id: "layout", status: "missing", detail: `a formatter's page templates are invalid: ${layout.errors.join("; ")}`, fix: "edit_nodes on that formatter (properties.layout)." });
  } else if (layout.templates.length === 0) {
    checks.push({ id: "layout", status: "info", detail: "no page templates (`layout`) — every page is composed by the model from its guide, which is fine for prose and slow and variable for repeated shapes.", fix: "edit_nodes on the formatter with properties.layout, once the page shape repeats." });
  } else {
    checks.push({ id: "layout", status: "ok", detail: `${layout.templates.length} page template(s): ${layout.templates.map((t) => t.name).join(", ")} — compose_section fills what they cover.` });
  }

  checks.push(rubrics.length > 0
    ? { id: "rubric", status: "ok", detail: `${rubrics.length} evaluation grid(s) attached — evaluate_document scores against them.` }
    : { id: "rubric", status: "info", detail: "no evaluation grid attached — evaluate_document has nothing to score against.", fix: "use_rubric from the catalog." });

  const routineCarriers = new Set<string>([tlmId, ...sections, ...ancestorsVia(raw, [...documentCovers, ...sectionCovers], new Set([CONTAINMENT, STANDARDS_CONTAINMENT])), ...documentCovers, ...sectionCovers]);
  const routineEdge = raw.relationships.find((e) => e.type === ROUTINE_EDGE && routineCarriers.has(e.start));
  checks.push(routineEdge
    ? { id: "routine", status: "ok", detail: `a routine applies, carried by « ${titleOf(byId.get(routineEdge.start))} ».` }
    : { id: "routine", status: "info", detail: "no routine reaches this document — from itself, its sections, or the curriculum it covers.", fix: "use_routine on the document, or on the course it covers." });

  const ready = checks.every((c) => c.status !== "missing");
  return { document: { id: tlmId, title: titleOf(tlm) }, ready, checks };
}
