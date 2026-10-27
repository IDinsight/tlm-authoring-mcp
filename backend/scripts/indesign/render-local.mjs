#!/usr/bin/env node
/*
 * Run the InDesign renderer (render/idml.ts, from dist/) on a page on disk, with no server.
 *
 * What render_document format:"idml" does after it has fetched the template, the pictures and
 * the fonts from the bucket — the same functions, fed from local files — so a template or a
 * page can be checked in InDesign before anything is uploaded or deployed. `npm run build` first.
 *
 * Usage:
 *   node scripts/indesign/render-local.mjs <template.idml> <page.json> <pictures dir> <out.zip> [fonts dir]
 *
 * page.json: { "spec": <a render bag>, "styleGroup"?: "AN", "lang"?: "fr",
 *              "blocks": [...], "media": { "<name in the tree>": "<file in the pictures dir>" } }
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { readIdmlTemplate, renderIdml, packageIdml, rasterizeSvgMedia, IdmlRefusal } from "../../dist/render/index.js";

const [templatePath, pagePath, picturesDir, outPath, fontsDir] = process.argv.slice(2).map((p) => p && resolve(p));
if (!outPath) {
  console.error("usage: render-local.mjs <template.idml> <page.json> <pictures dir> <out.zip> [fonts dir]");
  process.exit(1);
}

const page = JSON.parse(readFileSync(pagePath, "utf8"));
const media = Object.entries(page.media).map(([name, file]) => ({ name, data: readFileSync(join(picturesDir, file)) }));
// The server rasterizes vector pictures before laying out; so does this.
const raster = rasterizeSvgMedia(media);
if (raster.refused.length > 0) {
  console.error("vector pictures refused:", raster.refused);
  process.exit(1);
}
const fonts = fontsDir && existsSync(fontsDir)
  ? readdirSync(fontsDir).filter((f) => /\.(ttf|otf)$/i.test(f)).map((f) => ({ fileName: f, data: readFileSync(join(fontsDir, f)) }))
  : [];

try {
  const template = readIdmlTemplate(readFileSync(templatePath));
  const output = renderIdml({ blocks: page.blocks, media: raster.media }, template, { spec: page.spec, styleGroup: page.styleGroup, lang: page.lang });
  const idmlName = basename(outPath).replace(/\.zip$/i, "") + ".idml";
  writeFileSync(outPath, packageIdml(idmlName, output, fonts));
  console.log(`wrote ${outPath}: ${idmlName}, ${output.links.length} pictures, ${fonts.length} fonts`);
} catch (error) {
  if (error instanceof IdmlRefusal) {
    console.error("refused:\n  " + error.problems.join("\n  "));
    process.exit(2);
  }
  throw error;
}
