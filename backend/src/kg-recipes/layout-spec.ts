/*
 * The formatter's `layout` bag — a page's STRUCTURE as data.
 *
 * `render` (render-spec.ts) carries geometry: what a page looks like. It was
 * decided, and stays decided, that it carries no structure — which blocks
 * appear and in what order. Until now structure lived only in prose, in each
 * section's assembly guide, and a model re-read that prose and composed the
 * page again on every production; the 12 September note found the result
 * non-deterministic, and the pupil page it described is nine sections of the
 * same three shapes.
 *
 * `layout` is where that structure now lives, still as authored data, still
 * per subject: a list of TEMPLATES, each a block tree in the very shape
 * render_document accepts, with placeholders where the graph supplies the
 * value. A template matches a section by its title; the composer
 * (curriculum/compose.ts) fills it from the section's covered node and its
 * attached pictures. What the code knows is block kinds, placeholders and
 * matching. What a page of THIS subject looks like — the box, the band under
 * its directive, the marker at the head of a line — is in the graph.
 *
 * Placeholders, inside any `text`:
 *   {{section.title}}  {{covered.title}}  {{covered.name}}  {{covered.content}}
 *   {{covered.ordinalName}}  {{covered.grouping.title}}  {{covered.grouping.ordinalName}}
 *   {{item}} (inside forEach)  {{rank}} (1-based, among siblings this template matched)
 *   with an optional filter: {{covered.ordinalName|match:Leçon (\d+)}} keeps group 1,
 *   {{covered.name|upper}} upper-cases.
 *
 * A template may also hand a section's own GUIDE to the compiler
 * (`{kind: "guide"}`, curriculum/guide-compile.ts): the guide's lines become
 * the page's lines by the GRAMMAR the same bag declares under `guide` —
 * which line prefixes print and in which voice, how a phrase of the
 * repertoire is called and what it says, how a picture is named and marked,
 * which inline assets a line may carry. The grammar is the subject's; the
 * compiler knows only that a line matches a pattern and what each pattern
 * yields. A subject whose guides are free prose declares none and keeps its
 * holes.
 */

import { z } from "zod";

const styleName = z.string().min(1).max(64);
const regexSource = z.string().min(1).max(200);

const textRunSchema = z.object({
  text: z.string(),
  style: styleName.optional(),
}).strict();

/*
 * A picture in a template names WHICH picture two ways: `picture` is a
 * regular expression over the names of the pictures attached to the covered
 * node (attach_image's `name`), `asset` a fixed file in the namespace's
 * documents area — one path, or one per rank for a marker that changes with
 * the section's position among its siblings.
 */
const imageRunSchema = z.object({
  image: z.object({
    role: z.string().min(1).max(64),
    float: z.boolean().optional(),
    picture: regexSource.optional(),
    // The teacher's copy of an attached picture: the check drawn on the
    // cell(s) its node records (render_document's media `mark`).
    mark: z.literal("answer").optional(),
    asset: z.union([
      z.object({ relPath: z.string().min(1) }).strict(),
      z.object({ byRank: z.array(z.string().min(1)).min(1) }).strict(),
    ]).optional(),
  }).strict().refine((image) => (image.picture ? 1 : 0) + (image.asset ? 1 : 0) === 1, {
    message: "an image names exactly one of `picture` (a name pattern) or `asset` (a fixed file)",
  }).refine((image) => image.mark === undefined || image.picture !== undefined, {
    message: "`mark` applies to a `picture` (an attached one records its correct cell), never to an `asset`",
  }),
}).strict();

const runSchema = z.union([textRunSchema, imageRunSchema]);

const forEachSchema = z.object({
  of: z.enum(["covered.content.lines"]),
  match: regexSource.optional(),
}).strict();

// `when.rank` keeps a block for one rank only — the pictogram that opens a
// group of activities appears on the first, the page break before a group
// falls before its first, and the template says so without a second template.
const whenSchema = z.object({ rank: z.number().int().positive() }).strict();

export type TemplateBlock =
  | { kind: "line"; style?: string; variant?: string; pageBreak?: "before"; anchor?: "covered" | "none"; when?: { rank: number }; forEach?: z.infer<typeof forEachSchema>; runs: z.infer<typeof runSchema>[] }
  | { kind: "table"; style?: string; columnsCm?: number[]; pageBreak?: "before"; when?: { rank: number }; rows: TemplateCell[][] }
  | { kind: "spacer"; sizePt: number; leadingPt: number }
  | { kind: "clear" }
  | { kind: "children" }
  | { kind: "unfilled" }
  | { kind: "guide"; vars?: Record<string, string> };

export type TemplateCell = { blocks: TemplateBlock[]; style?: string; span?: number };

export const templateBlockSchema: z.ZodType<TemplateBlock> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("line"),
      style: styleName.optional(),
      variant: z.string().min(1).max(64).optional(),
      pageBreak: z.literal("before").optional(),
      anchor: z.enum(["covered", "none"]).optional(),
      when: whenSchema.optional(),
      forEach: forEachSchema.optional(),
      runs: z.array(runSchema).min(1),
    }).strict(),
    z.object({
      kind: z.literal("table"),
      style: styleName.optional(),
      columnsCm: z.array(z.number().positive()).optional(),
      pageBreak: z.literal("before").optional(),
      when: whenSchema.optional(),
      rows: z.array(z.array(templateCellSchema)).min(1),
    }).strict(),
    z.object({
      kind: z.literal("spacer"),
      sizePt: z.number().positive(),
      leadingPt: z.number().positive(),
    }).strict(),
    // The end of a wrap: what follows starts below the floated pictures.
    z.object({ kind: z.literal("clear") }).strict(),
    // The composed child sections, in order — the one block only a root template uses.
    z.object({ kind: z.literal("children") }).strict(),
    // A HOLE: where this section's own lines go, composed by the model from its
    // guide. The composer emits nothing here and reports the section under
    // `unfilled` with `insertAt`, the block path to patch the lines in at.
    z.object({ kind: z.literal("unfilled") }).strict(),
    // The section's own guide, COMPILED by the grammar the bag declares:
    // where a hole left the lines to a model, this has the server write them.
    // `vars` fills phrase slots the template knows and the guide does not —
    // the phase's pictogram, say.
    z.object({ kind: z.literal("guide"), vars: z.record(z.string().min(1).max(64), z.string().max(200)).optional() }).strict(),
  ]),
) as z.ZodType<TemplateBlock>;

const templateCellSchema: z.ZodType<TemplateCell> = z.lazy(() =>
  z.object({
    blocks: z.array(templateBlockSchema),
    style: styleName.optional(),
    span: z.number().int().positive().optional(),
  }).strict(),
) as z.ZodType<TemplateCell>;

export const templateSchema = z.object({
  name: z.string().min(1).max(64),
  match: z.object({
    // A regular expression the section's title must match.
    section: regexSource.optional(),
    // `root` templates apply to the section asked for; the others to its children.
    root: z.boolean().optional(),
  }).strict(),
  blocks: z.array(templateBlockSchema).min(1),
}).strict();

/*
 * The GUIDE GRAMMAR — how a section's assembly guide reads as page lines.
 * Three motifs, each a regular expression with NAMED groups the compiler
 * reads, and the tables that give the matches their meaning:
 *
 *   line    ‹prefix›, ‹text›   a printed line; `prefixes` maps the prefix to its
 *                              voice (the render variant) — a prefix not listed
 *                              is a reported defect, a line matching nothing
 *                              stays in the guide unprinted.
 *   call    ‹id›, ‹args›       a phrase of the repertoire (`phrases`, id → text
 *                              with ⟨slots⟩); `vars` on the template block, a
 *                              marker argument (into `markerSlot`) and the free
 *                              argument fill the slots, in that order.
 *   image   ‹name›, ‹marker›?  opens a block: the attached picture of that name
 *                              floats on the block's first printed line, the
 *                              marker becomes its pastille (`markers` maps the
 *                              glyph to an inline asset).
 *   inline  ‹name›             an asset set in the line — a pictogram, a
 *                              pastille — from `assets`, by name.
 *   trailing ‹tail›            the end of a speech line printed apart — an
 *                              answer in parentheses — in its own style, kept
 *                              untranslated.
 */
const groupName = z.string().min(1).max(64);

export const guideGrammarSchema = z.object({
  line: z.object({ pattern: regexSource, style: styleName.optional() }).strict(),
  prefixes: z.record(z.string().min(1).max(8), z.object({ variant: groupName.optional() }).strict()),
  call: z.object({
    pattern: regexSource,
    phrases: z.record(z.string().min(1).max(32), z.string().min(1).max(600)),
    slot: regexSource.optional(),
    markerSlot: groupName.optional(),
  }).strict().optional(),
  inline: z.object({
    pattern: regexSource,
    assets: z.record(z.string().min(1).max(64), z.object({ relPath: z.string().min(1), role: groupName }).strict()),
  }).strict().optional(),
  image: z.object({
    pattern: regexSource,
    roles: z.array(z.object({ match: regexSource, role: groupName }).strict()).optional(),
    defaultRole: groupName.optional(),
    // The teacher's copy: drawn only on a picture that records its correct cell.
    mark: z.literal("answer").optional(),
  }).strict().optional(),
  markers: z.record(z.string().min(1).max(4), z.string().min(1).max(64)).optional(),
  trailing: z.object({
    pattern: regexSource,
    style: styleName.optional(),
    translate: z.literal(false).optional(),
    prefixes: z.array(z.string().min(1).max(8)).optional(),
  }).strict().optional(),
}).strict();

export type GuideGrammar = z.infer<typeof guideGrammarSchema>;

export const layoutSpecSchema = z.object({
  templates: z.array(templateSchema).min(1),
  guide: guideGrammarSchema.optional(),
}).strict();

export type LayoutSpec = z.infer<typeof layoutSpecSchema>;
export type LayoutTemplate = z.infer<typeof templateSchema>;

/** The named groups each grammar pattern must carry, or the compiler would read nothing from a match. */
const REQUIRED_GROUPS: Array<[keyof GuideGrammar, string, string[]]> = [
  ["line", "line.pattern", ["prefix", "text"]],
  ["call", "call.pattern", ["id"]],
  ["inline", "inline.pattern", ["name"]],
  ["image", "image.pattern", ["name"]],
];

function grammarErrors(grammar: GuideGrammar, tool: string): string[] {
  const errors: string[] = [];
  const tryCompile = (source: string | undefined, where: string) => {
    if (source === undefined) return;
    try { new RegExp(source, "u"); } catch (e) { errors.push(`${tool}: 'layout.guide.${where}' is not a valid regular expression (${(e as Error).message}).`); }
  };
  for (const [key, where, groups] of REQUIRED_GROUPS) {
    const section = grammar[key] as { pattern?: string } | undefined;
    if (!section?.pattern) continue;
    tryCompile(section.pattern, where);
    for (const group of groups) {
      if (!section.pattern.includes(`(?<${group}>`)) errors.push(`${tool}: 'layout.guide.${where}' must name a (?<${group}>…) group; the compiler reads the match by it.`);
    }
  }
  tryCompile(grammar.call?.slot, "call.slot");
  if (grammar.call?.slot && !grammar.call.slot.includes("(?<name>")) errors.push(`${tool}: 'layout.guide.call.slot' must name a (?<name>…) group.`);
  tryCompile(grammar.trailing?.pattern, "trailing.pattern");
  grammar.image?.roles?.forEach((rule, i) => tryCompile(rule.match, `image.roles[${i}].match`));
  if (grammar.markers && !grammar.inline) errors.push(`${tool}: 'layout.guide.markers' names inline assets, so 'layout.guide.inline' must declare them.`);
  for (const [glyph, asset] of Object.entries(grammar.markers ?? {})) {
    if (grammar.inline && !grammar.inline.assets[asset]) errors.push(`${tool}: 'layout.guide.markers.${glyph}' names '${asset}', which 'inline.assets' does not declare.`);
  }
  return errors;
}

/** Every regular expression in a template must compile, or the composer would throw mid-page. */
function regexErrors(layout: LayoutSpec, tool: string): string[] {
  const errors: string[] = [];
  const tryCompile = (source: string | undefined, where: string) => {
    if (source === undefined) return;
    try { new RegExp(source, "u"); } catch (e) { errors.push(`${tool}: 'layout.${where}' is not a valid regular expression (${(e as Error).message}).`); }
  };
  layout.templates.forEach((template, t) => {
    tryCompile(template.match.section, `templates[${t}].match.section`);
    const walk = (blocks: TemplateBlock[], path: string) => blocks.forEach((block, b) => {
      if (block.kind === "line") {
        tryCompile(block.forEach?.match, `${path}[${b}].forEach.match`);
        block.runs.forEach((run, r) => { if ("image" in run) tryCompile(run.image.picture, `${path}[${b}].runs[${r}].image.picture`); });
      }
      if (block.kind === "table") block.rows.forEach((row, i) => row.forEach((cell, j) => walk(cell.blocks, `${path}[${b}].rows[${i}][${j}].blocks`)));
    });
    walk(template.blocks, `templates[${t}].blocks`);
  });
  if (layout.guide) errors.push(...grammarErrors(layout.guide, tool));
  return errors;
}

/** Errors for a `layout` value, each prefixed with the tool name. Empty when valid. */
export function validateLayoutSpec(layout: unknown, tool: string): string[] {
  const result = layoutSpecSchema.safeParse(layout);
  if (!result.success) {
    return result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? `layout.${issue.path.join(".")}` : "layout";
      return `${tool}: '${path}' — ${issue.message}`;
    });
  }
  return regexErrors(result.data, tool);
}

/**
 * The `layout` value in a freeform properties bag, however it was spelled —
 * a whole `layout` object, or `layout` nested under `properties`. A dotted
 * partial (`layout.templates`) is refused: a template list replaces as a whole.
 */
export function validateLayoutInBag(properties: Record<string, unknown> | undefined, tool: string): string[] {
  if (!properties) return [];
  const errors: string[] = [];
  for (const [key, value] of Object.entries(properties)) {
    if (key === "layout") errors.push(...validateLayoutSpec(value, tool));
    else if (key.startsWith("layout.")) errors.push(`${tool}: '${key}' — write the whole \`layout\` object; its template list replaces as a whole.`);
  }
  return errors;
}

/** The `layout` bag off a stored node, wherever the raw envelope keeps it. */
export function layoutBagOf(node: { properties?: Record<string, unknown> }): unknown {
  const props = node.properties ?? {};
  const raw = props.raw as Record<string, unknown> | undefined;
  return props.layout ?? raw?.layout;
}

/*
 * The templates a section may use, from its formatter stack: `stack` is in
 * application order (document-wide first, the section's own last), and the
 * NEAREST template with a given name wins, as a render value does.
 */
export function resolveLayout(stack: Array<{ id: string; properties?: Record<string, unknown> }>): { ok: true; templates: LayoutTemplate[]; guide?: GuideGrammar; from: string[] } | { ok: false; errors: string[]; from: string[] } {
  const byName = new Map<string, LayoutTemplate>();
  const from: string[] = [];
  const errors: string[] = [];
  // The guide grammar too is nearest-wins: the first bag (nearest) declaring one.
  let guide: GuideGrammar | undefined;
  for (const node of [...stack].reverse()) {
    const bag = layoutBagOf(node);
    if (bag === undefined) continue;
    const problems = validateLayoutSpec(bag, `formatter ${node.id}`);
    if (problems.length) { errors.push(...problems); continue; }
    from.push(node.id);
    const spec = bag as LayoutSpec;
    for (const template of spec.templates) {
      if (!byName.has(template.name)) byName.set(template.name, template);
    }
    if (guide === undefined && spec.guide) guide = spec.guide;
  }
  if (errors.length) return { ok: false, errors, from };
  return { ok: true, templates: [...byName.values()], ...(guide ? { guide } : {}), from };
}
