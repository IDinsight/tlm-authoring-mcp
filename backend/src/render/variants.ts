/*
 * One tree, several files — and how a missing language gets filled in.
 *
 * CI maths composes ONE source and produces TWO documents. Black lines print in
 * both, red French lines only in the French file, blue Wolof only in the Wolof
 * one. That is `language.strategy: "per-file"`, and until now the renderer
 * honoured its COLOURS while ignoring the split: every line went into a single
 * file, so the French document carried the Wolof and vice versa.
 *
 * Two operations, kept apart on purpose:
 *
 *   • SPLIT is pure. Given a tree and a spec, decide which lines belong in
 *     which file. No network, no model, fully testable.
 *   • DERIVE is not. A tree composed in French has no Wolof lines to split out,
 *     so they have to be produced. The translator is injected rather than
 *     imported: this module must not know that Gemini exists, and a test must
 *     be able to derive a variant without spending a metered call.
 *
 * Tables SURVIVE the split even when everything inside them is dropped. A
 * banner is structure, not speech: the golden sheets carry the same banners in
 * both languages, and a file that lost them would be missing its scaffolding
 * rather than its translation.
 */
import type { RenderSpec } from "../kg-recipes/index.js";
import type { Block, Cell, DocumentTree, Run } from "./document.js";

/** One rendering of a document: which variant it is, and what it should be called. */
export type Variant = {
  id: string;
  lang: string;
  fileSuffix: string;
  tree: DocumentTree;
};

type SpecVariant = NonNullable<NonNullable<RenderSpec["language"]>["variants"]>[number];

/** Variants that get a file of their own — everything except the shared ones. */
function fileVariants(spec: RenderSpec): SpecVariant[] {
  return (spec.language?.variants ?? []).filter((v) => !v.inAllFiles);
}

/** Ids that print in EVERY file, plus lines with no variant at all. */
function sharedIds(spec: RenderSpec): Set<string> {
  return new Set((spec.language?.variants ?? []).filter((v) => v.inAllFiles).map((v) => v.id));
}

function keepBlocks(blocks: Block[], keep: (variant: string | undefined) => boolean): Block[] {
  const out: Block[] = [];
  for (const block of blocks) {
    if (block.kind === "line") {
      if (keep(block.variant)) out.push(block);
      continue;
    }
    if (block.kind === "table") {
      const rows: Cell[][] = block.rows.map((row) =>
        row.map((cell) => ({ ...cell, blocks: keepBlocks(cell.blocks, keep) })),
      );
      out.push({ ...block, rows });
      continue;
    }
    out.push(block);
  }
  return out;
}

/**
 * Split a tree into the files the formatter says it produces.
 *
 * Anything other than `per-file` — inline, monolingual, or a formatter that
 * says nothing about language — is ONE file carrying everything, which is the
 * behaviour every non-CI-maths document already relies on.
 */
export function splitByVariant(tree: DocumentTree, spec: RenderSpec): Variant[] {
  const variants = fileVariants(spec);
  if (spec.language?.strategy !== "per-file" || variants.length === 0) {
    return [{ id: "", lang: "", fileSuffix: "", tree }];
  }

  const shared = sharedIds(spec);
  return variants.map((variant) => ({
    id: variant.id,
    lang: variant.lang,
    fileSuffix: variant.fileSuffix ?? `-${variant.id.toUpperCase()}`,
    tree: {
      ...tree,
      blocks: keepBlocks(tree.blocks, (v) => v === undefined || v === variant.id || shared.has(v)),
    },
  }));
}

/*
 * What `deriveVariant` needs of a translator — EVERY line of the page in one
 * call, back in the same order.
 *
 * It took one line at a time until a real render timed out: a teacher sheet
 * has ~22 spoken lines, each round trip to the translator is a few seconds,
 * and in sequence that is three minutes against a client that gives up after
 * three. The `translate` tool did the same lines in fifteen seconds because it
 * sends them together. So the contract is the batch, and the caller decides how
 * many run at once.
 */
export type TranslateLines = (texts: string[], from: string, to: string) => Promise<string[]>;

/**
 * Produce a variant's lines from another's, by translating.
 *
 * Every `from` line is duplicated as a `to` line, keeping its style, its
 * pictures and its place, with the text runs translated. The derived line sits
 * IMMEDIATELY AFTER its source rather than in a block at the end, because that
 * is the only way a page break, a banner or a picture still lands between the
 * right two lines once the split drops the other language.
 *
 * A tree that already has `to` lines is returned untouched — deriving over the
 * top would double them, and translating what an author wrote by hand is the
 * one thing this must never do.
 */
export async function deriveVariant(
  tree: DocumentTree, from: string, to: string, fromLang: string, toLang: string,
  translateLines: TranslateLines,
): Promise<DocumentTree> {
  if (anyVariant(tree.blocks, to)) return tree;

  // Two passes: gather what needs translating, translate it all at once, then
  // build the derived lines by handing each run its result in order.
  const sources = textsToTranslate(tree.blocks, from);
  if (sources.length === 0) return tree;
  const translations = await translateLines(sources, fromLang, toLang);
  if (translations.length !== sources.length) {
    throw new Error(`the translator returned ${translations.length} line(s) for ${sources.length} sent`);
  }

  let next = 0;
  const derive = (blocks: Block[]): Block[] => {
    const out: Block[] = [];
    for (const block of blocks) {
      if (block.kind === "table") {
        const rows: Cell[][] = block.rows.map((row) => row.map((cell) => ({ ...cell, blocks: derive(cell.blocks) })));
        out.push({ ...block, rows });
        continue;
      }
      out.push(block);
      if (block.kind !== "line" || block.variant !== from) continue;

      const runs: Run[] = block.runs.map((run) => {
        if (!isTranslated(run)) return run;
        return { ...run, text: translations[next++] };
      });
      // The page break belongs to the SOURCE line: two lines both starting a
      // page would leave a blank one in whichever file kept both.
      const { pageBreak, ...rest } = block;
      void pageBreak;
      out.push({ ...rest, variant: to, runs });
    }
    return out;
  };

  return { ...tree, blocks: derive(tree.blocks) };
}

/*
 * Which runs the translator sees: text with words in it, unless the run says
 * `translate: false`. A blank run and a picture are kept as they are; so is a
 * run the composer pinned — the parenthesis after a speech line, which the
 * teacher sheet prints in French in both files.
 */
const isTranslated = (run: Run): run is Extract<Run, { text: string }> =>
  "text" in run && run.text.trim().length > 0 && run.translate !== false;

/** The text runs of every `from` line, in reading order — blank and pinned runs excluded, they are kept as they are. */
function textsToTranslate(blocks: Block[], from: string): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    if (block.kind === "table") {
      for (const row of block.rows) for (const cell of row) out.push(...textsToTranslate(cell.blocks, from));
      continue;
    }
    if (block.kind !== "line" || block.variant !== from) continue;
    for (const run of block.runs) {
      if (isTranslated(run)) out.push(run.text);
    }
  }
  return out;
}

/** Does this tree already carry lines in the given variant? */
export function hasVariant(tree: DocumentTree, id: string): boolean {
  return anyVariant(tree.blocks, id);
}

function anyVariant(blocks: Block[], id: string): boolean {
  return blocks.some((block) =>
    block.kind === "line" ? block.variant === id
      : block.kind === "table" ? block.rows.some((row) => row.some((cell) => anyVariant(cell.blocks, id)))
        : false,
  );
}
