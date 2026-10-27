/*
 * The InDesign renderer: a block tree, written into a designer's template, out comes an .idml.
 *
 * The Word renderer lays a page out from the formatter's geometry. This one lays out nothing:
 * the look — styles, colours, master pages, where each frame sits — is in the TEMPLATE, an
 * .idml the formatter points at (`render.indesign.template`). The renderer keeps the template's
 * resources unchanged, keeps only its MODEL PAGE, and fills that page's named frames:
 *
 *   • a frame named like a block style (`numero-lecon`) takes the top-level lines of that style;
 *   • every other block flows, in order, into the frame named `corps`, as one story — a line
 *     becomes a paragraph in its style, a picture an inline frame, a table an InDesign table.
 *
 * InDesign does the layout when the file is opened, which is why one flowing story is enough:
 * a longer directive pushes the rest down, as in Word. What the renderer cannot do is say
 * whether the page fits — only InDesign composes an InDesign page.
 *
 * A style is looked up in the page's domain group first (`AN/repere`), then at the top level.
 * A name the template does not define is a REFUSAL: an unstyled page that opens looking
 * finished is the failure the Word renderer already refuses.
 *
 * Proven on 2026-10-27 by backend/scripts/indesign/spike-idml.mjs, lesson 1 of the CI maths
 * pupil book; see docs/design-notes/indesign-export/README.md, « Spike result ».
 */
import type { RenderSpec } from "../kg-recipes/index.js";
import type { Block, Cell, DocumentTree, ImageRun, Run } from "./document.js";
import { imageSize, type ImageSize } from "./image-size.js";
import { unzip, zip, type ZipEntry } from "./zip.js";

const PT_PER_CM = 72 / 2.54;
// InDesign's default cell inset, 4 pt a side: what a picture in a cell must leave free.
const CELL_INSETS_PT = 8;
// The height a picture gets when the formatter names no size for its role.
const DEFAULT_PICTURE_HEIGHT_CM = 2;
// The one frame that is not filled by style name: where everything else flows.
const BODY_FRAME = "corps";
const NORMAL_PARAGRAPH = "ParagraphStyle/$ID/NormalParagraphStyle";
const NO_CHARACTER_STYLE = "CharacterStyle/$ID/[No character style]";
const NO_OBJECT_STYLE = "ObjectStyle/$ID/[None]";
const NO_BREAK_SPACE = " ";

/** A render the template cannot carry, with every reason found — not just the first. */
export class IdmlRefusal extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("; "));
  }
}

// ── The template ──────────────────────────────────────────────────────────────────────────────

export type IdmlTemplate = {
  parts: Map<string, Buffer>;
  stylesXml: string;
  styleIds: Set<string>;
  /** The spread holding the model page: the one with a frame named `corps`. */
  modelSpreadPath: string;
  pageId: string;
  /** Each named frame on the model page: its story, and its width in points. */
  frames: Map<string, { storyId: string; widthPt: number }>;
  /** Stories the master pages carry (the footer): kept whatever the page holds. */
  masterStoryIds: Set<string>;
};

const text = (part: Buffer | undefined) => (part ? part.toString("utf8") : "");

/** Read a template .idml, or refuse it naming what it lacks. */
export function readIdmlTemplate(bytes: Buffer): IdmlTemplate {
  let parts: Map<string, Buffer>;
  try {
    parts = unzip(bytes);
  } catch {
    throw new IdmlRefusal(["the InDesign template is not an .idml (it is not a zip)"]);
  }
  const stylesXml = text(parts.get("Resources/Styles.xml"));
  if (!stylesXml || !parts.has("designmap.xml")) {
    throw new IdmlRefusal(["the InDesign template has no designmap.xml or Resources/Styles.xml — export it from InDesign as InDesign Markup (IDML)"]);
  }

  const modelSpreadPath = [...parts.keys()].find((path) => path.startsWith("Spreads/") && text(parts.get(path)).includes(`Name="${BODY_FRAME}"`));
  if (!modelSpreadPath) {
    throw new IdmlRefusal([`the InDesign template has no model page: no frame is named « ${BODY_FRAME} »`]);
  }
  const spread = text(parts.get(modelSpreadPath));
  const pageIds = [...spread.matchAll(/<Page Self="([^"]+)"/g)].map((m) => m[1]);
  if (pageIds.length !== 1) {
    throw new IdmlRefusal([`the InDesign template's model page must be alone on its spread (found ${pageIds.length} pages there)`]);
  }

  const masterStoryIds = new Set<string>();
  for (const [path, part] of parts) {
    if (!path.startsWith("MasterSpreads/")) continue;
    for (const m of text(part).matchAll(/ParentStory="([^"]+)"/g)) masterStoryIds.add(m[1]);
  }

  return {
    parts,
    stylesXml,
    styleIds: new Set([...stylesXml.matchAll(/Self="((?:ParagraphStyle|CharacterStyle|ObjectStyle|TableStyle|CellStyle)\/[^"]+)"/g)].map((m) => m[1])),
    modelSpreadPath,
    pageId: pageIds[0],
    frames: namedFrames(spread),
    masterStoryIds,
  };
}

/** The model page's named text frames: which story each one shows, and how wide it is. */
function namedFrames(spread: string): Map<string, { storyId: string; widthPt: number }> {
  const frames = new Map<string, { storyId: string; widthPt: number }>();
  for (const m of spread.matchAll(/<TextFrame [^>]*>[\s\S]*?<\/TextFrame>/g)) {
    const element = m[0];
    const name = element.match(/ Name="([^"]+)"/)?.[1];
    const storyId = element.match(/ ParentStory="([^"]+)"/)?.[1];
    if (!name || !storyId || name.startsWith("$ID/")) continue;
    const xs = [...element.matchAll(/<PathPointType Anchor="([-\d.e]+) [-\d.e]+"/g)].map((p) => Number(p[1]));
    frames.set(name, { storyId, widthPt: xs.length ? Math.max(...xs) - Math.min(...xs) : 0 });
  }
  return frames;
}

// ── Rendering ─────────────────────────────────────────────────────────────────────────────────

export type IdmlOptions = {
  spec: RenderSpec;
  /** The domain group styles are looked up in first, e.g. "AN". */
  styleGroup?: string;
  /** The language this file is in; French gets its no-break spaces. */
  lang?: string;
};

export type IdmlLink = { fileName: string; data: Buffer };
export type IdmlOutput = { idml: Buffer; links: IdmlLink[] };

/*
 * Everything one render needs to remember while it writes: fresh ids, the pictures it has
 * linked, and every style it could not find (collected, so the refusal names them all).
 */
type Writer = {
  template: IdmlTemplate;
  options: IdmlOptions;
  media: Map<string, Buffer>;
  links: Map<string, IdmlLink & { size: ImageSize; format: string }>;
  missing: Set<string>;
  nextId: number;
};

export function renderIdml(tree: DocumentTree, template: IdmlTemplate, options: IdmlOptions): IdmlOutput {
  const writer: Writer = {
    template,
    options,
    media: new Map(tree.media.map((m) => [m.name, m.data])),
    links: new Map(),
    missing: new Set(),
    nextId: 0,
  };

  const blocks = pictogramsRideTheNextLine(writer, tree.blocks);
  const { byFrame, body } = routeBlocksToFrames(template, blocks);
  const stories = new Map<string, string>();
  for (const [frameName, frame] of template.frames) {
    const frameBlocks = frameName === BODY_FRAME ? body : byFrame.get(frameName) ?? [];
    stories.set(frame.storyId, blocksXml(writer, frameBlocks, frame.widthPt));
  }

  if (writer.missing.size > 0) {
    throw new IdmlRefusal([...writer.missing]);
  }
  return {
    idml: assembleIdml(template, stories),
    links: [...writer.links.values()].map(({ fileName, data }) => ({ fileName, data })),
  };
}

/*
 * A top-level line whose style names a frame on the model page goes to that frame — the lesson
 * number to `numero-lecon`, the title to `titre-lecon`. Everything else is the body.
 */
function routeBlocksToFrames(template: IdmlTemplate, blocks: Block[]): { byFrame: Map<string, Block[]>; body: Block[] } {
  const byFrame = new Map<string, Block[]>();
  const body: Block[] = [];
  for (const block of blocks) {
    const frameName = block.kind === "line" ? block.style : undefined;
    if (frameName && frameName !== BODY_FRAME && template.frames.has(frameName)) {
      byFrame.set(frameName, [...(byFrame.get(frameName) ?? []), block]);
    } else {
      body.push(block);
    }
  }
  return { byFrame, body };
}

// ── Styles ────────────────────────────────────────────────────────────────────────────────────

type StyleKind = "ParagraphStyle" | "ObjectStyle" | "TableStyle" | "CellStyle";

/** The domain group first, then the top level; a name in neither is recorded as missing. */
function styleRef(writer: Writer, kind: StyleKind, name: string): string {
  const group = writer.options.styleGroup;
  const grouped = group ? `${kind}/${group}%3a${name}` : undefined;
  if (grouped && writer.template.styleIds.has(grouped)) return grouped;
  const top = `${kind}/${name}`;
  if (writer.template.styleIds.has(top)) return top;
  writer.missing.add(`the InDesign template has no ${kind} named « ${name} »${group ? ` (looked in ${group}/ and at the top level)` : ""}`);
  return top;
}

/*
 * A picture role with no object style is not a refusal: an object style is optional in
 * InDesign, and the picture still sizes from the formatter. A paragraph or table style is.
 */
function objectStyleFor(writer: Writer, role: string): string {
  const group = writer.options.styleGroup;
  const candidates = [group ? `ObjectStyle/${group}%3a${role}` : undefined, `ObjectStyle/${role}`];
  return candidates.find((id) => id && writer.template.styleIds.has(id)) ?? NO_OBJECT_STYLE;
}

/*
 * Whether an object style places its frame itself — anchored at a custom position, like the
 * pictograms hung in the margin. Such a frame takes no inline setting of its own, which would
 * override the style, and takes no line of its own either.
 */
function styleAnchorsItsFrame(writer: Writer, objectStyle: string): boolean {
  const xml = writer.template.stylesXml;
  const start = xml.indexOf(`Self="${objectStyle}"`);
  if (start < 0) return false;
  const openingTag = xml.slice(start, xml.indexOf(">", start));
  const element = xml.slice(start, xml.indexOf("</ObjectStyle>", start));
  return /EnableAnchoredObjectOptions="true"/.test(openingTag) && /AnchoredPosition="Anchored"/.test(element);
}

// ── Blocks ────────────────────────────────────────────────────────────────────────────────────

const isAnchoredPicture = (writer: Writer, run: Run) =>
  "image" in run && styleAnchorsItsFrame(writer, objectStyleFor(writer, run.image.role));

/*
 * A line holding only pictures that their style places elsewhere (a pictogram in the margin)
 * would print as an empty line. Its pictures ride the next line instead — into a table's first
 * cell when a table comes next — and are placed beside it by their style.
 */
function pictogramsRideTheNextLine(writer: Writer, blocks: Block[]): Block[] {
  const out: Block[] = [];
  let carried: Run[] = [];
  for (const block of blocks) {
    if (block.kind === "line" && block.runs.length > 0 && block.runs.every((run) => isAnchoredPicture(writer, run))) {
      carried.push(...block.runs);
      continue;
    }
    let next = block;
    if (next.kind === "table") {
      next = { ...next, rows: next.rows.map((row) => row.map((cell) => ({ ...cell, blocks: pictogramsRideTheNextLine(writer, cell.blocks) }))) };
    }
    out.push(carried.length > 0 ? prependRuns(next, carried) : next);
    carried = [];
  }
  // Nothing followed: the pictures stay on a line of their own rather than vanish.
  if (carried.length > 0) out.push({ kind: "line", runs: carried });
  return out;
}

function prependRuns(block: Block, runs: Run[]): Block {
  if (block.kind === "line") return { ...block, runs: [...runs, ...block.runs] };
  if (block.kind !== "table" || block.rows.length === 0 || block.rows[0].length === 0) return block;
  const [[firstCell, ...otherCells], ...otherRows] = block.rows;
  const [firstBlock, ...rest] = firstCell.blocks;
  const cellBlocks = firstBlock ? [prependRuns(firstBlock, runs), ...rest] : [{ kind: "line" as const, runs }];
  return { ...block, rows: [[{ ...firstCell, blocks: cellBlocks }, ...otherCells], ...otherRows] };
}

function blocksXml(writer: Writer, blocks: Block[], widthPt: number): string {
  // An empty frame still needs one paragraph, or InDesign keeps the template's placeholder.
  if (blocks.length === 0) return paragraphXml(writer, undefined, "", true);
  return blocks.map((block, i) => blockXml(writer, block, widthPt, i === blocks.length - 1)).join("");
}

function blockXml(writer: Writer, block: Block, widthPt: number, last: boolean): string {
  switch (block.kind) {
    case "line":
      return paragraphXml(writer, block.style, block.runs.map((run) => runXml(writer, run, widthPt)).join(""), last, block.pageBreak);
    case "table":
      return paragraphXml(writer, undefined, characterRange(tableXml(writer, block, widthPt)), last, block.pageBreak);
    // Spacing is the paragraph styles' job in InDesign; a `clear` has nothing to end, since
    // nothing floats — pictures are inline or placed by their style.
    case "spacer":
    case "clear":
      return "";
  }
}

const characterRange = (inner: string) => `<CharacterStyleRange AppliedCharacterStyle="${NO_CHARACTER_STYLE}">${inner}</CharacterStyleRange>`;

/** One paragraph; the last one in a story or cell has no closing break, as InDesign writes it. */
function paragraphXml(writer: Writer, style: string | undefined, inner: string, last: boolean, pageBreak?: "before"): string {
  const styleId = style ? styleRef(writer, "ParagraphStyle", style) : NORMAL_PARAGRAPH;
  const startsPage = pageBreak === "before" ? ` StartParagraph="NextPage"` : "";
  return `<ParagraphStyleRange AppliedParagraphStyle="${styleId}"${startsPage}>${inner}${last ? "" : characterRange("<Br/>")}</ParagraphStyleRange>\n`;
}

function runXml(writer: Writer, run: Run, widthPt: number): string {
  if ("text" in run) return characterRange(`<Content>${escapeText(typeset(writer, run.text))}</Content>`);
  return characterRange(pictureXml(writer, run.image, widthPt));
}

/*
 * French typography: the space before ? ! : ; » and after « does not break, so a closing
 * guillemet never starts a line alone. Compositions are typed with ordinary spaces.
 */
function typeset(writer: Writer, words: string): string {
  if (!writer.options.lang?.toLowerCase().startsWith("fr")) return words;
  return words.replace(/ ([?!:;»])/g, `${NO_BREAK_SPACE}$1`).replace(/« /g, `«${NO_BREAK_SPACE}`);
}

function tableXml(writer: Writer, table: Extract<Block, { kind: "table" }>, widthPt: number): string {
  const columnCount = Math.max(...table.rows.map((row) => row.reduce((n, cell) => n + (cell.span ?? 1), 0)));
  const columnWidths = table.columnsCm
    ? table.columnsCm.map((cm) => cm * PT_PER_CM)
    : Array<number>(columnCount).fill(widthPt / columnCount);
  const id = newId(writer, "t");
  const tableStyle = table.style ? styleRef(writer, "TableStyle", table.style) : "TableStyle/$ID/[Basic Table]";

  const rows = table.rows.map((_, r) => `<Row Self="${id}Row${r}" Name="${r}" AutoGrow="true" MinimumHeight="3"/>`).join("");
  const columns = columnWidths.map((w, c) => `<Column Self="${id}Column${c}" Name="${c}" SingleColumnWidth="${w}"/>`).join("");
  const cells = table.rows.flatMap((row, r) => {
    let column = 0;
    return row.map((cell) => {
      const xml = cellXml(writer, table, cell, `${id}i${column}i${r}`, `${column}:${r}`, spannedWidth(columnWidths, column, cell.span ?? 1));
      column += cell.span ?? 1;
      return xml;
    });
  }).join("\n");

  return `<Table Self="${id}" HeaderRowCount="0" FooterRowCount="0" BodyRowCount="${table.rows.length}" ColumnCount="${columnWidths.length}" AppliedTableStyle="${tableStyle}" TableDirection="LeftToRightDirection">${rows}${columns}\n${cells}</Table>`;
}

const spannedWidth = (widths: number[], from: number, span: number) =>
  widths.slice(from, from + span).reduce((sum, w) => sum + w, 0);

function cellXml(writer: Writer, table: Extract<Block, { kind: "table" }>, cell: Cell, self: string, name: string, widthPt: number): string {
  // A cell names its own style when it differs from the table's — the evaluation box in a grid.
  const style = cell.style ?? table.style;
  const cellStyle = style ? styleRef(writer, "CellStyle", style) : "CellStyle/$ID/[None]";
  const content = blocksXml(writer, cell.blocks, widthPt - CELL_INSETS_PT);
  return `<Cell Self="${self}" Name="${name}" RowSpan="1" ColumnSpan="${cell.span ?? 1}" AppliedCellStyle="${cellStyle}" AppliedCellStylePriority="0">\n${content}</Cell>`;
}

// ── Pictures ──────────────────────────────────────────────────────────────────────────────────

/*
 * A picture as InDesign links it: a file in the package's Links/ folder, named relative to the
 * .idml, so the package opens wherever it is unzipped (checked in InDesign, 2026-10-27).
 */
function linkFor(writer: Writer, mediaName: string) {
  const existing = writer.links.get(mediaName);
  if (existing) return existing;
  const data = writer.media.get(mediaName);
  if (!data) {
    writer.missing.add(`the tree names a picture « ${mediaName} » that its media list does not hold`);
    return null;
  }
  const format = pictureFormat(data);
  const size = imageSize(data);
  if (!format || !size) {
    writer.missing.add(`picture « ${mediaName} » is neither PNG nor JPEG (a vector picture is rasterized before this point)`);
    return null;
  }
  const link = { fileName: uniqueFileName(writer, mediaName, format.extension), data, size, format: format.label };
  writer.links.set(mediaName, link);
  return link;
}

function pictureFormat(data: Buffer): { extension: string; label: string } | null {
  if (data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return { extension: "png", label: "$ID/Portable Network Graphics (PNG)" };
  if (data[0] === 0xff && data[1] === 0xd8) return { extension: "jpg", label: "$ID/JPEG" };
  return null;
}

/** An ASCII file name (the zip writer names entries in ASCII), unique within the package. */
function uniqueFileName(writer: Writer, mediaName: string, extension: string): string {
  const stem = mediaName.replace(/\.(png|jpe?g|svg)$/i, "").normalize("NFD").replace(/[^A-Za-z0-9._-]+/g, "-") || "picture";
  const taken = new Set([...writer.links.values()].map((link) => link.fileName));
  let fileName = `${stem}.${extension}`;
  for (let n = 2; taken.has(fileName); n += 1) fileName = `${stem}-${n}.${extension}`;
  return fileName;
}

/*
 * The size comes from the same knobs the Word renderer reads — the role's height, then the
 * formatter's width ceiling — and is capped by the frame or cell the picture sits in, keeping
 * its shape. The shape is the file's own, not the tree's rounded ratio.
 */
function pictureSizePt(spec: RenderSpec, image: ImageRun, pixels: ImageSize, roomPt: number): { width: number; height: number } {
  const aspect = pixels.width / pixels.height;
  const heightCm = spec.images?.inlineHeightCm?.[image.role] ?? spec.images?.maxHeightCm?.[image.role] ?? DEFAULT_PICTURE_HEIGHT_CM;
  let width = heightCm * aspect * PT_PER_CM;
  if (spec.images?.maxWidthCm !== undefined) width = Math.min(width, spec.images.maxWidthCm * PT_PER_CM);
  width = Math.min(width, roomPt);
  return { width, height: width / aspect };
}

function pictureXml(writer: Writer, image: ImageRun, roomPt: number): string {
  const link = linkFor(writer, image.media);
  if (!link) return "";
  const { width, height } = pictureSizePt(writer.options.spec, image, link.size, roomPt);
  const objectStyle = objectStyleFor(writer, image.role);
  const inline = styleAnchorsItsFrame(writer, objectStyle) ? "" : `<AnchoredObjectSetting AnchoredPosition="InlinePosition" AnchorYoffset="0"/>`;
  const scale = width / link.size.width;
  const corner = (x: number, y: number) => `<PathPointType Anchor="${x} ${y}" LeftDirection="${x} ${y}" RightDirection="${x} ${y}"/>`;
  return `<Rectangle Self="${newId(writer, "r")}" ContentType="GraphicType" AppliedObjectStyle="${objectStyle}" ItemTransform="1 0 0 1 0 0" StrokeWeight="0" StrokeColor="Swatch/None" FillColor="Swatch/None">` +
    `<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>${corner(0, 0)}${corner(0, height)}${corner(width, height)}${corner(width, 0)}</PathPointArray></GeometryPathType></PathGeometry></Properties>` +
    inline +
    `<Image Self="${newId(writer, "i")}" ItemTransform="${scale} 0 0 ${scale} 0 0">` +
    `<Properties><Profile type="string">$ID/None</Profile><GraphicBounds Left="0" Top="0" Right="${link.size.width}" Bottom="${link.size.height}"/></Properties>` +
    `<Link Self="${newId(writer, "l")}" LinkResourceURI="file:Links/${escapeAttribute(link.fileName)}" LinkResourceFormat="${link.format}" StoredState="Normal" LinkClassID="35906" LinkClientID="257" ShowInUI="true" CanEmbed="true" CanUnembed="true" CanPackage="true" ImportPolicy="NoAutoImport" ExportPolicy="NoAutoExport"/>` +
    `</Image></Rectangle>`;
}

// ── Assembly ──────────────────────────────────────────────────────────────────────────────────

// Ids the template never uses: InDesign's own are "u" + hex.
const newId = (writer: Writer, kind: string) => `zz${kind}${(writer.nextId += 1).toString(16)}`;

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = (s: string) => escapeText(s).replace(/"/g, "&quot;");

/*
 * The new .idml: the template's resources and masters as they are, its model page's spread,
 * the filled stories, and a designmap that lists only what is kept.
 */
function assembleIdml(template: IdmlTemplate, filled: Map<string, string>): Buffer {
  const keptStories = new Set([...template.masterStoryIds, ...filled.keys()]);
  const entries: ZipEntry[] = [{ name: "mimetype", data: template.parts.get("mimetype") ?? Buffer.from("application/vnd.adobe.indesign-idml-package"), store: true }];

  for (const [path, data] of template.parts) {
    if (path === "mimetype" || path === "designmap.xml" || path.endsWith("/")) continue;
    if (path.startsWith("Spreads/") && path !== template.modelSpreadPath) continue;
    const storyId = path.match(/^Stories\/Story_(.+)\.xml$/)?.[1];
    if (storyId !== undefined && !keptStories.has(storyId)) continue;
    const content = storyId !== undefined && filled.has(storyId) ? Buffer.from(withParagraphs(text(data), filled.get(storyId)!)) : data;
    entries.push({ name: path, data: content });
  }
  entries.push({ name: "designmap.xml", data: Buffer.from(designmapFor(template, keptStories)) });
  return zip(entries);
}

/** A frame's story: the template's own wrapper, its paragraphs replaced. */
function withParagraphs(storyXml: string, paragraphs: string): string {
  const start = storyXml.indexOf("<ParagraphStyleRange");
  const end = storyXml.lastIndexOf("</Story>");
  const head = start >= 0 ? storyXml.slice(0, start) : storyXml.slice(0, end);
  return head + paragraphs + storyXml.slice(end);
}

function designmapFor(template: IdmlTemplate, keptStories: Set<string>): string {
  const modelSpreadFile = template.modelSpreadPath.replace(/^Spreads\//, "");
  return text(template.parts.get("designmap.xml"))
    .replace(/\s*<idPkg:Spread src="Spreads\/([^"]+)"\s*\/>/g, (line, file) => (file === modelSpreadFile ? line : ""))
    .replace(/\s*<idPkg:Story src="Stories\/Story_([^"]+)\.xml"\s*\/>/g, (line, id) => (keptStories.has(id) ? line : ""))
    .replace(/StoryList="[^"]*"/, `StoryList="${[...keptStories].join(" ")}"`)
    // One page now: the page numbering section starts on it and spans it alone.
    .replace(/<Section ([^>]*?)Length="\d+"/, `<Section $1Length="1"`)
    .replace(/(<Section [^>]*?)PageStart="[^"]+"/, `$1PageStart="${template.pageId}"`)
    .replace(/(<Section [^>]*?)AlternateLayoutLength="\d+"/, `$1AlternateLayoutLength="1"`);
}

/*
 * What a person opens: the .idml, its pictures in Links/, and the fonts in « Document fonts »,
 * the folder InDesign activates fonts from — without it, InDesign silently substitutes them.
 */
export function packageIdml(idmlName: string, output: IdmlOutput, fonts: { fileName: string; data: Buffer }[]): Buffer {
  return zip([
    { name: idmlName, data: output.idml },
    ...output.links.map((link) => ({ name: `Links/${link.fileName}`, data: link.data })),
    ...fonts.map((font) => ({ name: `Document fonts/${font.fileName}`, data: font.data })),
  ]);
}
