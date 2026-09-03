/*
 * Read a produced sheet back into the renderer's own model.
 *
 * This is the half that makes the spike honest: without it the comparison would
 * be the renderer marking its own homework. The model is recovered from the
 * GOLDEN file — banners from its tables, variants from its run colours, images
 * from its drawings — and then rendered again from scratch. Anything the
 * renderer gets wrong shows up as a difference against the file it came from.
 *
 * It doubles as a sketch of WP6a (reading a corrected document back in), which
 * is the same problem pointed the other way.
 */
import { unzip } from "./zip.js";
import type { Block, DocumentModel, Run } from "./renderer.js";

const EMU_PER_CM = 360000;

/** Top-level <w:tbl> and <w:p> children of <w:body>, in order. */
function topLevel(body: string): { tag: "tbl" | "p"; xml: string }[] {
  const out: { tag: "tbl" | "p"; xml: string }[] = [];
  const opener = /<w:(tbl|p)\b/g;
  let i = 0;
  for (;;) {
    opener.lastIndex = i;
    const m = opener.exec(body);
    if (!m) break;
    const tag = m[1] as "tbl" | "p";
    // Scan for the matching close, since a table contains paragraphs.
    const nested = new RegExp(`</?w:${tag}\\b`, "g");
    nested.lastIndex = m.index;
    let depth = 0, end = -1;
    for (;;) {
      const n = nested.exec(body);
      if (!n) break;
      depth += body.startsWith("</", n.index) ? -1 : 1;
      if (depth === 0) { end = n.index + `</w:${tag}>`.length; break; }
    }
    if (end < 0) break;
    out.push({ tag, xml: body.slice(m.index, end) });
    i = end;
  }
  return out;
}

const textOf = (xml: string) =>
  [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");

export type GoldenMaps = {
  /** fill hex -> the block name the spec knows it by */
  blockOfFill: Record<string, string>;
  /** run colour hex -> language variant id */
  variantOfColour: Record<string, string>;
  /** media file name -> the image role the spec sizes it by */
  roleOfMedia: Record<string, string>;
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
  const blocks: Block[] = [];

  for (const el of topLevel(body)) {
    if (el.tag === "tbl") {
      const rows = [...el.xml.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((tr) =>
        [...tr[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((tc) => {
          const fill = /w:fill="([0-9A-Fa-f]{6})"/.exec(tc[0])?.[1] ?? "auto";
          return { text: textOf(tc[0]), block: maps.blockOfFill[fill.toUpperCase()] ?? `fill_${fill}` };
        }),
      );
      blocks.push({ kind: "banner", rows, pageBreakBefore: el.xml.includes("<w:pageBreakBefore/>") });
      continue;
    }

    const text = textOf(el.xml).trim();
    const drawings = [...el.xml.matchAll(
      /<wp:(inline|anchor)\b[\s\S]*?<wp:extent cx="(\d+)" cy="(\d+)"\/>[\s\S]*?r:embed="([^"]+)"/g,
    )];

    // A paragraph with no text and no picture is furniture: reproduce its two
    // numbers, which the spec has no key for.
    if (!text && drawings.length === 0) {
      const sz = Number(/<w:sz w:val="(\d+)"\/>/.exec(el.xml)?.[1] ?? 2);
      const line = Number(/w:line="(\d+)"/.exec(el.xml)?.[1] ?? 40);
      blocks.push({ kind: "spacer", sizePt: sz / 2, leadingPt: line / 20 });
      continue;
    }

    const colour = (/<w:color w:val="([0-9A-Fa-f]{6})"\/>/.exec(el.xml)?.[1] ?? "000000").toUpperCase();
    const runs: Run[] = [];
    for (const d of drawings) {
      const name = targetOfRel.get(d[4]);
      if (!name) continue;
      if (!seen.has(name)) {
        seen.add(name);
        media.push({ name, data: parts.get(`word/media/${name}`)! });
      }
      const w = Number(d[2]) / EMU_PER_CM, h = Number(d[3]) / EMU_PER_CM;
      runs.push({
        image: {
          media: name, role: maps.roleOfMedia[name] ?? "notion",
          aspectRatio: w / h, float: d[1] === "anchor",
        },
      });
    }
    // The bullet marker is furniture the renderer re-adds; strip it here.
    if (text) runs.push({ text: text.replace(/^•\s*/, "") });

    blocks.push({ kind: "line", variant: maps.variantOfColour[colour] ?? "commun", runs });
  }

  return { blocks, media, bulletMarker: "• " };
}
