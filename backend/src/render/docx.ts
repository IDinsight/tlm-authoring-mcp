/*
 * A .docx renderer: a block tree in, a Word file out, everything about how it
 * LOOKS read from `properties.render`.
 *
 * It reproduces both live document types from the same code — the CI-maths
 * teacher sheet (banners, floated pictures, an exact leading rule) and the
 * pupil tool (nested picture grids, three type sizes, a free-standing page
 * break). Getting there took one correction worth keeping in view:
 *
 *   A BANNER AND AN IMAGE GRID ARE THE SAME THING — a table whose cells hold
 *   blocks. Blocks nest; a cell is not a string.
 *
 * The first version made a cell a string, which fitted the teacher sheet and
 * dropped all 42 of the pupil tool's pictures.
 *
 * The rule to keep watching: NOTHING here knows what a maths lesson looks like.
 * It knows tables, lines, runs, pictures and spacers. Which banner is
 * turquoise, how tall a band may stand, which colour marks French, where a page
 * break is carried — every one is read out of the RenderSpec. A
 * `if (subject === …)` anywhere below would mean the abstraction failed,
 * whatever the output looked like.
 *
 * See docs/design-notes/renderer-spike.md.
 */
import type { RenderSpec } from "../kg-recipes/index.js";
import type { Block, Cell, DocumentTree, ImageRun, Run } from "./document.js";
import { zip, type ZipEntry } from "./zip.js";

const TWIPS_PER_CM = 566.929;
const EMU_PER_CM = 360000;
const POINTS_PER_CM = 28.35;

const cmToTwips = (cm: number) => Math.round(cm * TWIPS_PER_CM);
const ptToTwentieths = (pt: number) => Math.round(pt * 20);
const cmToEmu = (cm: number) => Math.round(cm * EMU_PER_CM);

const PAGE_CM: Record<string, { w: number; h: number }> = {
  A4: { w: 21.0, h: 29.7 }, A5: { w: 14.8, h: 21.0 }, A3: { w: 29.7, h: 42.0 },
  Letter: { w: 21.59, h: 27.94 }, Legal: { w: 21.59, h: 35.56 },
};

/** XML text escaping. Authored French carries & and « » routinely. */
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── What this renders ───────────────────────────────────────────────────────
//
// The block tree, defined and validated in `document.ts` — finished lines,
// already written and already tightened. The renderer does not compose text,
// choose wording or decide what a section contains: on this project that is the
// authoring model's job, and the golden sheets prove it, because their [N]
// lines were rewritten by hand from the source guide's.
//
// A block names a `style` and a picture names a `role`. That is the ONLY
// channel through which appearance reaches the page, and it is what keeps this
// file subject-agnostic: the tree says "this is a phaseBanner", the spec says
// what one looks like.



// ── Geometry, resolved from the spec ────────────────────────────────────────

function usableWidthCm(spec: RenderSpec): number {
  const page = PAGE_CM[spec.page?.size ?? "A4"] ?? PAGE_CM.A4;
  const width = spec.page?.orientation === "landscape" ? page.h : page.w;
  return width - (spec.page?.marginsCm?.left ?? 0) - (spec.page?.marginsCm?.right ?? 0);
}

/*
 * An image's size, from its role and its shape — never from the file.
 *
 * The height ceiling is per role, and a picture wider than the declared ratio
 * goes full width instead of floating, because a band squeezed beside text is a
 * sliver nobody can read. Width follows from height and the aspect ratio, then
 * is capped by the page. This is the rule that overflowed four lessons when it
 * was applied without the ceiling.
 */
function imageSizeCm(img: ImageRun, spec: RenderSpec): { w: number; h: number } {
  const h = spec.images?.maxHeightCm?.[img.role] ?? 2;
  let w = h * img.aspectRatio;
  const maxWidth = spec.images?.maxWidthCm;
  const goesFullWidth =
    spec.images?.fullWidthAboveAspectRatio !== undefined &&
    img.aspectRatio > spec.images.fullWidthAboveAspectRatio;
  if (!goesFullWidth && maxWidth !== undefined && w > maxWidth) w = maxWidth;
  return { w: Math.min(w, usableWidthCm(spec)), h };
}

// ── Rendering ───────────────────────────────────────────────────────────────

type Style = NonNullable<RenderSpec["blocks"]>[string];

/*
 * Threaded down the block tree so a page break can be attached to the first
 * paragraph the renderer reaches — which may be several levels inside a table.
 * `pending` is consumed once; whoever takes it clears it.
 */
type Context = { spec: RenderSpec; relOf: Map<string, string>; nextId: number; pending: boolean };

const styleOf = (ctx: Context, name?: string): Style => (name && ctx.spec.blocks?.[name]) || {};

const hex = (value: string | undefined, fallback?: string) =>
  (value ?? fallback)?.replace("#", "");

function spacingXml(leadingPt: number | undefined, rule: string | undefined): string {
  if (leadingPt === undefined) return "";
  return `<w:spacing w:line="${ptToTwentieths(leadingPt)}" w:lineRule="${rule ?? "auto"}"/>`;
}

/*
 * How a page break reaches the page — one of three, declared by the formatter.
 *
 * It genuinely differs between the two live document types: the teacher sheet
 * hangs the break off its séance banner's own paragraph property, because a
 * paragraph carrying a break produces a BLANK PAGE whenever the page before it
 * is already full. The pupil tool uses exactly that free-standing paragraph.
 * Silently supporting one of them is how the pupil tool lost its break.
 */
function standaloneBreak(ctx: Context): string {
  switch (ctx.spec.pagination?.pageBreakCarrier) {
    case "paragraph":
      return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
    case "section-break":
      return `<w:p><w:pPr>${sectPrXml(ctx.spec)}</w:pPr></w:p>`;
    default:
      return "";   // "banner-property": it rides the next paragraph instead
  }
}

/** Claim the pending break for a paragraph property, if that is the carrier. */
function takeBreakForPPr(ctx: Context): string {
  if (!ctx.pending) return "";
  const carrier = ctx.spec.pagination?.pageBreakCarrier ?? "banner-property";
  if (carrier !== "banner-property") return "";
  ctx.pending = false;
  return "<w:pageBreakBefore/>";
}

function runPropsXml(ctx: Context, style: Style, colour: string | undefined): string {
  const parts = [
    style.bold ? "<w:b/>" : "",
    style.italic ? "<w:i/>" : "",
    style.sizePt ? `<w:sz w:val="${Math.round(style.sizePt * 2)}"/><w:szCs w:val="${Math.round(style.sizePt * 2)}"/>` : "",
    colour ? `<w:color w:val="${colour}"/>` : "",
  ];
  const inner = parts.join("");
  return inner ? `<w:rPr>${inner}</w:rPr>` : "";
}

function drawingXml(img: ImageRun, ctx: Context): string {
  const { spec } = ctx;
  const { w, h } = imageSizeCm(img, spec);
  const cx = cmToEmu(w), cy = cmToEmu(h);
  const id = ctx.nextId++;
  const relId = ctx.relOf.get(img.media) ?? "rId1";

  const picture =
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(img.media)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic>`;

  if (img.float) {
    // Floated against the margin the spec names, text wrapping on the other
    // side. The offset is COMPUTED, never stored: a stored one silently stops
    // being flush the moment a margin changes.
    const placement = spec.images?.placement ?? "float-right";
    const offset = placement === "float-right" ? cmToEmu(usableWidthCm(spec) - w) : 0;
    const wrap = placement === "float-right" ? "left" : "right";
    return (
      `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="54000" distR="0"` +
      ` simplePos="0" relativeHeight="251657216" behindDoc="0" locked="0"` +
      ` layoutInCell="1" allowOverlap="1">` +
      `<wp:simplePos x="0" y="0"/>` +
      `<wp:positionH relativeFrom="margin"><wp:posOffset>${offset}</wp:posOffset></wp:positionH>` +
      `<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>` +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
      `<wp:wrapSquare wrapText="${wrap}"/>` +
      `<wp:docPr id="${id}" name="${esc(img.role)} ${id}"/><wp:cNvGraphicFramePr/>` +
      `${picture}</wp:anchor></w:drawing></w:r>`
    );
  }

  return (
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${id}" name="${esc(img.role)} ${id}"/>` +
    `${picture}</wp:inline></w:drawing></w:r>`
  );
}

function lineXml(
  block: Extract<Block, { kind: "line" }>, ctx: Context, inherited?: string,
): string {
  const { spec } = ctx;
  // A style on a CONTAINER reaches what it contains: the white bold text of a
  // banner is the banner's style, not something each line inside it restates.
  // A line's own style wins where it sets a value.
  const style = { ...styleOf(ctx, inherited), ...styleOf(ctx, block.style) };

  /*
   * A paragraph carrying a picture may need a different leading rule from the
   * body's — but only when the picture would actually be cropped.
   *
   * The narrow condition matters. "Any paragraph holding a picture" is the
   * obvious reading and it is wrong: it relaxes the leading under every
   * pictogram too, and each of those lines then grows by a few points. Across a
   * sheet that is enough to push a séance onto a third page. Only a picture
   * TALLER than the line box is at risk, and a floated one never is — it has no
   * line to respect.
   */
  const lineBoxCm = (spec.type?.leadingPt ?? 0) / POINTS_PER_CM;
  const cropped = block.runs.some(
    (r) => "image" in r && !r.image.float && imageSizeCm(r.image, spec).h > lineBoxCm,
  );
  const rule = cropped ? (spec.images?.paragraphLeadingRule ?? spec.type?.leadingRule) : spec.type?.leadingRule;
  const leading = cropped && spec.images?.paragraphLeadingRule === "auto" ? undefined : spec.type?.leadingPt;

  const variantColour = hex(
    (spec.language?.variants ?? []).find((v) => v.id === block.variant)?.colour,
  );
  const colour = hex(style.textColour, variantColour);

  const marker = style.marker
    ? `<w:r>${runPropsXml(ctx, style, colour)}<w:t xml:space="preserve">${esc(style.marker)} </w:t></w:r>`
    : "";

  const runs = block.runs.map((run) => {
    if ("image" in run) return drawingXml(run.image, ctx);
    const runStyle = run.style ? { ...style, ...styleOf(ctx, run.style) } : style;
    const runColour = hex(styleOf(ctx, run.style).textColour, colour);
    return `<w:r>${runPropsXml(ctx, runStyle, runColour)}<w:t xml:space="preserve">${esc(run.text)}</w:t></w:r>`;
  }).join("");

  const keep = style.keepWithNext ? "<w:keepNext/>" : "";
  const props = `${takeBreakForPPr(ctx)}${keep}${spacingXml(leading, rule)}`;
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${marker}${runs}</w:p>`;
}

/*
 * A table — which is a banner AND an image grid.
 *
 * Treating them as one construct is the whole point of this rewrite. The old
 * model had a "banner" of text cells, so every picture in the pupil tool's
 * grids was dropped: 42 of 42. A cell holds blocks now, so a grid cell holds a
 * line holding a picture, and the same code lays out both.
 */
function tableXml(block: Extract<Block, { kind: "table" }>, ctx: Context): string {
  const { spec } = ctx;
  const style = styleOf(ctx, block.style);
  const columns = Math.max(...block.rows.map((r) => r.reduce((n, c) => n + (c.span ?? 1), 0)));
  const widths = block.columnsCm?.length
    ? block.columnsCm.map(cmToTwips)
    : Array.from({ length: columns }, () => Math.floor(cmToTwips(usableWidthCm(spec)) / columns));

  const grid = widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("");

  const borders = style.border === "none" || style.border === undefined
    ? `<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/>` +
      `<w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>`
    : `<w:tblBorders><w:top w:val="single" w:sz="${style.border === "thin" ? 4 : 8}"/>` +
      `<w:left w:val="single" w:sz="${style.border === "thin" ? 4 : 8}"/>` +
      `<w:bottom w:val="single" w:sz="${style.border === "thin" ? 4 : 8}"/>` +
      `<w:right w:val="single" w:sz="${style.border === "thin" ? 4 : 8}"/>` +
      `<w:insideH w:val="single" w:sz="${style.border === "thin" ? 4 : 8}"/>` +
      `<w:insideV w:val="single" w:sz="${style.border === "thin" ? 4 : 8}"/></w:tblBorders>`;

  const margin = style.cellMarginsCm !== undefined ? cmToTwips(style.cellMarginsCm) : 0;

  const rows = block.rows.map((cells) => {
    let column = 0;
    return `<w:tr>${cells.map((cell) => {
      const span = cell.span ?? 1;
      const width = widths.slice(column, column + span).reduce((a, b) => a + b, 0);
      column += span;
      const cellStyle = styleOf(ctx, cell.style);
      const fill = hex(cellStyle.fill);
      return (
        `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>` +
        (span > 1 ? `<w:gridSpan w:val="${span}"/>` : "") +
        (fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : "") +
        `</w:tcPr>` +
        // A cell must contain at least one paragraph, even when it holds nothing.
        (renderBlocks(cell.blocks, ctx, cell.style ?? block.style) || "<w:p/>") +
        `</w:tc>`
      );
    }).join("")}</w:tr>`;
  }).join("");

  return (
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/>` +
    `<w:tblCellMar><w:left w:w="${margin}" w:type="dxa"/><w:right w:w="${margin}" w:type="dxa"/></w:tblCellMar>` +
    `${borders}<w:tblLook w:val="04A0"/></w:tblPr>` +
    `<w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`
  );
}

function renderBlocks(blocks: Block[], ctx: Context, inherited?: string): string {
  return blocks.map((block) => {
    // A break declared on a block is emitted the way the FORMATTER says, not
    // the way this renderer prefers: as its own paragraph, as a section break,
    // or as a property the next paragraph picks up.
    let prefix = "";
    if (block.kind !== "spacer" && block.pageBreak === "before") {
      prefix = standaloneBreak(ctx);
      ctx.pending = prefix === "";
    }

    if (block.kind === "spacer") {
      return (
        `${prefix}<w:p><w:pPr>${spacingXml(block.leadingPt, "exact")}</w:pPr>` +
        `<w:r><w:rPr><w:sz w:val="${Math.round(block.sizePt * 2)}"/></w:rPr></w:r></w:p>`
      );
    }
    return prefix + (block.kind === "table" ? tableXml(block, ctx) : lineXml(block, ctx, inherited));
  }).join("");
}

function sectPrXml(spec: RenderSpec): string {
  const page = PAGE_CM[spec.page?.size ?? "A4"] ?? PAGE_CM.A4;
  const landscape = spec.page?.orientation === "landscape";
  const m = spec.page?.marginsCm ?? {};
  return (
    `<w:sectPr><w:pgSz w:w="${cmToTwips(landscape ? page.h : page.w)}"` +
    ` w:h="${cmToTwips(landscape ? page.w : page.h)}"${landscape ? ' w:orient="landscape"' : ""}/>` +
    `<w:pgMar w:top="${cmToTwips(m.top ?? 2)}" w:right="${cmToTwips(m.right ?? 2)}"` +
    ` w:bottom="${cmToTwips(m.bottom ?? 2)}" w:left="${cmToTwips(m.left ?? 2)}"` +
    ` w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`
  );
}

export function renderDocx(model: DocumentTree, spec: RenderSpec): Buffer {
  // Images get a relationship each; ids continue past the styles part.
  const rels: string[] = [
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
  ];
  const relOf = new Map<string, string>();
  model.media.forEach((m, i) => {
    const id = `rId${i + 2}`;
    relOf.set(m.name, id);
    rels.push(
      `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`,
    );
  });

  const ctx: Context = { spec, relOf, nextId: 1, pending: false };
  const body = renderBlocks(model.blocks, ctx);

  const document =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"` +
    ` xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
    `<w:body>${body}${sectPrXml(spec)}</w:body></w:document>`;

  const family = esc(spec.type?.family ?? "Calibri");
  const size = Math.round((spec.type?.sizePt ?? 11) * 2);
  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:docDefaults><w:rPrDefault><w:rPr>` +
    `<w:rFonts w:ascii="${family}" w:hAnsi="${family}" w:cs="${family}"/>` +
    `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` +
    `</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>` +
    spacingXml(spec.type?.leadingPt, spec.type?.leadingRule) +
    `</w:pPr></w:pPrDefault></w:docDefaults></w:styles>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Default Extension="png" ContentType="image/png"/>` +
    `<Default Extension="jpeg" ContentType="image/jpeg"/>` +
    `<Default Extension="jpg" ContentType="image/jpeg"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    `</Types>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;

  const docRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`;

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rootRels, "utf8") },
    { name: "word/document.xml", data: Buffer.from(document, "utf8") },
    { name: "word/_rels/document.xml.rels", data: Buffer.from(docRels, "utf8") },
    { name: "word/styles.xml", data: Buffer.from(styles, "utf8") },
    ...model.media.map((m) => ({ name: `word/media/${m.name}`, data: m.data })),
  ];
  return zip(entries);
}
