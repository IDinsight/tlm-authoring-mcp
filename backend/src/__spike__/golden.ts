/*
 * Read a produced sheet back into the renderer's own model.
 *
 * This is the half that makes the spike honest: without it the comparison would
 * be the renderer marking its own homework. The model is recovered from the
 * GOLDEN file — tables from its tables, styles from its fills, variants from
 * its run colours, pictures from its drawings — and then rendered again from
 * scratch. Anything the renderer gets wrong shows up as a difference against
 * the file it came from.
 *
 * It walks the same nesting the renderer writes: a cell holds blocks, and a
 * block may be another table. It doubles as a sketch of WP6a (reading a
 * corrected document back in), which is this problem pointed the other way.
 */
import { unzip } from "./zip.js";
import type { Block, Cell, DocumentModel, Run } from "./renderer.js";

const EMU_PER_CM = 360000;

/** Top-level <w:tbl> and <w:p> children of a container, in document order. */
function topLevel(xml: string): { tag: "tbl" | "p"; xml: string }[] {
  const out: { tag: "tbl" | "p"; xml: string }[] = [];
  const opener = /<w:(tbl|p)[ >]/g;
  let i = 0;
  for (;;) {
    opener.lastIndex = i;
    const m = opener.exec(xml);
    if (!m) break;
    const tag = m[1] as "tbl" | "p";
    // Scan for the matching close, since a table contains paragraphs and a cell
    // may contain another table.
    const nested = new RegExp(`</?w:${tag}[ >/]`, "g");
    nested.lastIndex = m.index;
    let depth = 0, end = -1;
    for (;;) {
      const n = nested.exec(xml);
      if (!n) break;
      // <w:p/> is a self-closing empty paragraph: it opens and closes at once.
      if (xml.startsWith(`<w:${tag}/>`, n.index)) { if (depth === 0) { end = n.index + `<w:${tag}/>`.length; break; } continue; }
      depth += xml.startsWith("</", n.index) ? -1 : 1;
      if (depth === 0) { end = xml.indexOf(">", n.index) + 1; break; }
    }
    if (end < 0) break;
    out.push({ tag, xml: xml.slice(m.index, end) });
    i = end;
  }
  return out;
}

/*
 * The immediate children of a container that carry a given tag.
 *
 * Depth matching, and nothing else: <w:tr> and <w:tc> nest properly — the
 * pupil tool's grids put whole tables inside cells — so counting opens against
 * closes finds the outer one correctly, and jumping past each match skips
 * everything inside it.
 *
 * An earlier version blanked nested tables out before scanning for rows. That
 * located the rows correctly and then parsed the cells from the BLANKED text,
 * so every nested grid vanished: 31 of the pupil tool's 42 pictures. Masking is
 * safe for finding boundaries and unsafe for anything you then read.
 */
function children(xml: string, tag: "tr" | "tc"): string[] {
  const out: string[] = [];
  const marker = new RegExp(`</?w:${tag}[ >]`, "g");
  let i = 0;
  for (;;) {
    marker.lastIndex = i;
    const open = marker.exec(xml);
    if (!open || xml.startsWith("</", open.index)) break;
    let depth = 0, end = -1;
    marker.lastIndex = open.index;
    for (;;) {
      const n = marker.exec(xml);
      if (!n) break;
      depth += xml.startsWith("</", n.index) ? -1 : 1;
      if (depth === 0) { end = xml.indexOf(">", n.index) + 1; break; }
    }
    if (end < 0) break;
    out.push(xml.slice(open.index, end));
    i = end;
  }
  return out;
}

const rowsOf = (table: string) => children(table.slice(table.indexOf(">") + 1), "tr");

const cellsOf = (row: string) => children(row, "tc");

/** A cell's content — everything past its properties element. */
function cellBody(tc: string): string {
  const close = tc.indexOf("</w:tcPr>");
  return close < 0 ? tc : tc.slice(close + "</w:tcPr>".length);
}

const textOf = (xml: string) =>
  [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");

export type GoldenMaps = {
  /** fill hex -> the block style the spec knows it by */
  blockOfFill: Record<string, string>;
  /** run colour hex -> language variant id */
  variantOfColour: Record<string, string>;
  /** media file name -> the image role the spec sizes it by */
  roleOfMedia: Record<string, string>;
  /*
   * declared height in cm -> the image role, for documents where the file name
   * does not say.
   *
   * A ROLE IS AUTHORED, NOT INFERRED, and the two document types prove it. The
   * teacher sheet's three roles happen to be told apart by shape — a band is
   * wide, an opening scene is taller, a pictogram is tiny. The pupil tool has
   * seven distinct heights and FIVE OF THEM ARE SQUARE, so nothing about the
   * picture itself says which is a 4.99 cm answer and which a 0.46 cm sign.
   * The reader has only the size the file declares; the authoring layer, which
   * would simply know, is not in this loop.
   */
  roleOfHeightCm?: Record<string, string>;
  /** a line whose text starts with this is a bullet, and names that style */
  bulletMarker?: { marker: string; style: string };
  /*
   * run size in half-points -> the block style that declares it.
   *
   * Symmetric with blockOfFill: the file says a line is set large, the reader
   * recognises which style that is, and the spec supplies the size again on the
   * way out. The round trip looks circular and is not — it is the same trip a
   * fill makes, and it is how a produced document gets read back into terms the
   * formatter understands. Recognising is the reader's job precisely because
   * the authoring layer, which knows, is not in the loop here.
   */
  styleOfSize?: Record<string, string>;
};

export function readGolden(bytes: Buffer, maps: GoldenMaps): DocumentModel {
  const parts = unzip(bytes);
  const doc = parts.get("word/document.xml")!.toString("utf8");
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(doc)![1];
  const rels = parts.get("word/_rels/document.xml.rels")!.toString("utf8");

  const targetOfRel = new Map<string, string>();
  for (const m of rels.matchAll(/Id="([^"]+)"[^>]*Target="media\/([^"]+)"/g)) {
    targetOfRel.set(m[1], m[2]);
  }

  const media: DocumentModel["media"] = [];
  const seen = new Set<string>();

  function collect(name: string) {
    if (seen.has(name)) return;
    const data = parts.get(`word/media/${name}`);
    if (!data) return;
    seen.add(name);
    media.push({ name, data });
  }

  function paragraph(xml: string): Block | null {
    // A paragraph with neither text nor picture is either a page break or
    // furniture. Telling them apart matters: read as furniture, a break is
    // silently lost, which is exactly what happened to the pupil tool.
    if (!textOf(xml).trim() && !xml.includes("<wp:extent ")) {
      if (xml.includes('w:type="page"')) return null;   // handled by the caller
      const sz = Number(/<w:sz w:val="(\d+)"\/>/.exec(xml)?.[1] ?? 2);
      const line = Number(/w:line="(\d+)"/.exec(xml)?.[1] ?? 40);
      return { kind: "spacer", sizePt: sz / 2, leadingPt: line / 20 };
    }

    const colour = (/<w:color w:val="([0-9A-Fa-f]{6})"\/>/.exec(xml)?.[1] ?? "000000").toUpperCase();

    /*
     * Runs are read ONE AT A TIME rather than as a paragraph's worth of text.
     *
     * A line is not one style. The pupil tool's header sets "Unité 1 · Leçon 1"
     * at 12 pt and the lesson title at 16 pt in the same paragraph, and reading
     * the paragraph's first size lost the title. The teacher sheets do the same
     * thing with the odd bolded word.
     */
    const runs: Run[] = [];
    for (const r of xml.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)) {
      const drawing = /<wp:(inline|anchor)\b[\s\S]*?<wp:extent cx="(\d+)" cy="(\d+)"\/>[\s\S]*?r:embed="([^"]+)"/
        .exec(r[0]);
      if (drawing) {
        const name = targetOfRel.get(drawing[4]);
        if (!name) continue;
        collect(name);
        const w = Number(drawing[2]) / EMU_PER_CM, h = Number(drawing[3]) / EMU_PER_CM;
        runs.push({
          image: {
            media: name,
            role: maps.roleOfMedia[name] ?? maps.roleOfHeightCm?.[h.toFixed(2)] ?? "notion",
            aspectRatio: w / h, float: drawing[1] === "anchor",
          },
        });
        continue;
      }
      const runText = textOf(r[0]);
      if (!runText) continue;
      const size = /<w:sz w:val="(\d+)"\/>/.exec(r[0])?.[1];
      runs.push({ text: runText, style: size ? maps.styleOfSize?.[size] : undefined });
    }

    // The bullet is a STYLE the renderer re-adds, not part of the words. It can
    // only sit at the head of the line, so only the first text run is examined.
    let style: string | undefined;
    const bullet = maps.bulletMarker;
    const first = runs.find((r) => "text" in r) as { text: string } | undefined;
    if (bullet && first?.text.trimStart().startsWith(bullet.marker)) {
      first.text = first.text.trimStart().slice(bullet.marker.length).trimStart();
      style = bullet.style;
      if (!first.text) runs.splice(runs.indexOf(first as Run), 1);
    }

    return { kind: "line", variant: maps.variantOfColour[colour] ?? "commun", style, runs };
  }

  function table(xml: string): Extract<Block, { kind: "table" }> {
    const rows: Cell[][] = rowsOf(xml).map((row) =>
      cellsOf(row).map((tc) => {
        const fill = /w:fill="([0-9A-Fa-f]{6})"/.exec(tc)?.[1];
        const span = Number(/<w:gridSpan w:val="(\d+)"\/>/.exec(tc)?.[1] ?? 1);
        return {
          blocks: blocksIn(cellBody(tc)),
          style: fill ? maps.blockOfFill[fill.toUpperCase()] ?? `fill_${fill}` : undefined,
          span,
        };
      }),
    );
    const columnsCm = [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)]
      .map((m) => Number(m[1]) / 566.929);
    return { kind: "table", rows, columnsCm };
  }

  function blocksIn(xml: string): Block[] {
    const out: Block[] = [];
    let breakPending = false;
    for (const el of topLevel(xml)) {
      if (el.tag === "tbl") {
        const t = table(el.xml);
        if (breakPending) { t.pageBreak = "before"; breakPending = false; }
        out.push(t);
        continue;
      }

      // Either carrier reaches the model the same way: the NEXT block starts a
      // page. How it is written back is the formatter's business, not the file's.
      if (el.xml.includes('w:type="page"') || el.xml.includes("<w:pageBreakBefore/>")) {
        breakPending = true;
      }
      const block = paragraph(el.xml);
      if (!block) continue;
      // A spacer cannot start a page, so the break waits for the next real
      // block rather than being dropped on furniture.
      if (breakPending && block.kind !== "spacer") {
        block.pageBreak = "before";
        breakPending = false;
      }
      out.push(block);
    }
    return out;
  }

  return { blocks: blocksIn(body), media };
}
