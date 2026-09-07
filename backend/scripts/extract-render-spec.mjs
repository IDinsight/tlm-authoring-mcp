#!/usr/bin/env node
/*
 * Read a `.docx`'s geometry and print a candidate `render` bag.
 *
 * WHAT THIS IS FOR: bootstrapping a subject whose sheets exist but whose
 * formatter carries no geometry, so `render_document` refuses. CE1 reading is
 * the live case — eighteen formatters on its teacher guide, not one `render`
 * bag. The CI-maths bag was transcribed BY HAND out of the producer's build.py,
 * which is a day's careful work and one misread style away from being wrong.
 *
 * WHAT IT WILL NOT DO. It prints what the files SHOW and never invents a name.
 * A fill is `2EAEE5` in the XML and nothing more; only you know it is the week
 * banner. So fills and picture heights come out as a NAMING TODO, and the half
 * of the spec that is a decision rather than a measurement — the page budget,
 * which prefixes print, what gives on overflow, which colour means which
 * language — comes out as a note. Nothing is written to the graph: paste the
 * bag into `edit_nodes` once you have named things and decided the rest.
 *
 * MEASURE SEVERAL SHEETS, NOT ONE. Pass every sheet a formatter governs. A
 * value that differs between them is not a formatter value — it is that sheet's
 * own — and the script says which fields disagreed rather than picking one.
 *
 * Usage (from backend/):
 *   npm run extract:render-spec -- <sheet.docx> [more.docx ...]
 *   npm run extract:render-spec -- "path/to/Outputs"/lecon_*\/*-FR.docx
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { readGeometry } from "../dist/render/read-geometry.js";

const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (files.length === 0) {
  console.error("usage: npm run extract:render-spec -- <sheet.docx> [more.docx ...]");
  console.error("       Pass every sheet the formatter governs, not just one.");
  process.exit(2);
}

/** Every leaf path of an object, as "a.b.c" -> value, for cross-file compare. */
function flatten(value, prefix = "", out = new Map()) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix, JSON.stringify(value));
  }
  return out;
}

const read = [];
for (const file of files) {
  try {
    read.push({ file, ...readGeometry(readFileSync(file)) });
  } catch (err) {
    console.error(`SKIPPED ${basename(file)} — ${err instanceof Error ? err.message : String(err)}`);
  }
}
if (read.length === 0) process.exit(1);

// ---- agree / disagree across the sheets ---------------------------------
// A field that differs between sheets is that SHEET's, not the formatter's.
const seen = new Map();   // field -> Map<serialisedValue, [files]>
for (const r of read) {
  for (const [field, value] of flatten(r.spec)) {
    const byValue = seen.get(field) ?? new Map();
    byValue.set(value, [...(byValue.get(value) ?? []), basename(r.file)]);
    seen.set(field, byValue);
  }
}

const agreed = {};
const disagreed = [];
for (const [field, byValue] of seen) {
  if (byValue.size === 1 && [...byValue.values()][0].length === read.length) {
    // Rebuild the nested shape from the dotted path.
    const parts = field.split(".");
    let node = agreed;
    for (const part of parts.slice(0, -1)) node = node[part] ??= {};
    node[parts.at(-1)] = JSON.parse([...byValue.keys()][0]);
  } else {
    disagreed.push({ field, byValue });
  }
}

const line = "-".repeat(72);
console.log(`\nRead ${read.length} sheet(s).\n${line}`);

console.log("\nCANDIDATE render BAG — the fields every sheet agrees on:\n");
console.log(JSON.stringify(agreed, null, 2));

if (disagreed.length > 0) {
  console.log(`\n${line}\nFIELDS THE SHEETS DISAGREE ON — omitted above.`);
  console.log("A value that varies between sheets belongs to the sheet, not the formatter.\n");
  for (const { field, byValue } of disagreed) {
    console.log(`  ${field}`);
    for (const [value, where] of byValue) {
      const shown = where.length > 3 ? `${where.slice(0, 3).join(", ")} +${where.length - 3} more` : where.join(", ");
      console.log(`      ${value.padEnd(14)} ${shown}`);
    }
  }
}

// ---- the naming TODO ----------------------------------------------------
// Union across sheets: one sheet may simply not use a banner the others do.
const fills = new Map();
const heights = new Map();
for (const r of read) {
  for (const f of r.unnamed.fills) fills.set(f.hex, (fills.get(f.hex) ?? 0) + f.occurrences);
  for (const h of r.unnamed.imageHeightsCm) heights.set(h.heightCm, (heights.get(h.heightCm) ?? 0) + h.occurrences);
}

console.log(`\n${line}\nYOU MUST NAME THESE — the file shows them and cannot say what they are.\n`);
if (fills.size > 0) {
  console.log(`  ${fills.size} fill colour(s) -> \`blocks.<your name>.fill\``);
  for (const [hex, n] of [...fills].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${hex}   ${String(n).padStart(4)} use(s)`);
  }
}
if (heights.size > 0) {
  console.log(`\n  ${heights.size} picture height(s) -> \`images.maxHeightCm.<your role>\``);
  console.log("      Pick the CEILING per role: a scaled picture appears at its own height,");
  console.log("      so most of these are instances rather than limits.");
  for (const [cm, n] of [...heights].sort((a, b) => b[0] - a[0])) {
    console.log(`      ${String(cm).padStart(5)} cm ${String(n).padStart(4)} use(s)`);
  }
}

// ---- what no document can answer ---------------------------------------
const notes = [...new Set(read.flatMap((r) => r.notes))];
console.log(`\n${line}\nNOTES\n`);
notes.forEach((n, i) => console.log(`  ${i + 1}. ${n}\n`));

console.log(`${line}`);
console.log("NOTHING WAS WRITTEN. Name the fills and roles, decide the notes, then stage the");
console.log("bag with edit_nodes: properties: { render: { ... } } on the formatter that");
console.log("governs these sheets. It is validated again at authoring time.\n");
