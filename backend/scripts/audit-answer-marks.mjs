#!/usr/bin/env node
/*
 * Recompute every band's answer record from what can be READ, not assumed.
 *
 * For each attached picture whose activity states a RÉPONSE sign, this reads
 * the band file for its cells (white gutters → count), maps the sign to a
 * cell by the band's own layout — X · O · – left to right, after a reference
 * cell when the band has one, i.e. when it shows one more cell than signs —
 * and writes an edit_nodes batch of `metadata.answerMark: {cells, of}`. A
 * band it cannot read, or whose sign it cannot place, goes to the report
 * instead of the batch: a guess is exactly what this replaces.
 *
 * The fourteen records of Leçons 24 and 25 were written by hand from the
 * assumption that every band has a reference cell; four had none.
 *
 * Usage: node scripts/audit-answer-marks.mjs <live-export.json> <bands dir> [--out batch.json] [--lesson 25]
 *   <bands dir> holds the band files as downloaded (create_download_url with
 *   relPaths), named by the picture's file name (the last path segment).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { detectBandCells } from "../dist/render/index.js";

const args = process.argv.slice(2);
const [exportPath, bandsDir] = args.filter((a) => !a.startsWith("--"));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!exportPath || !bandsDir) { console.error("usage: audit-answer-marks.mjs <live-export.json> <bands dir> [--out batch.json] [--lesson N]"); process.exit(1); }
const outPath = opt("--out");
const onlyLesson = opt("--lesson") ? Number(opt("--lesson")) : null;

const graph = JSON.parse(readFileSync(resolve(exportPath), "utf8"));
const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
const parentOf = new Map(graph.relationships.filter((e) => e.type === "hasPart").map((e) => [e.end, e.start]));
const SIGNS = ["X", "O", "–"];
const signOf = (content) => { const m = /^\s*RÉPONSES?\s*:\s*(?:le signe\s*)?([XO–-])\s*\.?/mu.exec(content ?? ""); return m ? (m[1] === "-" ? "–" : m[1]) : null; };

const items = [], report = [];
for (const node of graph.nodes) {
  if (!(node.labels ?? []).includes("Material")) continue;
  const p = node.properties ?? {};
  const name = String(p.name ?? "");
  const m = /^L(\d\d)-(nf|tf)-\d$/.exec(name);
  if (!m) continue;
  if (onlyLesson !== null && Number(m[1]) !== onlyLesson) continue;
  const activity = nodes.get(parentOf.get(node.id));
  const sign = signOf(activity?.properties?.content);
  const file = join(resolve(bandsDir), basename(String(p.identifier ?? "")));
  const row = { name, id: node.id, sign, recorded: p.metadata?.answerMark ?? null };
  if (!sign) { report.push({ ...row, problem: "the activity states no RÉPONSE sign" }); continue; }
  if (!existsSync(file)) { report.push({ ...row, problem: `no file at ${file}` }); continue; }
  const seen = detectBandCells(readFileSync(file));
  if (!seen) { report.push({ ...row, problem: "the picture is not a row of vignettes with white gutters — read it by eye" }); continue; }
  const reference = seen.count - SIGNS.length;   // 0 = no reference cell, 1 = one on the left
  if (reference < 0 || reference > 1) { report.push({ ...row, problem: `the band shows ${seen.count} cells, which is neither 3 signed nor a reference + 3 — read it by eye` }); continue; }
  const cell = reference + SIGNS.indexOf(sign) + 1;
  const mark = { cells: [cell], of: seen.count };
  const same = row.recorded && JSON.stringify(row.recorded) === JSON.stringify(mark);
  row.derived = mark; row.changed = !same;
  report.push(row);
  if (!same) items.push({ nodeId: node.id, properties: { "metadata.answerMark": mark } });
}

const changed = report.filter((r) => r.changed).length, problems = report.filter((r) => r.problem).length;
console.log(`${report.length} band(s) examined: ${changed} record(s) to write, ${problems} to read by eye.`);
for (const r of report) console.log(`  ${r.name.padEnd(10)} signe ${r.sign ?? "?"}  ${r.problem ? "!! " + r.problem : `→ cell ${r.derived.cells[0]} of ${r.derived.of}${r.changed ? (r.recorded ? `  (was ${JSON.stringify(r.recorded)})` : "  (new)") : "  (unchanged)"}`}`);
if (outPath) { writeFileSync(resolve(outPath), JSON.stringify({ items }, null, 1)); console.log(`batch written to ${outPath} (${items.length} items) — send through edit_nodes, review the diff, confirm, publish.`); }
else console.log("dry run — pass --out to write the edit_nodes batch.");
