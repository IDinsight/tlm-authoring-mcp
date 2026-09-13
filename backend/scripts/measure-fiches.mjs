#!/usr/bin/env node
/*
 * Measure delivered fiches — what production ACTUALLY applied — READ-ONLY.
 *
 * For each « Guide-Lecon-N-…-FR.docx » under a corpus directory: the page
 * count (the PDF beside it when there is one, else the file's own app.xml
 * count), the margins and type size, and every page-taking picture's width,
 * height, proportion and placement, with a role read off its shape (a band is
 * the wide one, a scene is squarer, anything under a line's height is a
 * pictogram). The summary is what `reference-geometry.test.ts` pins: the
 * formatter's declared image caps must stay within what these fiches applied,
 * because the caps are the sizes the renderer draws at, and the ten fiches of
 * Leçons 21 to 30 are the ones that fit two pages and were accepted.
 *
 * Usage: node scripts/measure-fiches.mjs <corpus dir> [--from 21] [--to 30] [--out reference.json]
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { unzip } from "../dist/render/index.js";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
if (!dir) { console.error("usage: measure-fiches.mjs <corpus dir> [--from N] [--to N] [--out file.json]"); process.exit(1); }
const from = Number(opt("--from", 1)), to = Number(opt("--to", 999)), outPath = opt("--out");

const EMU_PER_CM = 360000, TWIPS_PER_CM = 567;
const roleOf = (w, h) => (h <= 0.6 ? "picto" : w / h > 2.4 ? "bande" : "scene");
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
const round = (x) => Math.round(x * 100) / 100;

const fiches = [];
for (const entry of readdirSync(resolve(dir)).sort()) {
  const m = entry.match(/^lecon_(\d+)$/); if (!m) continue;
  const lesson = Number(m[1]); if (lesson < from || lesson > to) continue;
  const files = readdirSync(join(dir, entry));
  const docx = files.find((f) => /^Guide-Lecon-\d+-.*-FR\.docx$/.test(f)); if (!docx) continue;
  const parts = unzip(readFileSync(join(dir, entry, docx)));
  const xml = parts.get("word/document.xml").toString("utf8");
  const app = parts.get("docProps/app.xml")?.toString("utf8") ?? "";
  const pdf = files.find((f) => /^Guide-Lecon-\d+-.*-FR\.pdf$/.test(f));
  const pagesPdf = pdf ? (readFileSync(join(dir, entry, pdf)).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length : null;
  const pagesApp = Number(app.match(/<Pages>(\d+)<\/Pages>/)?.[1] ?? 0) || null;
  const mar = Object.fromEntries([...(xml.match(/<w:pgMar[^>]*\/>/)?.[0] ?? "").matchAll(/w:(top|bottom|left|right)="(\d+)"/g)].map((x) => [x[1], round(Number(x[2]) / TWIPS_PER_CM)]));
  // Body size: the commonest run size at or above 8 pt (pictogram spacer runs are set tiny).
  const sizes = [...xml.matchAll(/<w:sz w:val="(\d+)"/g)].map((x) => Number(x[1]) / 2).filter((pt) => pt >= 8);
  // Body runs usually carry no size of their own: it comes from the document defaults.
  const styles = parts.get("word/styles.xml")?.toString("utf8") ?? "";
  const normal = styles.match(/<w:style [^>]*w:styleId="Normal"[^>]*>([\s\S]*?)<\/w:style>/)?.[1] ?? "";
  const defaultPt = Number(normal.match(/<w:sz w:val="(\d+)"/)?.[1] ?? styles.match(/<w:docDefaults>[\s\S]*?<w:sz w:val="(\d+)"/)?.[1] ?? 0) / 2 || null;
  const sizePt = median(sizes) ?? defaultPt;
  const pictures = [];
  for (const d of xml.matchAll(/<w:drawing>([\s\S]*?)<\/w:drawing>/g)) {
    const ext = d[1].match(/<wp:extent cx="(\d+)" cy="(\d+)"/); if (!ext) continue;
    const w = Number(ext[1]) / EMU_PER_CM, h = Number(ext[2]) / EMU_PER_CM;
    pictures.push({ role: roleOf(w, h), w: round(w), h: round(h), ratio: round(w / h), float: d[1].includes("<wp:anchor") });
  }
  fiches.push({ lesson, pages: pagesPdf ?? pagesApp, pagesFrom: pagesPdf ? "pdf" : "app.xml", margins: mar, sizePt, pictures });
}
const byRole = {};
for (const f of fiches) for (const p of f.pictures) (byRole[p.role] ??= []).push(p);
const summary = Object.fromEntries(Object.entries(byRole).map(([role, ps]) => [role, {
  count: ps.length, heightMedian: median(ps.map((p) => p.h)), heightMax: Math.max(...ps.map((p) => p.h)), widthMedian: median(ps.map((p) => p.w)), widthMax: Math.max(...ps.map((p) => p.w)),
  ratioMedian: median(ps.map((p) => p.ratio)), ratioMax: Math.max(...ps.map((p) => p.ratio)), floated: ps.filter((p) => p.float).length,
}]));
const out = { corpus: `fiches ${from}–${to}`, measuredOn: new Date().toISOString().slice(0, 10), fiches: fiches.length, pages: fiches.map((f) => f.pages), margins: fiches[0]?.margins, sizePt: fiches[0]?.sizePt, pictures: summary, perFiche: fiches };
console.log(JSON.stringify({ ...out, perFiche: undefined }, null, 2));
if (outPath) { writeFileSync(resolve(outPath), JSON.stringify(out, null, 2) + "\n"); console.log(`written to ${outPath}`); }
