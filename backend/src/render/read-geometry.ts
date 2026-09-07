/*
 * Reading a document's GEOMETRY back out — the third direction.
 *
 * `read-docx.ts` recovers our own output's TEXT (for corrections);
 * `__golden__/golden.ts` recovers a foreign sheet's STRUCTURE (given the style
 * names). Neither recovers the `render` bag, and until now nothing did: the
 * CI-maths geometry was transcribed by hand out of the producer's build.py.
 *
 * WHAT THIS IS FOR. Two jobs, one function:
 *
 *   • BOOTSTRAPPING a subject whose sheets exist but whose formatter has no
 *     geometry (CE1 reading today: eighteen formatters, not one `render` bag,
 *     so render_document refuses). The document is foreign, carries no anchors,
 *     and a person must name its blocks and picture roles.
 *   • An EXPERT RESTYLES a sheet we produced and expects it to stick. There the
 *     caller diffs what comes back here against what the formatter DECLARES,
 *     because the absolute values alone cannot tell a formatter change from a
 *     one-off tweak on one sheet — and the formatter governs every fiche.
 *
 * WHAT IT DELIBERATELY WILL NOT DO. It reports what the file SHOWS and never
 * guesses a name. A fill is `2EAEE5` in the XML and nothing more; only a person
 * (or a diff against a spec that already names it) knows it is the week banner.
 * So fills and picture heights come back as UNNAMED candidates rather than
 * invented `blocks` and `images.maxHeightCm` keys. Half the spec is not in a
 * .docx at all — a page budget, a printed-prefix rule, an overflow policy are
 * decisions, not measurements — and `notes` says so rather than emitting
 * silence that reads as "nothing to declare".
 *
 * THE TRAP THIS ENCODES. A sheet's `docDefaults` is the Word template's
 * default, and the default PARAGRAPH STYLE (`Normal`, `w:default="1"`)
 * overrides it. Read docDefaults alone on the CI-maths corpus and you get
 * 11 pt with automatic leading; the applied style is Andika 12 pt at 14 pt
 * EXACT. Two design notes carried the wrong margins and leading for a
 * fortnight on exactly this mistake, so the resolution order below is the
 * point of the module, not an implementation detail.
 */
import { unzip } from "./zip.js";
import { renderSpecSchema, type RenderSpec } from "../kg-recipes/index.js";

const TWIPS_PER_CM = 566.929;
const twipsToCm = (twips: number) => Math.round((twips / TWIPS_PER_CM) * 100) / 100;
const EMU_PER_CM = 360000;
const emuToCm = (emu: number) => Math.round((emu / EMU_PER_CM) * 100) / 100;

/** Named page sizes, so a measured 21.0 x 29.7 comes back as "A4". */
const PAGE_SIZES: Array<{ name: RenderSpec["page"] extends infer P ? P extends { size?: infer S } ? S : never : never; w: number; h: number }> = [
  { name: "A4", w: 21.0, h: 29.7 },
  { name: "A5", w: 14.8, h: 21.0 },
  { name: "A3", w: 29.7, h: 42.0 },
  { name: "Letter", w: 21.59, h: 27.94 },
  { name: "Legal", w: 21.59, h: 35.56 },
];

/** A fill or a picture height the file shows but cannot name. */
export type UnnamedFill = { hex: string; occurrences: number };
export type UnnamedHeight = { heightCm: number; occurrences: number };

export type ExtractedGeometry = {
  /** The fields that ARE measurable, already schema-valid. */
  spec: RenderSpec;
  /** What the file shows and only a person (or a diff) can name. */
  unnamed: { fills: UnnamedFill[]; imageHeightsCm: UnnamedHeight[] };
  /** What could not be read, and why — never left as silence. */
  notes: string[];
};

/** Every match of a capturing group, deduplicated in first-seen order. */
function tally(xml: string, re: RegExp): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of xml.matchAll(re)) {
    const key = m[1];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * The run/paragraph properties that actually apply to body text.
 *
 * Resolution order is load-bearing (see the module header): the default
 * paragraph style wins over `docDefaults`, because that is what Word applies.
 * Returning the style's block FIRST and docDefaults second lets each field fall
 * back independently — a style that sets leading but not the family should
 * still yield the family from docDefaults.
 */
function effectiveTypeBlocks(styles: string): string[] {
  const blocks: string[] = [];

  // The default paragraph style — `w:default="1"` on a paragraph style, which
  // is `Normal` in every file we have seen but is not required to be named so.
  const defaultStyle = [...styles.matchAll(/<w:style\b[^>]*>[\s\S]*?<\/w:style>/g)]
    .map((m) => m[0])
    .find((s) => /w:type="paragraph"/.test(s) && /w:default="1"/.test(s));
  if (defaultStyle) blocks.push(defaultStyle);

  const docDefaults = styles.match(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/)?.[0];
  if (docDefaults) blocks.push(docDefaults);

  return blocks;
}

/** First value of `re` across `blocks`, in precedence order. */
function firstMatch(blocks: string[], re: RegExp): string | undefined {
  for (const block of blocks) {
    const m = block.match(re);
    if (m) return m[1];
  }
  return undefined;
}

/**
 * Read a `.docx`'s measurable geometry.
 *
 * Throws only when the bytes are not a Word file at all; a file missing a part
 * this wants yields a `note` rather than an exception, because a partial answer
 * with its gaps named is what the caller can act on.
 */
export function readGeometry(bytes: Buffer): ExtractedGeometry {
  const parts = unzip(bytes);
  const documentXml = parts.get("word/document.xml")?.toString("utf8");
  if (documentXml === undefined) {
    throw new Error("not a .docx: no word/document.xml part");
  }
  const stylesXml = parts.get("word/styles.xml")?.toString("utf8") ?? "";

  const notes: string[] = [];
  const spec: Record<string, unknown> = {};

  // ---- page -------------------------------------------------------------
  const pgSz = documentXml.match(/<w:pgSz\b[^/]*\/>/)?.[0];
  const pgMar = documentXml.match(/<w:pgMar\b[^/]*\/>/)?.[0];
  const page: Record<string, unknown> = {};

  if (pgSz) {
    const wTwips = Number(pgSz.match(/w:w="(\d+)"/)?.[1]);
    const hTwips = Number(pgSz.match(/w:h="(\d+)"/)?.[1]);
    if (Number.isFinite(wTwips) && Number.isFinite(hTwips)) {
      const wCm = twipsToCm(wTwips);
      const hCm = twipsToCm(hTwips);
      // Orientation from the dimensions, not from w:orient: a file may carry a
      // landscape pgSz with no orient attribute at all.
      const landscape = wCm > hCm;
      const [shortSide, longSide] = landscape ? [hCm, wCm] : [wCm, hCm];
      // A tenth of a centimetre of slack: Word rounds twips, and Letter/Legal
      // are defined in inches so they never land on an exact tenth.
      const named = PAGE_SIZES.find(
        (s) => Math.abs(s.w - shortSide) < 0.1 && Math.abs(s.h - longSide) < 0.1,
      );
      if (named) {
        page.size = named.name;
        page.orientation = landscape ? "landscape" : "portrait";
      } else {
        notes.push(
          `Page is ${wCm} x ${hCm} cm, which is not one of the named sizes the spec allows ` +
          `(A4/A5/A3/Letter/Legal), so \`page.size\` is left unset. Declare the nearest named size, ` +
          `or treat the sheet as non-standard.`,
        );
      }
    }
  } else {
    notes.push("No <w:pgSz> in the document, so the page size could not be read.");
  }

  if (pgMar) {
    const margins: Record<string, number> = {};
    for (const [, side, value] of pgMar.matchAll(/w:(top|right|bottom|left)="(-?\d+)"/g)) {
      const cm = twipsToCm(Number(value));
      // The schema's margins are `positive`, and a zero or negative margin is a
      // real thing in Word that it cannot hold.
      if (cm > 0) margins[side] = cm;
      else notes.push(`Margin \`${side}\` measures ${cm} cm; the spec takes only positive margins, so it is omitted.`);
    }
    if (Object.keys(margins).length > 0) page.marginsCm = margins;
  } else {
    notes.push("No <w:pgMar> in the document, so the margins could not be read.");
  }
  if (Object.keys(page).length > 0) spec.page = page;

  // ---- type -------------------------------------------------------------
  // The applied default style first, docDefaults second. See the module header:
  // reading docDefaults alone is the mistake this module exists to stop.
  const typeBlocks = effectiveTypeBlocks(stylesXml);
  const type: Record<string, unknown> = {};

  const family = firstMatch(typeBlocks, /w:ascii="([^"]+)"/);
  if (family && !family.startsWith("minor") && !family.startsWith("major")) {
    type.family = family;
  } else if (family) {
    // A theme reference names no face, so it cannot be transcribed as one.
    notes.push(
      `The body font is the theme reference "${family}" rather than a named face, so \`type.family\` ` +
      `is left unset. Name the face the sheet is actually meant to use.`,
    );
  }

  const halfPoints = firstMatch(typeBlocks, /<w:sz w:val="(\d+)"/);
  if (halfPoints) type.sizePt = Number(halfPoints) / 2;

  const spacing = typeBlocks.map((b) => b.match(/<w:spacing\b[^/]*\/>/)?.[0]).find(Boolean);
  if (spacing) {
    const line = spacing.match(/w:line="(\d+)"/)?.[1];
    const rule = spacing.match(/w:lineRule="(\w+)"/)?.[1];
    if (line) type.leadingPt = Number(line) / 20;
    // OOXML's three rules map onto the spec's three; "auto" is Word's word for
    // single/multiple spacing, which the spec calls auto too.
    if (rule === "exact") type.leadingRule = "exact";
    else if (rule === "atLeast") type.leadingRule = "atLeast";
    else if (rule === "auto") type.leadingRule = "auto";
  }
  if (Object.keys(type).length > 0) spec.type = type;
  if (type.leadingPt !== undefined && type.leadingRule === undefined) {
    notes.push(
      `Leading measures ${String(type.leadingPt)} pt but the file declares no line rule, so it is ` +
      `ambiguous: "exact" makes that a ceiling and crops inline pictures, "atLeast" a floor. Declare which.`,
    );
  }

  // ---- images -----------------------------------------------------------
  // Extents are the only picture geometry a file carries. A WIDTH ceiling can
  // be read as the widest picture present; HEIGHTS cannot, because the spec
  // keys them by ROLE and a picture does not say what role it plays.
  const extents = [...documentXml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)]
    .map((m) => ({ wCm: emuToCm(Number(m[1])), hCm: emuToCm(Number(m[2])) }));
  const heights = new Map<number, number>();
  for (const { hCm } of extents) heights.set(hCm, (heights.get(hCm) ?? 0) + 1);

  if (extents.length > 0) {
    const widest = Math.max(...extents.map((e) => e.wCm));
    spec.images = { maxWidthCm: widest };
    notes.push(
      `${extents.length} picture(s) at ${heights.size} distinct height(s). \`images.maxWidthCm\` is set ` +
      `to the widest one present (${widest} cm) — check that is a CEILING and not just the largest ` +
      `picture this sheet happened to use. The heights are listed under \`unnamed\` because the spec ` +
      `keys them by role and a picture does not say what role it plays.`,
    );
  }

  // ---- pagination -------------------------------------------------------
  // How a page break is CARRIED is visible, and it matters: a break on a
  // paragraph of its own opens a blank page whenever the previous page is full.
  const breakBefore = (documentXml.match(/<w:pageBreakBefore\/>/g) ?? []).length;
  const breakParagraph = (documentXml.match(/<w:br w:type="page"/g) ?? []).length;
  if (breakBefore > 0 || breakParagraph > 0) {
    spec.pagination = {
      pageBreakCarrier: breakBefore >= breakParagraph ? "banner-property" : "paragraph",
    };
    if (breakBefore > 0 && breakParagraph > 0) {
      notes.push(
        `The document carries page breaks BOTH ways — ${breakBefore} as a paragraph property and ` +
        `${breakParagraph} as a paragraph of its own. The more common one is proposed; a sheet should ` +
        `use one carrier, because a break on its own paragraph opens a blank page after a full one.`,
      );
    }
  }

  // ---- what a .docx cannot hold ----------------------------------------
  notes.push(
    "Not measurable from a document, because they are decisions rather than marks on a page: " +
    "`budget` (how many pages the sheet MUST fit — measured on a render, against a declared limit), " +
    "`visibility` (which line prefixes print), `overflow` (what gives when a page will not hold), " +
    "and `language.variants` (which colour means which language, and whether one file or two). " +
    "Carry these over from the existing formatter, or decide them.",
  );

  // Validate before returning: a caller staging this through edit_nodes would
  // be refused at authoring time anyway, and failing here names the field.
  const parsed = renderSpecSchema.safeParse(spec);
  if (!parsed.success) {
    const where = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Extracted geometry is not a valid render spec — ${where}`);
  }

  const fills = [...tally(documentXml, /<w:shd\b[^>]*w:fill="([0-9A-Fa-f]{6})"/g)]
    .filter(([hex]) => hex.toUpperCase() !== "FFFFFF" && hex.toUpperCase() !== "AUTO")
    .map(([hex, occurrences]) => ({ hex: hex.toUpperCase(), occurrences }))
    .sort((a, b) => b.occurrences - a.occurrences);

  if (fills.length > 0) {
    notes.push(
      `${fills.length} distinct fill colour(s) found. They are listed under \`unnamed\` rather than ` +
      `emitted as \`blocks\` keys: a fill is a hex in the XML and nothing more, and only a person — or ` +
      `a diff against a formatter that already names it — knows which block it is.`,
    );
  }

  return {
    spec: parsed.data,
    unnamed: {
      fills,
      imageHeightsCm: [...heights]
        .map(([heightCm, occurrences]) => ({ heightCm, occurrences }))
        .sort((a, b) => b.heightCm - a.heightCm),
    },
    notes,
  };
}
