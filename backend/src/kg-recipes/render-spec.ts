/*
 * The machine-readable half of a formatter: `properties.render`.
 *
 * A FormatterSpec's `content` is prose, and it stays prose — it is what the
 * authoring model reads, and it carries the things only a sentence can say
 * ("un bandeau ne se sépare pas de ce qu'il annonce"). What it cannot do is
 * drive a renderer: no program can read "En-tête, bandeaux et couleurs" and
 * produce a page from it.
 *
 * So a formatter gets a second, DECLARATIVE half beside the prose. This module
 * is its schema.
 *
 * WHAT BELONGS IN IT, AND WHAT DOES NOT — the line matters more than the keys:
 *
 *   • GEOMETRY AND STYLE belong here: page size, margins, type, the fill of a
 *     banner, how wide a bullet may run, where a page break is carried. These
 *     are the same for every sheet the formatter governs, and a renderer needs
 *     them as values.
 *
 *   • STRUCTURE DOES NOT. Which blocks appear, in what order, and where this
 *     particular lesson breaks its page, is authored per section — on the live
 *     CI-maths graph that is 2-8 KB of French prose per lesson, on the section's
 *     own assembly guidance. A schema that tried to hold it would be describing
 *     one document type, and the first `if documentType === …` in the renderer
 *     is a bug report against this abstraction.
 *
 * Everything here is OPTIONAL. A formatter declares the knobs it actually fixes
 * and stays silent about the rest; silence means "not governed", never "zero".
 *
 * STRICT on the other hand: unknown keys are REFUSED. A typo in a declarative
 * bag is invisible at authoring time and silently ignored at render time, which
 * is the failure mode this whole schema exists to remove.
 */

import { z } from "zod";

// A CSS-style hex colour, with or without the leading '#'. Both spellings are in
// the live graphs ("#1F7A1F" in CE1 reading, "2EAEE5" in CI maths), and refusing
// either would mean rewriting authored data to satisfy a validator.
const hexColour = z.string().regex(/^#?[0-9a-fA-F]{6}$/, "must be a 6-digit hex colour, e.g. '#1F7A1F' or '2EAEE5'");

const positive = z.number().positive();

/** Physical page. The box everything else composes inside. */
const pageSchema = z.object({
  size: z.enum(["A4", "A5", "A3", "Letter", "Legal"]).optional(),
  orientation: z.enum(["portrait", "landscape"]).optional(),
  marginsCm: z.object({
    top: positive.optional(), right: positive.optional(),
    bottom: positive.optional(), left: positive.optional(),
  }).strict().optional(),
  // Added to the inner margin when the document is bound.
  bindingCm: positive.optional(),
}).strict();

/*
 * Body type. `leadingPt` is the line height a renderer must set, not a hint.
 *
 * `leadingRule` is not decoration on it. A height in points is ambiguous on its
 * own -- "exact" makes it a CEILING, "atLeast" a FLOOR -- and CI maths shipped a
 * production run where the difference cropped every full-width image band to
 * 5 mm. The page count was right, so no measurement caught it; someone had to
 * look at the page. A schema that can hold 15.5 but not "exact" can record the
 * setting that caused that and not the one that fixes it.
 */
const leadingRule = z.enum(["exact", "atLeast", "auto"]);

const typeSchema = z.object({
  family: z.string().min(1).optional(),
  sizePt: positive.optional(),
  leadingPt: positive.optional(),
  leadingRule: leadingRule.optional(),
  colour: hexColour.optional(),
}).strict();

/*
 * The measured page budget.
 *
 * Not in the roadmap's knob list, and both live formatters turn out to need it:
 * these are the numbers that decide whether a sheet fits, and they are MEASURED
 * on a render, never computed. The CI-maths figures were recalculated from PDFs
 * after a computed budget proved a third too optimistic — so a renderer that
 * derives them from `type` instead of reading them here will repeat that error.
 */
const budgetSchema = z.object({
  linesPerPage: positive.optional(),
  lineHeightCm: positive.optional(),
  maxCharsPerLine: positive.optional(),
  maxCharsBesideImage: positive.optional(),
  // Whitespace deliberately left at the foot of a page — e.g. held in reserve
  // for a translation that runs longer than the language it was composed in.
  reserveBottomCm: positive.optional(),
}).strict();

/*
 * One block KIND's style — a banner, a bullet, a speaking turn, a section header.
 *
 * The keys of `blocks` are free text on purpose. Every document type names its
 * blocks differently and an enum here would be exactly the per-document-type
 * branch this schema exists to avoid.
 */
const blockStyleSchema = z.object({
  fill: hexColour.optional(),
  textColour: hexColour.optional(),
  sizePt: positive.optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  fullWidth: z.boolean().optional(),
  border: z.enum(["none", "thin", "standard"]).optional(),
  cellMarginsCm: z.number().nonnegative().optional(),
  // Whether the block must stay on the same page as what follows it — the
  // "a banner is never separated from what it announces" rule, as a value.
  keepWithNext: z.boolean().optional(),
  maxChars: positive.optional(),
  maxCharsBesideImage: positive.optional(),
  marker: z.string().optional(),
}).strict();

/** Images: how big, where, and how many. Roles are free text, like block names. */
const imagesSchema = z.object({
  placement: z.enum(["float-right", "float-left", "full-width", "inline"]).optional(),
  maxHeightCm: z.record(z.string(), positive).optional(),
  maxWidthCm: positive.optional(),
  // Height of an image set in the run of text (a pictogram, an answer marker).
  inlineHeightCm: z.record(z.string(), positive).optional(),
  gutterCm: z.number().nonnegative().optional(),
  // How many images may be embedded in one section. On CI maths this is 2, and
  // it is measured rather than preferred: embedding every band overflowed four
  // lessons out of four.
  maxPerSection: z.number().int().nonnegative().optional(),
  caption: z.boolean().optional(),
  // Wider than this ratio and an image goes full width instead of floating —
  // a band reduced to a sliver is unreadable.
  fullWidthAboveAspectRatio: positive.optional(),
  // The leading rule for the paragraph CARRYING an inline image, which is
  // deliberately not the body's. Under `type.leadingRule: "exact"` Word crops an
  // inline image to the line box instead of growing the line to fit it; the
  // twenty golden CI-maths sheets set this paragraph to "auto" for that reason.
  // A floating image is unaffected — it has no line to respect — which is why the
  // defect survived a full production run before anyone saw it.
  paragraphLeadingRule: leadingRule.optional(),
}).strict();

/*
 * Pagination.
 *
 * `pageBreakCarrier` earns its place: on CI maths the break MUST ride the
 * banner's own "page break before" property, because a paragraph carrying a
 * break produces a blank page whenever the preceding page is already full. That
 * is a silent one-page-per-sheet regression, and it is not expressible as prose
 * a renderer can act on.
 */
const paginationSchema = z.object({
  oneSectionPerPage: z.boolean().optional(),
  pageBreakCarrier: z.enum(["banner-property", "paragraph", "section-break"]).optional(),
  footer: z.object({
    show: z.boolean().optional(),
    position: z.enum(["outer", "inner", "centre", "left", "right"]).optional(),
    family: z.string().optional(),
    sizePt: positive.optional(),
    colour: hexColour.optional(),
    // Numbering runs unbroken across the document rather than restarting.
    continuous: z.boolean().optional(),
  }).strict().optional(),
}).strict();

/*
 * What reaches the page.
 *
 * On CI maths a guide holds the sheet's text and the production instructions
 * MIXED TOGETHER, told apart by one thing: a line prefix. Only prefixed lines
 * print. Twelve lines lost their prefix during the production and silently
 * vanished from the sheet — which is why this is a declared value a check can
 * run against, not a convention someone remembers.
 */
const visibilitySchema = z.object({
  printedPrefixes: z.array(z.string().min(1)).optional(),
  neverPrint: z.array(z.string().min(1)).optional(),
}).strict();

/*
 * How the document's languages are laid out.
 *
 * The roadmap modelled this as L1/L2 plus a separator, which fits CE1 reading
 * (both languages on one line, wolof green, '/', french black) and CANNOT
 * express CI maths, which produces TWO SEPARATE FILES from one source: black
 * lines print in both, red French only in the French file, blue Wolof only in
 * the Wolof file. Hence `strategy` plus an open list of variants — the shape
 * that holds both, and a third (monolingual) besides.
 */
const languageSchema = z.object({
  strategy: z.enum(["inline", "per-file", "monolingual"]).optional(),
  // Only meaningful for "inline": what sits between the two renderings.
  separator: z.string().optional(),
  variants: z.array(z.object({
    id: z.string().min(1),
    lang: z.string().min(1),
    colour: hexColour.optional(),
    bold: z.boolean().optional(),
    // The line prefix that routes a line to this variant ("[FR]", "[WO]").
    prefix: z.string().optional(),
    // For "per-file": a suffix distinguishing this variant's file.
    fileSuffix: z.string().optional(),
    // A variant that prints in EVERY file (CI maths' black lines).
    inAllFiles: z.boolean().optional(),
  }).strict()).min(1).optional(),
}).strict();

/*
 * What gives when a page will not hold its content.
 *
 * Both live formatters state this and they state it DIFFERENTLY, which is what
 * makes it a knob rather than a constant: CI maths tightens the text until the
 * sheet fits ("c'est le texte qui cède"), CE1 reading lets it overflow rather
 * than compress ("la lisibilité prime sur l'économie de pages"). Both refuse to
 * move the geometry, and `neverAdjust` says so as a value a renderer can honour.
 */
const overflowSchema = z.object({
  policy: z.enum(["tighten-text", "allow"]).optional(),
  neverAdjust: z.array(z.enum(["margins", "leading", "typeSize", "images"])).optional(),
}).strict();

/** The whole declarative half. Every group optional; unknown keys refused. */
export const renderSpecSchema = z.object({
  page: pageSchema.optional(),
  type: typeSchema.optional(),
  budget: budgetSchema.optional(),
  blocks: z.record(z.string(), blockStyleSchema).optional(),
  images: imagesSchema.optional(),
  pagination: paginationSchema.optional(),
  visibility: visibilitySchema.optional(),
  language: languageSchema.optional(),
  overflow: overflowSchema.optional(),
}).strict();

export type RenderSpec = z.infer<typeof renderSpecSchema>;

/**
 * Validate a `render` value, returning caller-facing error strings.
 *
 * Returns [] when there is no `render` key at all — this schema governs one
 * optional property, not the whole bag. `tool` names the surface so the message
 * reads as that tool's own.
 */
export function validateRenderSpec(render: unknown, tool: string): string[] {
  const result = renderSpecSchema.safeParse(render);
  if (result.success) {
    return [];
  }
  return result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `render.${issue.path.join(".")}` : "render";
    return `${tool}: '${path}' — ${issue.message}`;
  });
}

/**
 * Pull the `render` value out of a freeform properties bag, however it was
 * written.
 *
 * The bag addresses raw properties by dotted path, so a caller may send the
 * whole object as `render`, or one branch of it as `render.page`. Both have to
 * be validated, or the dotted form is a hole straight through the schema.
 */
export function renderValuesIn(properties: Record<string, unknown> | undefined): Array<{ key: string; value: unknown }> {
  if (!properties) {
    return [];
  }
  return Object.entries(properties)
    .filter(([key]) => key === "render" || key.startsWith("render."))
    .map(([key, value]) => ({ key, value }));
}

/*
 * Coherence rules the type schema cannot express.
 *
 * Every field is optional so that a DOTTED amendment ("render.page.marginsCm")
 * validates as the branch it names — silence means "not governed". The cost is
 * that a WHOLE `render` object could then be internally incoherent, so the few
 * genuine "if you say A you must say B" rules are checked here instead. They run
 * only for a whole-object write, where the caller really is stating the lot.
 */
function coherenceErrors(render: unknown, tool: string): string[] {
  const spec = render as RenderSpec;
  const errors: string[] = [];

  if (spec?.language) {
    const { strategy, variants, separator } = spec.language;
    if (!strategy) {
      errors.push(`${tool}: 'render.language' needs a 'strategy' ('inline', 'per-file' or 'monolingual') — without it a renderer cannot tell whether the languages share a line or separate files.`);
    }
    if (!variants || variants.length === 0) {
      errors.push(`${tool}: 'render.language' needs at least one entry in 'variants' naming the language(s) it lays out.`);
    }
    if (strategy === "inline" && separator === undefined) {
      errors.push(`${tool}: 'render.language.strategy' is 'inline', so 'separator' is required — it is what goes between the two renderings on the line.`);
    }
    if (strategy === "per-file") {
      const routable = (variants ?? []).filter((variant) => variant.prefix !== undefined || variant.inAllFiles === true);
      if (routable.length !== (variants ?? []).length) {
        errors.push(`${tool}: 'render.language.strategy' is 'per-file', so every variant needs a 'prefix' (the line marker routing it to its file) or 'inAllFiles: true'.`);
      }
    }
  }

  if (spec?.overflow && !spec.overflow.policy) {
    errors.push(`${tool}: 'render.overflow' needs a 'policy' — 'tighten-text' (the text yields until it fits) or 'allow' (let it run on rather than compress).`);
  }

  return errors;
}

/**
 * Validate every render-bearing entry in a properties bag.
 *
 * A dotted entry is validated as the branch it names, by rebuilding the nesting
 * it stands for — so `{"render.page": {...}}` is checked against the page schema
 * and not waved through.
 */
export function validateRenderInBag(properties: Record<string, unknown> | undefined, tool: string): string[] {
  const errors: string[] = [];
  for (const { key, value } of renderValuesIn(properties)) {
    if (key === "render") {
      const typeErrors = validateRenderSpec(value, tool);
      errors.push(...typeErrors);
      // Only worth asking whether the whole is coherent once it is well-typed.
      if (typeErrors.length === 0) {
        errors.push(...coherenceErrors(value, tool));
      }
      continue;
    }
    // "render.page.marginsCm" → rebuild { page: { marginsCm: value } } and let
    // the one schema judge it, rather than keeping a second per-branch table.
    const segments = key.split(".").slice(1);
    let nested: unknown = value;
    for (const segment of [...segments].reverse()) {
      nested = { [segment]: nested };
    }
    errors.push(...validateRenderSpec(nested, tool));
  }
  return errors;
}
