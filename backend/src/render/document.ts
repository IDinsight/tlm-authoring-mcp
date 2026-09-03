/*
 * The block tree: what an authoring model hands the renderer.
 *
 * Two halves already exist for a document. `content` prose is what a person
 * writes and what the authoring model reads; `properties.render` is the
 * formatter's declarative geometry. Neither of them says what is actually ON
 * this page — which banner, then which lines, then which picture — and neither
 * should: that varies per lesson, it is authored, and on the live CI-maths
 * graph it is 2-8 KB of French guidance per section.
 *
 * So the model composes it, and this schema is the contract it composes to.
 *
 * WHAT BELONGS HERE, AND WHAT DOES NOT:
 *
 *   • STRUCTURE belongs here: the order of blocks, which cell holds what, which
 *     line starts a page, which picture goes where. This is the per-lesson
 *     decision.
 *
 *   • GEOMETRY DOES NOT. There is no colour, no point size, no margin, no
 *     centimetre in this file. A block names a `style` and a picture names a
 *     `role`, and the formatter says what those look like. That split is the
 *     whole WP3 argument, and it is enforced here by omission: a model that
 *     wanted to set a colour would have nowhere to put it.
 *
 * STRICT, like the render spec: unknown keys are REFUSED. A model that invents
 * `bold: true` on a line should be told so at authoring time, not have it
 * silently dropped at render time.
 */
import { z } from "zod";

/** A name the formatter defines — "phaseBanner", "bullet", "title". */
const styleName = z.string().min(1).max(64);

/*
 * One picture.
 *
 * `role` is what the formatter sizes it by, and it is AUTHORED rather than
 * derived. The two live document types settle that: the teacher sheet's three
 * roles happen to be separable by shape — a band is wide, an opening scene
 * taller, a pictogram tiny — but the pupil tool has seven distinct sizes and
 * five of them are square. Nothing about the file says which is a 4.99 cm
 * answer and which a 0.46 cm sign. A renderer that guessed would be right on
 * one document type and quietly wrong on the other.
 */
const imageRunSchema = z.object({
  media: z.string().min(1),          // file name in the document's own media
  role: z.string().min(1).max(64),
  aspectRatio: z.number().positive(),
  // Whether it floats beside the text. WHERE a floated picture goes is the
  // formatter's (images.placement); whether THIS one floats is per-section.
  float: z.boolean().optional(),
}).strict();

const runSchema = z.union([
  z.object({ text: z.string(), style: styleName.optional() }).strict(),
  z.object({ image: imageRunSchema }).strict(),
]);

/*
 * The recursive half.
 *
 * A cell holds BLOCKS, not a string, and a block may be another table. That is
 * not generality for its own sake: the pupil tool's answer grids are tables
 * inside tables, and a model that made a cell a string dropped all 42 of its
 * pictures.
 */
export const blockSchema: z.ZodType<Block> = z.lazy(() =>
  z.discriminatedUnion("kind", [tableSchema, lineSchema, spacerSchema]),
) as z.ZodType<Block>;

const cellSchema: z.ZodType<Cell> = z.lazy(() =>
  z.object({
    blocks: z.array(blockSchema),
    style: styleName.optional(),
    span: z.number().int().positive().optional(),
  }).strict(),
) as z.ZodType<Cell>;

const tableSchema = z.object({
  kind: z.literal("table"),
  anchor: z.string().min(1).max(200).optional(),
  rows: z.array(z.array(cellSchema)).min(1),
  style: styleName.optional(),
  // Column widths, when the document sets them rather than dividing the page.
  columnsCm: z.array(z.number().positive()).optional(),
  // WHERE a page starts. HOW the break is written is the formatter's
  // `pagination.pageBreakCarrier` — the teacher sheet hangs it off a banner's
  // paragraph property, the pupil tool gives it a paragraph of its own, and
  // getting that backwards leaves a blank page.
  pageBreak: z.literal("before").optional(),
}).strict();

const lineSchema = z.object({
  kind: z.literal("line"),
/*
 * Where this block came from in the graph.
 *
 * The reason a corrected document can be read BACK. A sheet produced by the old
 * pipeline carried nothing that tied a line to a node — matching one up again
 * meant guessing from position and wording, which is why reading corrections in
 * was written off as infeasible. It was infeasible for documents we did not
 * produce. We produce these, so the renderer writes the node id into the file
 * as a Word content control, invisible on the page and preserved when a person
 * edits around it.
 *
 * Optional, and deliberately so: a block invented for layout (a spacer, a
 * banner that announces rather than quotes) belongs to no node and says so by
 * leaving this out.
 */
  anchor: z.string().min(1).max(200).optional(),
  runs: z.array(runSchema),
  // Which rendering this line belongs to — "fr", "wo", or one that prints in
  // every file. Named in the formatter's `language.variants`.
  variant: z.string().min(1).max(64).optional(),
  style: styleName.optional(),
  pageBreak: z.literal("before").optional(),
}).strict();

/*
 * Furniture between blocks.
 *
 * Its two numbers are geometry and they are here anyway, because the render
 * spec has no key for inter-block spacing. That is a finding rather than a
 * decision: when the spec grows one, this loses them.
 */
const spacerSchema = z.object({
  kind: z.literal("spacer"),
  sizePt: z.number().positive(),
  leadingPt: z.number().positive(),
}).strict();

export type ImageRun = z.infer<typeof imageRunSchema>;
export type Run = z.infer<typeof runSchema>;
export type Cell = {
  blocks: Block[];
  style?: string;
  span?: number;
};
export type Block =
  | { kind: "table"; rows: Cell[][]; style?: string; columnsCm?: number[]; pageBreak?: "before"; anchor?: string }
  | { kind: "line"; runs: Run[]; variant?: string; style?: string; pageBreak?: "before"; anchor?: string }
  | { kind: "spacer"; sizePt: number; leadingPt: number };

/** A whole document: its blocks, and the pictures they name. */
export const documentSchema = z.object({
  blocks: z.array(blockSchema),
  // Each entry is a file the document embeds; `data` is base64 on the wire.
  media: z.array(z.object({
    name: z.string().min(1),
    data: z.string(),
  }).strict()).optional(),
}).strict();

export type DocumentTree = { blocks: Block[]; media: { name: string; data: Buffer }[] };

/**
 * Validate a block tree, returning caller-facing error strings.
 *
 * Phrased like the render spec's: the path first, so a model that gets one
 * cell wrong is told which cell rather than that "the document is invalid".
 */
export function validateDocumentTree(tree: unknown): string[] {
  const result = documentSchema.safeParse(tree);
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "(root)";
    return `document.${path}: ${issue.message}`;
  });
}
