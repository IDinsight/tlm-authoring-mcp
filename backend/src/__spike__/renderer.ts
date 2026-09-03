/*
 * WP4 spike: a .docx renderer driven entirely by `properties.render`.
 *
 * The question this exists to answer is narrow — CAN this runtime produce the
 * documents the project already ships, or does making Word files here fight us
 * hard enough to justify a second service in another language? So it is written
 * to be judged on output, not on completeness.
 *
 * The rule it must not break, and the one worth watching: NOTHING here knows
 * what a maths lesson looks like. It knows banners, lines, images and spacers.
 * Which banner is turquoise, how tall a "bande" may stand, which colour marks
 * French — every one of those is read out of the RenderSpec. A `if (subject ===`
 * anywhere below would mean the abstraction failed, whatever the output looked
 * like.
 *
 * Not attempted: emphasis WITHIN a line. The golden sheets bold a word here and
 * there, and this model has no run-level styling — a line is one colour. That
 * is an authoring concern rather than a geometry one, so it would belong in the
 * document model, not in the spec.
 */
import type { RenderSpec } from "../kg-recipes/index.js";
import { zip, type ZipEntry } from "./zip.js";

const TWIPS_PER_CM = 566.929;
const EMU_PER_CM = 360000;

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

// ── The document model: what the authoring layer hands the renderer ──────────
//
// Finished lines, already written and already tightened. The renderer does not
// compose text, choose wording, or decide what a section contains — on this
// project that is the authoring model's job, and the golden sheets prove it:
// their [N] lines were rewritten by hand from the source guide's.

export type ImageRun = {
  media: string;          // file name inside word/media/
  role: string;           // looked up in spec.images.maxHeightCm
  aspectRatio: number;    // natural width / height
  // WHETHER a picture floats beside the text is a per-section choice — the
  // golden sheets embed some and set others in the run of the line. WHERE a
  // floated one goes is the formatter's (spec.images.placement). The spec's
  // single `placement` can therefore only be a default; that split is a finding.
  float?: boolean;
};
export type Run = { text: string } | { image: ImageRun };

export type Block =
  | { kind: "banner"; rows: { text: string; block: string }[][]; pageBreakBefore?: boolean }
  | { kind: "line"; variant: string; runs: Run[] }
  // Inter-block furniture. Its two numbers live in the MODEL rather than the
  // spec because the spec has no key for them — a finding, not a design choice.
  | { kind: "spacer"; sizePt: number; leadingPt: number };

export type DocumentModel = {
  blocks: Block[];
  media: { name: string; data: Buffer }[];
  bulletMarker?: string;
};

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
 * goes full width instead of floating, because a band squeezed beside text is
 * a sliver nobody can read. Width follows from height and the aspect ratio, and
 * is then capped by the page. This is the rule that overflowed four lessons
 * when it was applied without the ceiling.
 */
function imageSizeCm(img: ImageRun, spec: RenderSpec): { w: number; h: number } {
  const maxHeight = spec.images?.maxHeightCm?.[img.role];
  const usable = usableWidthCm(spec);
  const h = maxHeight ?? 2;
  let w = h * img.aspectRatio;
  const maxWidth = spec.images?.maxWidthCm;
  const goesFullWidth =
    spec.images?.fullWidthAboveAspectRatio !== undefined &&
    img.aspectRatio > spec.images.fullWidthAboveAspectRatio;
  if (!goesFullWidth && maxWidth !== undefined && w > maxWidth) {
    w = maxWidth;
  }
  return { w: Math.min(w, usable), h };
}

// ── XML fragments ───────────────────────────────────────────────────────────

function spacingXml(leadingPt: number | undefined, rule: string | undefined): string {
  if (leadingPt === undefined) return "";
  return `<w:spacing w:line="${ptToTwentieths(leadingPt)}" w:lineRule="${rule ?? "auto"}"/>`;
}

function drawingXml(img: ImageRun, spec: RenderSpec, relId: string, id: number): string {
  const { w, h } = imageSizeCm(img, spec);
  const cx = cmToEmu(w), cy = cmToEmu(h);

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

/*
 * A banner: a small table whose cells carry the colour.
 *
 * Several ROWS, not one — the header alone stacks week/lesson/day across three
 * cells, then the objective and the materials box each across the full width.
 * A single-row model rendered them side by side, squashed into thirds.
 */
function bannerXml(
  block: Extract<Block, { kind: "banner" }>, spec: RenderSpec,
): string {
  const totalTwips = cmToTwips(usableWidthCm(spec));
  const columns = Math.max(...block.rows.map((r) => r.length));
  const each = Math.floor(totalTwips / columns);
  const grid = Array.from({ length: columns }, () => `<w:gridCol w:w="${each}"/>`).join("");

  const rows = block.rows.map((cells, rowIndex) => {
    const span = Math.floor(columns / cells.length);
    return `<w:tr>${cells.map((cell, i) => {
      const style = spec.blocks?.[cell.block] ?? {};
      const fill = (style.fill ?? "auto").replace("#", "");
      const colour = (style.textColour ?? "000000").replace("#", "");
      const first = rowIndex === 0 && i === 0;
      const breakBefore = block.pageBreakBefore && first ? "<w:pageBreakBefore/>" : "";
      const bold = style.bold === false ? "" : "<w:b/>";
      return (
        `<w:tc><w:tcPr><w:tcW w:w="${each * span}" w:type="dxa"/>` +
        (span > 1 ? `<w:gridSpan w:val="${span}"/>` : "") +
        `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/></w:tcPr>` +
        `<w:p><w:pPr>${breakBefore}${spacingXml(spec.type?.leadingPt, spec.type?.leadingRule)}</w:pPr>` +
        `<w:r><w:rPr>${bold}<w:color w:val="${colour}"/></w:rPr>` +
        `<w:t xml:space="preserve">${esc(cell.text)}</w:t></w:r></w:p></w:tc>`
      );
    }).join("")}</w:tr>`;
  }).join("");

  return (
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>` +
    `<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>` +
    `<w:tblLook w:val="04A0"/></w:tblPr>` +
    `<w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`
  );
}

export function renderDocx(model: DocumentModel, spec: RenderSpec): Buffer {
  const variantColour = new Map(
    (spec.language?.variants ?? []).map((v) => [v.id, (v.colour ?? "000000").replace("#", "")]),
  );

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

  let drawingId = 1;
  const body = model.blocks.map((block) => {
    if (block.kind === "banner") return bannerXml(block, spec);

    if (block.kind === "spacer") {
      return (
        `<w:p><w:pPr>${spacingXml(block.leadingPt, "exact")}</w:pPr>` +
        `<w:r><w:rPr><w:sz w:val="${Math.round(block.sizePt * 2)}"/></w:rPr></w:r></w:p>`
      );
    }

    /*
     * A line. A paragraph carrying an image may need a different leading rule
     * from the body's — but only when the picture would actually be cropped.
     *
     * The narrow condition matters. "Any paragraph holding a picture" is the
     * obvious reading and it is wrong: it relaxes the leading under every
     * pictogram too, and each of those lines then grows by a few points. Across
     * a sheet that is enough to push a séance onto a third page. Only a picture
     * TALLER than the line box is at risk, which is why the golden sheets leave
     * their pictograms on the exact rule and their bands on the automatic one.
     *
     * A floated picture is never at risk — it has no line to respect.
     */
    const lineBoxCm = (spec.type?.leadingPt ?? 0) / 28.35;
    const cropped = block.runs.some(
      (r) => "image" in r && !r.image.float && imageSizeCm(r.image, spec).h > lineBoxCm,
    );
    const rule = cropped
      ? (spec.images?.paragraphLeadingRule ?? spec.type?.leadingRule)
      : spec.type?.leadingRule;
    const leading = cropped && spec.images?.paragraphLeadingRule === "auto"
      ? undefined
      : spec.type?.leadingPt;
    const colour = variantColour.get(block.variant) ?? "000000";

    const marker = model.bulletMarker ?? "";
    const runs = block.runs.map((run) => {
      if ("image" in run) {
        return drawingXml(run.image, spec, relOf.get(run.image.media) ?? "rId1", drawingId++);
      }
      return `<w:r><w:rPr><w:color w:val="${colour}"/></w:rPr><w:t xml:space="preserve">${esc(run.text)}</w:t></w:r>`;
    }).join("");
    const lead = `<w:r><w:rPr><w:color w:val="${colour}"/></w:rPr><w:t xml:space="preserve">${esc(marker)}</w:t></w:r>`;

    return `<w:p><w:pPr>${spacingXml(leading, rule)}</w:pPr>${marker ? lead : ""}${runs}</w:p>`;
  }).join("");

  const page = PAGE_CM[spec.page?.size ?? "A4"] ?? PAGE_CM.A4;
  const landscape = spec.page?.orientation === "landscape";
  const m = spec.page?.marginsCm ?? {};
  const sectPr =
    `<w:sectPr><w:pgSz w:w="${cmToTwips(landscape ? page.h : page.w)}" w:h="${cmToTwips(landscape ? page.w : page.h)}"` +
    `${landscape ? ' w:orient="landscape"' : ""}/>` +
    `<w:pgMar w:top="${cmToTwips(m.top ?? 2)}" w:right="${cmToTwips(m.right ?? 2)}"` +
    ` w:bottom="${cmToTwips(m.bottom ?? 2)}" w:left="${cmToTwips(m.left ?? 2)}"` +
    ` w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;

  const document =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"` +
    ` xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
    `<w:body>${body}${sectPr}</w:body></w:document>`;

  const family = esc(spec.type?.family ?? "Calibri");
  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:docDefaults><w:rPrDefault><w:rPr>` +
    `<w:rFonts w:ascii="${family}" w:hAnsi="${family}" w:cs="${family}"/>` +
    `<w:sz w:val="${Math.round((spec.type?.sizePt ?? 11) * 2)}"/>` +
    `<w:szCs w:val="${Math.round((spec.type?.sizePt ?? 11) * 2)}"/>` +
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
