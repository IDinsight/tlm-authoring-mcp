/*
 * Compose a section's page from the graph and a layout template — no model.
 *
 * A pupil lesson is one section with nine child sections of three shapes, and
 * every word and picture on its page is already in the graph: the directive
 * is the covered activity's title, the picture hangs under that activity, the
 * marker is the section's rank among its siblings. What was missing was the
 * SHAPE, held in prose that a model re-read on every production. The layout
 * bag (kg-recipes/layout-spec.ts) holds that shape as a template; this fills
 * it. Same input, same page, every time — and a page composed here cannot
 * paraphrase a directive or place a picture under the wrong activity, because
 * it never transcribes: it copies.
 *
 * What it cannot fill it REPORTS, never invents: a child section matching no
 * template comes back in `unfilled` with its guide, for the model to compose;
 * a picture the template names but the covered node does not carry comes back
 * in `problems`. The teacher guide, which is prose, is always unfilled, and
 * that is correct.
 */

import type { CurriculumModel, RawGraphSnapshot } from "../types.js";
import type { Block, Cell, Run } from "../render/index.js";
import type { LayoutTemplate, TemplateBlock, TemplateCell } from "../kg-recipes/index.js";
import { picturesFor, type SectionPicture } from "./documents.js";

type RawNode = RawGraphSnapshot["nodes"][number];

const SECTION_LABEL = "DocumentSection";
const CONTAINMENT = "hasPart";
const COVERS = "covers";

const labelsOf = (node: RawNode | undefined): string[] => node?.labels ?? [];
const props = (node: RawNode | undefined): Record<string, unknown> => (node?.properties ?? {}) as Record<string, unknown>;
const titleOf = (node: RawNode | undefined): string => String(props(node).description ?? "").split("\n")[0].trim();
const stringProp = (node: RawNode | undefined, key: string): string => { const v = props(node)[key]; return typeof v === "string" ? v : ""; };
const positionOf = (node: RawNode): number => { const p = props(node).position; return typeof p === "number" ? p : Number.MAX_SAFE_INTEGER; };

/** A picture reference the composer resolves to a media entry the renderer takes. */
export type MediaRef = { name: string; nodeId: string } | { name: string; relPath: string };

/** How the composer learns a picture's shape: the file's width over its height, or null when unreadable. */
export type RatioOf = (ref: MediaRef) => Promise<number | null>;

export type ComposeResult = {
  blocks: Block[];
  media: MediaRef[];
  /** Child sections (or the root) that matched no template — the model's part. */
  unfilled: { id: string; title: string; guide: string }[];
  /** Which template filled which section, in order. */
  used: { sectionId: string; title: string; template: string }[];
  /** What a template asked for and the graph could not supply. */
  problems: string[];
};

/*
 * The facts a template may read for one section: the section, the node it
 * covers, that node's grouping, its pictures. All looked up once per section.
 */
type SectionFacts = {
  section: RawNode;
  covered: RawNode | undefined;
  grouping: RawNode | undefined;
  pictures: SectionPicture[];
  rank: number;   // 1-based, among siblings the same template matched
};

function childrenOf(raw: RawGraphSnapshot, parentId: string): RawNode[] {
  const ids = raw.relationships.filter((e) => e.type === CONTAINMENT && e.start === parentId).map((e) => e.end);
  return raw.nodes.filter((n) => ids.includes(n.id)).sort((a, b) => positionOf(a) - positionOf(b));
}

function parentOf(raw: RawGraphSnapshot, id: string): RawNode | undefined {
  const edge = raw.relationships.find((e) => e.type === CONTAINMENT && e.end === id);
  return edge ? raw.nodes.find((n) => n.id === edge.start) : undefined;
}

function coveredBy(raw: RawGraphSnapshot, sectionId: string): RawNode | undefined {
  const edge = raw.relationships.find((e) => e.type === COVERS && e.start === sectionId);
  return edge ? raw.nodes.find((n) => n.id === edge.end) : undefined;
}

// ── placeholders ─────────────────────────────────────────────────────────────

const PLACEHOLDER = /\{\{\s*([a-zA-Z.]+)\s*(?:\|\s*(match|upper)\s*(?::\s*([^}]*?))?\s*)?\}\}/g;

function valueOf(path: string, facts: SectionFacts, item: string | undefined): string {
  switch (path) {
    case "section.title": return titleOf(facts.section);
    case "covered.title": return titleOf(facts.covered);
    case "covered.name": return stringProp(facts.covered, "name") || titleOf(facts.covered);
    case "covered.content": return stringProp(facts.covered, "content");
    case "covered.ordinalName": return stringProp(facts.covered, "ordinalName");
    case "covered.grouping.title": return titleOf(facts.grouping);
    case "covered.grouping.ordinalName": return stringProp(facts.grouping, "ordinalName");
    case "item": return item ?? "";
    case "rank": return String(facts.rank);
    default: return "";
  }
}

function applyFilter(value: string, filter: string | undefined, argument: string | undefined): string {
  if (filter === "upper") return value.toUpperCase();
  if (filter === "match" && argument) {
    const m = value.match(new RegExp(argument, "u"));
    return m ? (m[1] ?? m[0]) : "";
  }
  return value;
}

function fillText(text: string, facts: SectionFacts, item: string | undefined): { text: string; usedCovered: boolean } {
  let usedCovered = false;
  const filled = text.replace(PLACEHOLDER, (_all, path: string, filter?: string, argument?: string) => {
    if (path.startsWith("covered.")) usedCovered = true;
    return applyFilter(valueOf(path, facts, item), filter, argument?.trim());
  });
  return { text: filled, usedCovered };
}

const contentLines = (facts: SectionFacts, match: string | undefined): string[] => {
  const lines = stringProp(facts.covered, "content").split("\n").map((l) => l.trim()).filter(Boolean);
  return match ? lines.filter((l) => new RegExp(match, "u").test(l)) : lines;
};

// ── filling ──────────────────────────────────────────────────────────────────

type Filler = {
  raw: RawGraphSnapshot;
  ratioOf: RatioOf;
  media: Map<string, MediaRef>;
  problems: string[];
};

type LineTemplate = Extract<TemplateBlock, { kind: "line" }>;

async function fillRuns(runs: LineTemplate["runs"], facts: SectionFacts, item: string | undefined, filler: Filler): Promise<{ runs: Run[]; usedCovered: boolean }> {
  const out: Run[] = [];
  let usedCovered = false;
  for (const run of runs) {
    if ("text" in run) {
      const filled = fillText(run.text, facts, item);
      usedCovered ||= filled.usedCovered;
      out.push(run.style ? { text: filled.text, style: run.style } : { text: filled.text });
      continue;
    }
    const image = run.image;
    let ref: MediaRef | undefined;
    if (image.picture) {
      const pattern = new RegExp(image.picture, "u");
      const picture = facts.pictures.find((p) => pattern.test(p.name));
      if (!picture) {
        filler.problems.push(`« ${titleOf(facts.section)} »: no attached picture matches /${image.picture}/ (attached: ${facts.pictures.map((p) => p.name).join(", ") || "none"}).`);
        continue;
      }
      ref = { name: picture.name, nodeId: picture.id };
      usedCovered = true;
    } else if (image.asset) {
      const relPath = "relPath" in image.asset ? image.asset.relPath : image.asset.byRank[Math.min(facts.rank, image.asset.byRank.length) - 1];
      ref = { name: relPath.split("/").pop() ?? relPath, relPath };
    }
    if (!ref) continue;
    const ratio = await filler.ratioOf(ref);
    if (ratio === null) {
      filler.problems.push(`« ${titleOf(facts.section)} »: the file behind '${ref.name}' cannot be read for its shape.`);
      continue;
    }
    filler.media.set(ref.name, ref);
    out.push({ image: { media: ref.name, role: image.role, aspectRatio: ratio, ...(image.float !== undefined ? { float: image.float } : {}) } });
  }
  return { runs: out, usedCovered };
}

async function fillBlocks(blocks: TemplateBlock[], facts: SectionFacts, filler: Filler, children: Block[]): Promise<Block[]> {
  const out: Block[] = [];
  for (const block of blocks) {
    if (block.kind === "children") { out.push(...children); continue; }
    if ((block.kind === "line" || block.kind === "table") && block.when && block.when.rank !== facts.rank) continue;
    if (block.kind === "spacer") { out.push({ kind: "spacer", sizePt: block.sizePt, leadingPt: block.leadingPt }); continue; }
    if (block.kind === "table") {
      const rows: Cell[][] = [];
      for (const row of block.rows) {
        const cells: Cell[] = [];
        for (const cell of row as TemplateCell[]) {
          cells.push({ blocks: await fillBlocks(cell.blocks, facts, filler, children), ...(cell.style ? { style: cell.style } : {}), ...(cell.span ? { span: cell.span } : {}) });
        }
        rows.push(cells);
      }
      out.push({ kind: "table", rows, ...(block.style ? { style: block.style } : {}), ...(block.columnsCm ? { columnsCm: block.columnsCm } : {}), ...(block.pageBreak ? { pageBreak: block.pageBreak } : {}) });
      continue;
    }
    // A line: once, or once per content line when it repeats.
    const items = block.forEach ? contentLines(facts, block.forEach.match) : [undefined];
    for (const item of items) {
      const filled = await fillRuns(block.runs, facts, item, filler);
      if (filled.runs.length === 0) continue;
      // A line built from the covered node carries its id: that is the anchor a
      // corrected document is read back by (render/propose.ts).
      const anchor = block.anchor === "none" ? undefined : (block.anchor === "covered" || filled.usedCovered) ? facts.covered?.id : undefined;
      out.push({
        kind: "line", runs: filled.runs,
        ...(anchor ? { anchor } : {}),
        ...(block.style ? { style: block.style } : {}),
        ...(block.variant ? { variant: block.variant } : {}),
        ...(block.pageBreak ? { pageBreak: block.pageBreak } : {}),
      });
    }
  }
  return out;
}

const matches = (template: LayoutTemplate, section: RawNode): boolean =>
  template.match.section === undefined || new RegExp(template.match.section, "u").test(titleOf(section));

function factsFor(model: CurriculumModel, raw: RawGraphSnapshot, section: RawNode, rank: number): SectionFacts {
  const covered = coveredBy(raw, section.id);
  return {
    section, covered, rank,
    grouping: covered ? parentOf(raw, covered.id) : undefined,
    pictures: picturesFor(model, section.id) ?? [],
  };
}

/**
 * Compose `sectionId` — its own template around its children's, in order.
 *
 * Templates are the resolved list for this section's formatter stack
 * (kg-recipes/layout-spec.ts::resolveLayout). Root templates fill the section
 * asked for; the others fill its child sections, each by the first template
 * whose pattern matches its title. A section no template matches is reported
 * in `unfilled`, and its place in the page is left for the model.
 */
export async function composeSection(model: CurriculumModel, sectionId: string, templates: LayoutTemplate[], ratioOf: RatioOf): Promise<ComposeResult | null> {
  const raw = model.rawGraph;
  if (!raw) return null;
  const section = raw.nodes.find((n) => n.id === sectionId);
  if (!section || !labelsOf(section).includes(SECTION_LABEL)) return null;

  const filler: Filler = { raw, ratioOf, media: new Map(), problems: [] };
  const result: ComposeResult = { blocks: [], media: [], unfilled: [], used: [], problems: filler.problems };
  const childTemplates = templates.filter((t) => !t.match.root);
  const rootTemplates = templates.filter((t) => t.match.root);

  // Children first: rank counts, per template, how many earlier siblings it filled.
  const filledPerTemplate = new Map<string, number>();
  const childBlocks: Block[] = [];
  for (const child of childrenOf(raw, sectionId)) {
    if (!labelsOf(child).includes(SECTION_LABEL)) continue;
    const template = childTemplates.find((t) => matches(t, child));
    if (!template) {
      result.unfilled.push({ id: child.id, title: titleOf(child), guide: String((props(child).metadata as Record<string, unknown> | undefined)?.assemblyGuide ?? "") });
      continue;
    }
    const rank = (filledPerTemplate.get(template.name) ?? 0) + 1;
    filledPerTemplate.set(template.name, rank);
    childBlocks.push(...await fillBlocks(template.blocks, factsFor(model, raw, child, rank), filler, []));
    result.used.push({ sectionId: child.id, title: titleOf(child), template: template.name });
  }

  const root = rootTemplates.find((t) => matches(t, section));
  if (root) {
    result.blocks = await fillBlocks(root.blocks, factsFor(model, raw, section, 1), filler, childBlocks);
    result.used.unshift({ sectionId: section.id, title: titleOf(section), template: root.name });
  } else {
    result.blocks = childBlocks;
    result.unfilled.unshift({ id: section.id, title: titleOf(section), guide: String((props(section).metadata as Record<string, unknown> | undefined)?.assemblyGuide ?? "") });
  }
  result.media = [...filler.media.values()];
  return result;
}
