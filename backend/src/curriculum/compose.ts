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
import type { GuideGrammar, LayoutTemplate, TemplateBlock, TemplateCell } from "../kg-recipes/index.js";
import { picturesFor, type SectionPicture } from "./documents.js";
import { compileGuide, type GuideCompileReport } from "./guide-compile.js";
import type { MediaRef, RatioOf } from "./compose-types.js";

export type { MediaRef, RatioOf } from "./compose-types.js";

type RawNode = RawGraphSnapshot["nodes"][number];

const SECTION_LABEL = "DocumentSection";
const CONTAINMENT = "hasPart";
const COVERS = "covers";

const labelsOf = (node: RawNode | undefined): string[] => node?.labels ?? [];
const props = (node: RawNode | undefined): Record<string, unknown> => (node?.properties ?? {}) as Record<string, unknown>;
const titleOf = (node: RawNode | undefined): string => String(props(node).description ?? "").split("\n")[0].trim();
const stringProp = (node: RawNode | undefined, key: string): string => { const v = props(node)[key]; return typeof v === "string" ? v : ""; };
const positionOf = (node: RawNode): number => { const p = props(node).position; return typeof p === "number" ? p : Number.MAX_SAFE_INTEGER; };

/** What a caller may hand the composer beyond the templates: the guide grammar and the one geometry value a float needs. */
export type ComposeOptions = {
  grammar?: GuideGrammar;
  /** A picture wider than this does not float (the stack's `images.fullWidthAboveAspectRatio`). */
  floatUnlessRatioAbove?: number;
};

export type ComposeResult = {
  blocks: Block[];
  media: MediaRef[];
  /** What the guide compiler did per section a template handed it — lines printed and kept, pictures placed, what it could not resolve. */
  compiled: GuideCompileReport[];
  /*
   * The model's part: child sections (or the root) that matched no template,
   * and every HOLE a template left (`{kind:"unfilled"}`). `insertAt` is the
   * block path where the hole was — an `insert-before` patch on the composed
   * tree's ref lands the lines there. Fill holes from the LAST to the first:
   * an insertion shifts every path after it.
   */
  unfilled: { id: string; title: string; guide: string; insertAt?: string }[];
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

// A placeholder is a value path and a CHAIN of filters, applied left to right:
// `{{covered.ordinalName|match:Leçon (\d+)|ceil-div:5}}` reads the lesson's
// number out of its ordinal name, then the week it falls in. A `|` inside a
// filter's argument is not supported — the chain is split on it.
const PLACEHOLDER = /\{\{\s*([a-zA-Z.]+)\s*((?:\|[^|}]*)*)\s*\}\}/g;

function valueOf(path: string, facts: SectionFacts, item: string | undefined): string {
  switch (path) {
    case "section.title": return titleOf(facts.section);
    // The section's own assembly guide: a template pulls ONE labelled line
    // out of it with `match` (the matériel list, say), never the whole.
    case "section.guide": return String((props(facts.section).metadata as { assemblyGuide?: unknown } | undefined)?.assemblyGuide ?? "");
    case "covered.position": { const p = props(facts.covered).position; return typeof p === "number" ? String(p) : ""; }
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
    // Multiline, so `^…$` picks one line out of a guide.
    const m = value.match(new RegExp(argument, "mu"));
    return m ? (m[1] ?? m[0]) : "";
  }
  // Two integer filters an ordinal-derived label needs: the week a lesson
  // falls in (⌈n/5⌉) and its day in that week (((n−1) mod 5)+1). Generic
  // arithmetic; what 5 means is the template's business.
  const n = Number(value), k = Number(argument);
  if (filter === "ceil-div" && Number.isFinite(n) && k > 0) return String(Math.ceil(n / k));
  if (filter === "mod-1based" && Number.isFinite(n) && k > 0) return String(((n - 1) % k) + 1);
  return value;
}

/** The filters of a placeholder chain, in order — `|match:…|ceil-div:5` → two steps. Exported for its tests. */
export function applyFilterChain(value: string, chain: string): string {
  return chain.split("|").map((step) => step.trim()).filter(Boolean).reduce((current, step) => {
    const colon = step.indexOf(":");
    const filter = colon < 0 ? step : step.slice(0, colon).trim();
    const argument = colon < 0 ? undefined : step.slice(colon + 1).trim();
    return applyFilter(current, filter, argument);
  }, value);
}

function fillText(text: string, facts: SectionFacts, item: string | undefined): { text: string; usedCovered: boolean } {
  let usedCovered = false;
  const filled = text.replace(PLACEHOLDER, (_all, path: string, chain: string) => {
    if (path.startsWith("covered.")) usedCovered = true;
    return applyFilterChain(valueOf(path, facts, item), chain ?? "");
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
  /** The grammar a `guide` block compiles by; absent, such a block is a hole with a problem. */
  grammar?: GuideGrammar;
  floatUnlessRatioAbove?: number;
  /** The pictures of the page being composed — a phase may name a picture the lesson, not the phase, carries. */
  pagePictures: SectionPicture[];
  compiled: GuideCompileReport[];
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
      // The teacher's copy gets a name of its own: the plain band may sit on
      // another page of the same document, and a name is one set of bytes.
      ref = image.mark
        ? { name: `${picture.name}-${image.mark}`, nodeId: picture.id, mark: image.mark }
        : { name: picture.name, nodeId: picture.id };
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

/*
 * A hole, while the tree is being built: a block that is not a block. It
 * carries the section whose lines belong there and is removed — its path
 * recorded — once the whole page stands, because only then is its index final.
 */
const HOLE = "__unfilled__";
type Hole = { kind: typeof HOLE; sectionId: string };
const isHole = (block: unknown): block is Hole => (block as Hole)?.kind === HOLE;

async function fillBlocks(blocks: TemplateBlock[], facts: SectionFacts, filler: Filler, children: Block[]): Promise<Block[]> {
  const out: Block[] = [];
  for (const block of blocks) {
    if (block.kind === "children") { out.push(...children); continue; }
    if (block.kind === "unfilled") { out.push({ kind: HOLE, sectionId: facts.section.id } as unknown as Block); continue; }
    if (block.kind === "guide") {
      // Without a grammar the block is a hole, and said so: the template asked
      // for a compilation the stack cannot do, which is a formatter defect.
      if (!filler.grammar) {
        filler.problems.push(`« ${titleOf(facts.section)} »: the template compiles the section's guide, but no formatter on the stack declares 'layout.guide' (the grammar); the section is left as a hole.`);
        out.push({ kind: HOLE, sectionId: facts.section.id } as unknown as Block);
        continue;
      }
      const seen = new Set(facts.pictures.map((p) => p.id));
      const compiled = await compileGuide({
        guide: String((props(facts.section).metadata as { assemblyGuide?: unknown } | undefined)?.assemblyGuide ?? ""),
        grammar: filler.grammar,
        sectionId: facts.section.id,
        sectionTitle: titleOf(facts.section),
        pictures: [...facts.pictures, ...filler.pagePictures.filter((p) => !seen.has(p.id))],
        vars: block.vars ?? {},
        ratioOf: filler.ratioOf,
        media: filler.media,
        ...(filler.floatUnlessRatioAbove !== undefined ? { floatUnlessRatioAbove: filler.floatUnlessRatioAbove } : {}),
      });
      out.push(...compiled.blocks);
      filler.compiled.push(compiled.report);
      for (const item of compiled.report.unresolved) filler.problems.push(`« ${titleOf(facts.section)} »: ${item.reason} — « ${item.line} »`);
      continue;
    }
    if ((block.kind === "line" || block.kind === "table") && block.when && block.when.rank !== facts.rank) continue;
    if (block.kind === "spacer") { out.push({ kind: "spacer", sizePt: block.sizePt, leadingPt: block.leadingPt }); continue; }
    if (block.kind === "clear") { out.push({ kind: "clear" }); continue; }
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
export async function composeSection(model: CurriculumModel, sectionId: string, templates: LayoutTemplate[], ratioOf: RatioOf, options: ComposeOptions = {}): Promise<ComposeResult | null> {
  const raw = model.rawGraph;
  if (!raw) return null;
  const section = raw.nodes.find((n) => n.id === sectionId);
  if (!section || !labelsOf(section).includes(SECTION_LABEL)) return null;

  const filler: Filler = {
    raw, ratioOf, media: new Map(), problems: [], compiled: [],
    pagePictures: picturesFor(model, sectionId) ?? [],
    ...(options.grammar ? { grammar: options.grammar } : {}),
    ...(options.floatUnlessRatioAbove !== undefined ? { floatUnlessRatioAbove: options.floatUnlessRatioAbove } : {}),
  };
  const result: ComposeResult = { blocks: [], media: [], compiled: filler.compiled, unfilled: [], used: [], problems: filler.problems };
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

  // The holes, now that every index is final: each one leaves the tree and
  // its section joins `unfilled` with the path to patch the lines in at. In
  // page order, so a caller filling from the last hole up never shifts a path
  // it has yet to use.
  const guideOf = (id: string) => String((props(raw.nodes.find((n) => n.id === id)).metadata as Record<string, unknown> | undefined)?.assemblyGuide ?? "");
  const holes = removeHoles(result.blocks, "blocks");
  for (const hole of holes) {
    const node = raw.nodes.find((n) => n.id === hole.sectionId);
    result.unfilled.push({ id: hole.sectionId, title: titleOf(node), guide: guideOf(hole.sectionId), insertAt: hole.insertAt });
  }
  return result;
}

/** Strip the hole sentinels out of a block list (cells included), returning where each was. */
function removeHoles(blocks: Block[], path: string): { sectionId: string; insertAt: string }[] {
  const found: { sectionId: string; insertAt: string }[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const maybeHole: unknown = block;
    if (isHole(maybeHole)) {
      found.push({ sectionId: maybeHole.sectionId, insertAt: `${path}[${i}]` });
      blocks.splice(i, 1);
      i -= 1;
      continue;
    }
    if (block.kind === "table") {
      block.rows.forEach((row, r) => row.forEach((cell, c) => found.push(...removeHoles(cell.blocks, `${path}[${i}].rows[${r}][${c}].blocks`))));
    }
  }
  return found;
}
