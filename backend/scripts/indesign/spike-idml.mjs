#!/usr/bin/env node
/*
 * SPIKE — write one lesson's page into the styled InDesign template, without InDesign.
 *
 * The question it answers (docs/design-notes/indesign-export/README.md, step 2): can the server
 * turn compose_section's block tree into an .idml that InDesign opens as a finished-looking page?
 * It is throwaway code in the sense the renderer spike was: what it proves goes into
 * render/idml.ts; the script itself does not ship.
 *
 * How: the template's styles, colours, fonts and masters are copied untouched. Of its pages only
 * the model page is kept, and its three named frames are filled — `numero-lecon` and
 * `titre-lecon` from the header line, `corps` with every other block, in order, as ONE story:
 * a line → a paragraph in its style, a picture → an inline frame in that paragraph, a table → an
 * InDesign table. InDesign does the layout when the file is opened.
 *
 * Usage:
 *   node scripts/indesign/spike-idml.mjs <unzipped template dir> <tree.json> <links dir> <out.idml>
 * The template dir is gabarit-eleve.idml unzipped (its sample spreads may be left out: only the
 * model page's spread is read).
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { Resvg } from "@resvg/resvg-js";

const [templateDir, treePath, linksDir, outPath] = process.argv.slice(2).map((p) => p && resolve(p));
if (!outPath) {
  console.error("usage: spike-idml.mjs <unzipped template dir> <tree.json> <links dir> <out.idml>");
  process.exit(1);
}

const PT_PER_MM = 72 / 25.4;
const CORPS_WIDTH_MM = 170;

// Picture size per role. Where these numbers live for real (object style or the formatter's
// render bag) is a step-2 finding; here they are the pilot's own measurements.
const ROLE_SIZE_MM = {
  amorce: { width: 80 },        // the pilot's opening scene is ~99 × 49 mm; here it shares a 2-column box
  bande: { height: 22 },        // a pilot picture row is ~22 mm tall, ~100 mm wide
  "picto-section": { width: 13 },
  repere: { width: 7 },
  "je-retiens": { width: 120 },
};

// The model page and its frames, as build-gabarit.jsx named them.
const MODEL_FRAMES = ["numero-lecon", "titre-lecon", "corps"];

const tree = JSON.parse(readFileSync(treePath, "utf8"));
const domain = tree.domain;
const styles = readFileSync(join(templateDir, "Resources/Styles.xml"), "utf8");
const styleIds = new Set([...styles.matchAll(/Self="((?:ParagraphStyle|ObjectStyle|TableStyle|CellStyle)\/[^"]+)"/g)].map((m) => m[1]));

let nextId = 0;
const newId = (prefix) => `zz${prefix}${(++nextId).toString(16)}`;
const xmlText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attr = (s) => xmlText(s).replace(/"/g, "&quot;");

/*
 * A style is looked up in the lesson's domain group first, then at the top level — the rule the
 * design note settled for per-domain styles. A missing name is an error, never a silent default:
 * an unstyled page that looks finished is what the Word renderer already refuses.
 */
function styleRef(kind, name) {
  const grouped = `${kind}/${domain}%3a${name}`;
  if (styleIds.has(grouped)) return grouped;
  const top = `${kind}/${name}`;
  if (styleIds.has(top)) return top;
  throw new Error(`the template has no ${kind} named « ${name} » (looked in ${domain}/ then the top level)`);
}
const NORMAL_PARAGRAPH = "ParagraphStyle/$ID/NormalParagraphStyle";
const paragraphStyle = (name) => (name ? styleRef("ParagraphStyle", name) : NORMAL_PARAGRAPH);
const objectStyleFor = (role) => {
  try { return styleRef("ObjectStyle", role); } catch { return "ObjectStyle/$ID/[None]"; }
};

// ── pictures ─────────────────────────────────────────────────────────────────────────────────

/** A picture as InDesign will link it: a PNG on disk and its pixel size. SVGs are rasterised. */
function linkedPicture(mediaName) {
  const file = tree.media[mediaName];
  if (!file) throw new Error(`the tree names a picture « ${mediaName} » that its media list does not hold`);
  let path = join(linksDir, file);
  if (!existsSync(path)) return null;
  if (path.endsWith(".svg")) {
    // Rasterised for the spike only: whether InDesign can take an SVG link from IDML is untested.
    const png = new Resvg(readFileSync(path), { fitTo: { mode: "width", value: 600 } }).render().asPng();
    path = path.replace(/\.svg$/, ".png");
    writeFileSync(path, png);
  }
  const bytes = readFileSync(path);
  return { path, pixelWidth: bytes.readUInt32BE(16), pixelHeight: bytes.readUInt32BE(20) };
}

function frameSizePt(role, picture) {
  const aspect = picture.pixelWidth / picture.pixelHeight;
  const size = ROLE_SIZE_MM[role] ?? { width: 40 };
  const widthMm = size.width ?? size.height * aspect;
  const heightMm = size.height ?? size.width / aspect;
  return { width: widthMm * PT_PER_MM, height: heightMm * PT_PER_MM };
}

/** IDML writes link paths percent-encoded, accents decomposed — the form the template itself uses. */
const fileUri = (path) => "file:" + encodeURI(path.normalize("NFD"));

const missingPictures = [];
function inlinePicture(image) {
  const picture = linkedPicture(image.media);
  if (!picture) { missingPictures.push(image.media); return ""; }
  const { width, height } = frameSizePt(image.role, picture);
  const scale = width / picture.pixelWidth;
  const point = (x, y) => `<PathPointType Anchor="${x} ${y}" LeftDirection="${x} ${y}" RightDirection="${x} ${y}"/>`;
  return `<Rectangle Self="${newId("r")}" ContentType="GraphicType" AppliedObjectStyle="${objectStyleFor(image.role)}" ItemTransform="1 0 0 1 0 0" StrokeWeight="0" StrokeColor="Swatch/None" FillColor="Swatch/None">
<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>${point(0, 0)}${point(0, height)}${point(width, height)}${point(width, 0)}</PathPointArray></GeometryPathType></PathGeometry></Properties>
<AnchoredObjectSetting AnchoredPosition="InlinePosition" AnchorYoffset="0"/>
<Image Self="${newId("i")}" ItemTransform="${scale} 0 0 ${scale} 0 0">
<Properties><Profile type="string">$ID/None</Profile><GraphicBounds Left="0" Top="0" Right="${picture.pixelWidth}" Bottom="${picture.pixelHeight}"/></Properties>
<Link Self="${newId("l")}" LinkResourceURI="${attr(fileUri(picture.path))}" LinkResourceFormat="$ID/Portable Network Graphics (PNG)" StoredState="Normal" LinkClassID="35906" LinkClientID="257" ShowInUI="true" CanEmbed="true" CanUnembed="true" CanPackage="true" ImportPolicy="NoAutoImport" ExportPolicy="NoAutoExport"/>
</Image>
</Rectangle>`;
}

// ── text ─────────────────────────────────────────────────────────────────────────────────────

const NO_CHARACTER_STYLE = "CharacterStyle/$ID/[No character style]";
const characterRange = (inner) => `<CharacterStyleRange AppliedCharacterStyle="${NO_CHARACTER_STYLE}">${inner}</CharacterStyleRange>`;

function runXml(run) {
  if (run.text !== undefined) return characterRange(`<Content>${xmlText(run.text)}</Content>`);
  return characterRange(inlinePicture(run.image));
}

/** One paragraph; `last` leaves off the closing break, as InDesign writes a story's final line. */
function paragraphXml(style, inner, last) {
  return `<ParagraphStyleRange AppliedParagraphStyle="${paragraphStyle(style)}">${inner}${last ? "" : characterRange("<Br/>")}</ParagraphStyleRange>\n`;
}

function blocksXml(blocks) {
  return blocks.map((block, i) => blockXml(block, i === blocks.length - 1)).join("");
}

function blockXml(block, last) {
  switch (block.kind) {
    case "line": return paragraphXml(block.style, block.runs.map(runXml).join(""), last);
    case "table": return paragraphXml(undefined, characterRange(tableXml(block)), last);
    case "spacer": case "clear": return ""; // geometry in the tree; InDesign spaces by style
    default: throw new Error(`block kind « ${block.kind} » has no InDesign form yet`);
  }
}

function tableXml(table) {
  const columnCount = Math.max(...table.rows.map((row) => row.length));
  const widthsPt = table.columnsCm
    ? table.columnsCm.map((cm) => cm * 10 * PT_PER_MM)
    : Array(columnCount).fill((CORPS_WIDTH_MM * PT_PER_MM) / columnCount);
  const self = newId("t");
  const cellStyle = styleRef("CellStyle", table.style ?? "encadre");
  const rows = table.rows.map((_, r) => `<Row Self="${self}Row${r}" Name="${r}" AutoGrow="true" MinimumHeight="3"/>`).join("");
  const columns = widthsPt.map((w, c) => `<Column Self="${self}Column${c}" Name="${c}" SingleColumnWidth="${w}"/>`).join("");
  const cells = table.rows.flatMap((row, r) => row.map((cell, c) =>
    `<Cell Self="${self}i${c}i${r}" Name="${c}:${r}" RowSpan="1" ColumnSpan="${cell.span ?? 1}" AppliedCellStyle="${cellStyle}" AppliedCellStylePriority="0">\n${blocksXml(cell.blocks)}</Cell>`)).join("\n");
  return `<Table Self="${self}" HeaderRowCount="0" FooterRowCount="0" BodyRowCount="${table.rows.length}" ColumnCount="${columnCount}" AppliedTableStyle="${styleRef("TableStyle", table.style ?? "encadre")}" TableDirection="LeftToRightDirection">${rows}${columns}\n${cells}</Table>`;
}

// ── the page ─────────────────────────────────────────────────────────────────────────────────

// The header line fills two frames: « Leçon 1 » and the title.
const [header, ...body] = tree.blocks;
const headerText = header.runs.map((run) => run.text ?? "").join("");
const [lessonNumber, ...titleParts] = headerText.split(/\s+·\s+/);
// The InDesign book is one page per lesson (design note, decision 1): its formatter overrides the
// « Tu fais » template without the break. The spike applies that override here.
const corpsBlocks = body.map(({ pageBreak, ...block }) => block);

const out = join(dirname(outPath), "idml-build");
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "Spreads"), { recursive: true });
mkdirSync(join(out, "Stories"), { recursive: true });
for (const part of ["mimetype", "META-INF", "Resources", "MasterSpreads", "XML"]) cpSync(join(templateDir, part), join(out, part), { recursive: true });

// Only the model page's spread is kept.
const spreadFile = readdirSync(join(templateDir, "Spreads")).find((f) => readFileSync(join(templateDir, "Spreads", f), "utf8").includes('Name="corps"'));
if (!spreadFile) throw new Error("the template has no model page: no frame is named « corps »");
const spread = readFileSync(join(templateDir, "Spreads", spreadFile), "utf8");
cpSync(join(templateDir, "Spreads", spreadFile), join(out, "Spreads", spreadFile));
const storyOfFrame = Object.fromEntries([...spread.matchAll(/<TextFrame Self="[^"]+" ParentStory="([^"]+)"[^>]*? Name="([^"]+)"/g)].map((m) => [m[2], m[1]]));
for (const name of MODEL_FRAMES) if (!storyOfFrame[name]) throw new Error(`the model page has no frame named « ${name} »`);
const pageId = spread.match(/<Page Self="([^"]+)"/)[1];

/** A frame's story: the template's own wrapper, its paragraphs replaced. */
function writeStory(frameName, paragraphsXml) {
  const id = storyOfFrame[frameName];
  const template = readFileSync(join(templateDir, "Stories", `Story_${id}.xml`), "utf8");
  const start = template.indexOf("<ParagraphStyleRange");
  const end = template.lastIndexOf("</Story>");
  writeFileSync(join(out, "Stories", `Story_${id}.xml`), template.slice(0, start) + paragraphsXml + template.slice(end));
}
writeStory("numero-lecon", paragraphXml("numero-lecon", runXml({ text: lessonNumber }), true));
writeStory("titre-lecon", paragraphXml("titre-lecon", runXml({ text: titleParts.join(" · ") }), true));
writeStory("corps", blocksXml(corpsBlocks));

// Master pages keep their own stories (the footer); everything else from the sample pages goes.
const masterStories = new Set();
for (const f of readdirSync(join(templateDir, "MasterSpreads"))) {
  for (const m of readFileSync(join(templateDir, "MasterSpreads", f), "utf8").matchAll(/ParentStory="([^"]+)"/g)) masterStories.add(m[1]);
}
for (const id of masterStories) cpSync(join(templateDir, "Stories", `Story_${id}.xml`), join(out, "Stories", `Story_${id}.xml`));
const keptStories = new Set([...masterStories, ...MODEL_FRAMES.map((name) => storyOfFrame[name])]);

let designmap = readFileSync(join(templateDir, "designmap.xml"), "utf8");
designmap = designmap
  .replace(/\s*<idPkg:Spread src="Spreads\/([^"]+)"\s*\/>/g, (line, file) => (file === spreadFile ? line : ""))
  .replace(/\s*<idPkg:Story src="Stories\/Story_([^"]+)\.xml"\s*\/>/g, (line, id) => (keptStories.has(id) ? line : ""))
  .replace(/StoryList="[^"]*"/, `StoryList="${[...keptStories].join(" ")}"`)
  .replace(/<Section ([^>]*)Length="\d+"([^>]*)PageStart="[^"]+"([^>]*)AlternateLayoutLength="\d+"/,
    `<Section $1Length="1"$2PageStart="${pageId}"$3AlternateLayoutLength="1"`);
writeFileSync(join(out, "designmap.xml"), designmap);

// An IDML is a zip whose first entry is an uncompressed `mimetype`.
rmSync(outPath, { force: true });
execFileSync("zip", ["-X0q", outPath, "mimetype"], { cwd: out });
execFileSync("zip", ["-rXq", outPath, "META-INF", "designmap.xml", "Resources", "MasterSpreads", "Spreads", "Stories", "XML"], { cwd: out });

console.log(`wrote ${outPath}`);
console.log(`  header: « ${lessonNumber} » / « ${titleParts.join(" · ")} »; corps: ${corpsBlocks.length} blocks, domain ${domain}`);
if (missingPictures.length) console.log(`  pictures missing from the links folder, left out: ${missingPictures.join(", ")}`);
