/*
 * Module: curriculum · the lint rules that read a COMPOSED PAGE
 *
 * The block-tree half of lint_content. Its graph siblings (lint-content.ts) ask
 * whether the authored data contradicts itself; these ask whether the page a
 * model has just composed contradicts the geometry it is about to be laid out
 * with. Both are consistency questions; they differ only in what they read, and
 * that is why `ContentRule.requires` exists.
 *
 * WHY THIS COULD NOT BE WRITTEN BEFORE, AND CAN BE NOW. Every rule here needs
 * two things at once: a block tree, and the merged `render` spec that governs
 * it. The tree arrived with the renderer (WP4) and the spec with the geometry
 * read-back, so `requires: "blockTree"` sat advertised-but-empty until both
 * existed. Nothing about the interface changed to accommodate them.
 *
 * WHAT IS DELIBERATELY NOT HERE. The thirty control points a CI-maths fiche is
 * checked against — speech-colour purity, the A/B/C answer labels, « aucun appel
 * {pt:} resté en clair » — are SUBJECT knowledge, and they stay in the subject's
 * guide where a curator can change them without a deploy. A rule here may only
 * ask a question whose answer comes from the DATA: the limit is in the render
 * bag, the style name is in the formatter, the media list is in the document. An
 * `if (subject === …)` in this file would mean the whole split had failed.
 *
 * Which is not a lesser check. Every rule below catches a failure that renders
 * SUCCESSFULLY and wrongly — a mistyped style silently becomes body text, an
 * unknown picture silently becomes a different picture — and those are the ones
 * a human proof-reader is worst at.
 */
import type { LintFinding } from "../kg-store/index.js";
import { missingMediaNames } from "../render/index.js";
import type { Block, Cell, DocumentTree } from "../render/index.js";
import type { RenderSpec } from "../kg-recipes/index.js";

/** A composed page, and the geometry it will be laid out with. */
export type PageInput = {
  /** The block tree, as `render_document` would receive it. */
  tree: Pick<DocumentTree, "blocks"> & { media?: { name: string }[] };
  /** The formatter stack's merged `render` bag. */
  spec: RenderSpec;
  /** The node this page was composed for — every finding is reported against it. */
  scopeId: string;
  /** Rules to skip here, from the scope node's `metadata.lintIgnore`. */
  ignore?: Set<string>;
};

// ── Walking the tree ─────────────────────────────────────────────────────────
// A cell holds blocks and a block may be a table, so everything here recurses.
// The pupil tool's answer grids are tables inside tables; a walker that stopped
// at the first level would miss most of a page.

/** Every block in the tree, at any depth, in reading order. */
function* everyBlock(blocks: readonly Block[]): Generator<Block> {
  for (const block of blocks) {
    yield block;
    if (block.kind === "table") {
      for (const row of block.rows) {
        for (const cell of row as Cell[]) {
          yield* everyBlock(cell.blocks);
        }
      }
    }
  }
}

/** Every `style` name the tree uses, wherever it appears. */
function stylesUsed(tree: PageInput["tree"]): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (style: string | undefined) => {
    if (style) counts.set(style, (counts.get(style) ?? 0) + 1);
  };
  for (const block of everyBlock(tree.blocks)) {
    bump(block.kind === "spacer" ? undefined : block.style);
    if (block.kind === "line") {
      for (const run of block.runs) {
        if ("text" in run) bump(run.style);
      }
    }
    if (block.kind === "table") {
      for (const row of block.rows) {
        for (const cell of row as Cell[]) bump(cell.style);
      }
    }
  }
  return counts;
}

/** The visible text of one line, its runs joined. */
const lineText = (block: Block): string =>
  block.kind === "line" ? block.runs.map((run) => ("text" in run ? run.text : "")).join("") : "";

/** Every picture the tree places. */
function imagesUsed(tree: PageInput["tree"]): { media: string; role: string }[] {
  const out: { media: string; role: string }[] = [];
  for (const block of everyBlock(tree.blocks)) {
    if (block.kind !== "line") continue;
    for (const run of block.runs) {
      if ("image" in run) out.push({ media: run.image.media, role: run.image.role });
    }
  }
  return out;
}

// ── The rules ────────────────────────────────────────────────────────────────

export type PageRule = {
  id: string;
  summary: string;
  check: (input: PageInput) => LintFinding[];
};

const finding = (input: PageInput, rule: string, message: string, fix: string): LintFinding => ({
  rule,
  severity: "warning",
  nodeId: input.scopeId,
  title: "composed page",
  message,
  fix,
});

/*
 * A style the formatter stack does not define.
 *
 * The failure this catches is silent by construction: the renderer looks the
 * name up, finds nothing, and lays the block out with the body defaults. So a
 * `phaseBanner` mistyped as `phasebanner` produces a page that renders, passes a
 * page count, and has lost its banners — and the only way to notice is to look.
 */
const unknownBlockStyle: PageRule = {
  id: "page-unknown-block-style",
  summary: "Every `style` the page names must be defined in the formatter stack's `render.blocks`.",
  check: (input) => {
    const defined = new Set(Object.keys(input.spec.blocks ?? {}));
    // A stack that declares NO block styles at all is a different problem — the
    // formatter carries no geometry — and render_document already refuses it.
    // Reporting every style here as unknown would just be noise on top.
    if (defined.size === 0) return [];

    const unknown = [...stylesUsed(input.tree).entries()].filter(([style]) => !defined.has(style));
    if (unknown.length === 0) return [];

    const named = unknown.map(([style, count]) => `'${style}' (${count}×)`).join(", ");
    return [finding(
      input, "page-unknown-block-style",
      `The page names ${unknown.length} style(s) the formatter stack does not define: ${named}. Defined: ${[...defined].sort().join(", ")}.`,
      "Either use a defined style name, or add the missing one to the formatter's `render.blocks`. Left as it is, the renderer falls back to the body defaults — the document will render, and those blocks will silently lose their styling.",
    )];
  },
};

/*
 * A line longer than its own style says it may be.
 *
 * `maxChars` is a budget somebody measured on a real page, so exceeding it does
 * not fail — it wraps, and the sheet grows by a line it was not costed for. The
 * limit comes from the data, which is what makes this rule subject-agnostic.
 */
const lineOverMaxChars: PageRule = {
  id: "page-line-over-max-chars",
  summary: "A line must not exceed the `maxChars` its own style declares.",
  check: (input) => {
    const blocks = input.spec.blocks ?? {};
    const over: string[] = [];

    for (const block of everyBlock(input.tree.blocks)) {
      if (block.kind !== "line" || !block.style) continue;
      const limit = blocks[block.style]?.maxChars;
      if (typeof limit !== "number") continue;
      const text = lineText(block);
      if (text.length > limit) {
        over.push(`'${block.style}' allows ${limit}, one line has ${text.length}: “${text.slice(0, 60)}${text.length > 60 ? "…" : ""}”`);
      }
    }
    if (over.length === 0) return [];

    return [finding(
      input, "page-line-over-max-chars",
      `${over.length} line(s) exceed the character budget their style declares. ${over.slice(0, 5).join("; ")}${over.length > 5 ? `; +${over.length - 5} more` : ""}.`,
      "Shorten the line, or raise `maxChars` on that style if the budget itself is wrong. These budgets were measured on a real page, so an over-long line wraps and the sheet grows by a line nobody costed for — which is how a two-page fiche becomes three.",
    )];
  },
};

/*
 * More pictures than the geometry allows.
 *
 * Worth having for a second reason beyond the obvious. A cap the prose has
 * abandoned goes on sitting in the render bag, where a code-driven renderer will
 * enforce it to the letter — the live ci/maths bag still carries the two-image
 * ceiling its prose dropped. A rule that fires on the cap makes it visible; a
 * silent renderer just crops the page.
 */
const imagesOverCap: PageRule = {
  id: "page-images-over-cap",
  summary: "A page must not place more pictures than `render.images.maxPerSection` allows.",
  check: (input) => {
    const cap = input.spec.images?.maxPerSection;
    if (typeof cap !== "number") return [];
    const images = imagesUsed(input.tree);
    if (images.length <= cap) return [];

    return [finding(
      input, "page-images-over-cap",
      `The page places ${images.length} picture(s); the formatter's images.maxPerSection allows ${cap}.`,
      "Remove pictures, or raise the cap. CHECK WHICH before you cut: a cap the formatter's prose has abandoned can still be sitting in its `render` bag, and cropping a good page to satisfy a stale number is the wrong repair. Read the formatter's own prose (walk_document_section) and make the two agree.",
    )];
  },
};

/*
 * A picture the document does not carry.
 *
 * The most dangerous rule here. The renderer resolves a picture's relationship
 * id with `?? "rId1"` — so a name that matches no media entry does not fail, it
 * renders THE FIRST PICTURE IN THE DOCUMENT instead. The output looks finished
 * and is wrong, on a page nobody has reason to re-examine.
 */
const missingMedia: PageRule = {
  id: "page-missing-media",
  summary: "Every picture the page places must name a file the document carries.",
  check: (input) => {
    // The same function render_document refuses on, so a page that passes this
    // rule cannot then be refused at render time for this reason.
    const missing = missingMediaNames(input.tree);
    if (missing.length === 0) return [];
    const carried = new Set((input.tree.media ?? []).map((entry) => entry.name));

    return [finding(
      input, "page-missing-media",
      `The page places ${missing.length} picture(s) that are not in the document's own \`media\`: ${missing.map((name) => `'${name}'`).join(", ")}. Carried: ${carried.size === 0 ? "(none)" : [...carried].sort().join(", ")}.`,
      "Add each file to `media`, or correct the name. This one must not be shipped past: the renderer falls back to the document's FIRST picture for a name it cannot resolve, so the page comes out looking complete with the wrong image in that slot.",
    )];
  },
};

export const PAGE_RULES: PageRule[] = [unknownBlockStyle, lineOverMaxChars, imagesOverCap, missingMedia];

/** Run every page rule (minus those the scope node silences). */
export function lintPage(input: PageInput): LintFinding[] {
  return PAGE_RULES
    .filter((rule) => !input.ignore?.has(rule.id))
    .flatMap((rule) => rule.check(input));
}
