/*
 * Compile a section's assembly guide into page blocks — the guide grammar,
 * applied by the server instead of re-read by a model.
 *
 * A guide of the CI-maths teacher sheet is not free prose: every line is
 * either a printed line with a prefix that names its voice, a marker that
 * opens a picture block, a call to a phrase of the repertoire, or
 * specification that never prints. That grammar was written down in the
 * formatter's prose and applied by hand on every production — a hundred
 * block operations per sheet, re-decided each time, and the largest share of
 * what a sheet still cost (fourth Leçon 25 diagnosis, 2026-09-14).
 *
 * The code here knows THREE motifs and one convention, and not one word of
 * any subject's grammar: a line matching the formatter's `line` pattern
 * prints in the voice its prefix maps to; a line matching the `image` pattern
 * opens a block whose picture floats on the block's first printed line, with
 * the marker it carries set as a pastille; a call matching the `call` pattern
 * is replaced by the phrase the formatter's repertoire holds, its slots
 * filled from the template's variables and the call's argument; anything
 * else stays in the guide. Every pattern, prefix, phrase, asset and marker is
 * data on the formatter (`layout.guide`, kg-recipes/layout-spec.ts), so a
 * second subject declares its own grammar and this file is untouched — the
 * tests run it on an invented grammar for that reason.
 *
 * What it cannot resolve it reports, line by line, and never invents: a
 * picture no attached Material carries, a phrase the repertoire lacks, a
 * slot nothing fills, a prefix the formatter does not know.
 */
import type { Block, Run } from "../render/index.js";
import type { GuideGrammar } from "../kg-recipes/index.js";
import type { SectionPicture } from "./documents.js";
import type { MediaRef, RatioOf } from "./compose-types.js";

export type GuideCompileInput = {
  guide: string;
  grammar: GuideGrammar;
  sectionId: string;
  sectionTitle: string;
  /** The pictures a marker may name — attached to what the section, or the page it sits on, covers. */
  pictures: SectionPicture[];
  /** Values the template supplies for phrase slots (the phase's pictogram, say), by slot name. */
  vars: Record<string, string>;
  ratioOf: RatioOf;
  /** The page's media list, shared with the template filler, keyed by media name. */
  media: Map<string, MediaRef>;
  /** A picture wider than this does not float; undefined floats everything the grammar marks. */
  floatUnlessRatioAbove?: number;
};

/** What the compiler did with one section, so the caller can say it rather than count. */
export type GuideCompileReport = {
  sectionId: string;
  title: string;
  printed: number;
  kept: number;
  images: number;
  unresolved: { line: string; reason: string }[];
};

type PendingImage = { ref: MediaRef; ratio: number; role: string; float: boolean };

/** A default slot spelling — French angle quotes — for a repertoire that names none. */
const DEFAULT_SLOT_PATTERN = "⟨(?<name>[^⟩]+)⟩";

const basename = (relPath: string): string => relPath.split("/").pop() ?? relPath;
const excerpt = (line: string): string => (line.length > 90 ? `${line.slice(0, 87)}…` : line);

export async function compileGuide(input: GuideCompileInput): Promise<{ blocks: Block[]; report: GuideCompileReport }> {
  const { grammar, sectionId } = input;
  const blocks: Block[] = [];
  const report: GuideCompileReport = { sectionId, title: input.sectionTitle, printed: 0, kept: 0, images: 0, unresolved: [] };
  const unresolved = (line: string, reason: string) => { report.unresolved.push({ line: excerpt(line), reason }); };

  const linePattern = new RegExp(grammar.line.pattern, "u");
  const imagePattern = grammar.image ? new RegExp(grammar.image.pattern, "u") : null;

  // The block being built: the picture that floats on its first printed line,
  // and the marker that becomes that line's pastille.
  let pendingImage: PendingImage | undefined;
  let pendingMarker: string | undefined;

  const imageRun = (pending: PendingImage): Run =>
    ({ image: { media: pending.ref.name, role: pending.role, aspectRatio: pending.ratio, float: pending.float } });

  /** An inline asset (a pictogram, a pastille) as a run, or null when the grammar or the file does not know it. */
  const inlineRun = async (assetName: string, line: string): Promise<Run | null> => {
    const asset = grammar.inline?.assets[assetName];
    if (!asset) { unresolved(line, `no inline asset named '${assetName}' in the grammar`); return null; }
    const ref: MediaRef = { name: basename(asset.relPath), relPath: asset.relPath };
    const ratio = await input.ratioOf(ref);
    if (ratio === null) { unresolved(line, `the file behind '${assetName}' cannot be read for its shape`); return null; }
    input.media.set(ref.name, ref);
    return { image: { media: ref.name, role: asset.role, aspectRatio: ratio } };
  };

  /** A block that had a picture but no printed line still shows its picture, on a line of its own. */
  const flushImageAlone = () => {
    if (!pendingImage) return;
    blocks.push({ kind: "line", runs: [imageRun(pendingImage)], anchor: sectionId, ...(grammar.line.style ? { style: grammar.line.style } : {}) });
    pendingImage = undefined;
  };

  const roleFor = (name: string): string => {
    const rule = grammar.image?.roles?.find((r) => new RegExp(r.match, "u").test(name));
    return rule?.role ?? grammar.image?.defaultRole ?? "picture";
  };

  const markerAsset = (marker: string | undefined): string | undefined =>
    marker ? grammar.markers?.[marker] : undefined;

  /**
   * A phrase call replaced by its repertoire text, slots filled; null when
   * the line cannot print — a phrase the repertoire lacks, or a slot nothing
   * fills. Such a line is a guide defect (« un appel sans son exemple »), and
   * a defect is reported to be fixed in the guide, never printed half-made.
   */
  const expandCalls = (text: string, line: string): string | null => {
    if (!grammar.call) return text;
    const call = grammar.call;
    const slotPattern = new RegExp(call.slot ?? DEFAULT_SLOT_PATTERN, "gu");
    let printable = true;
    const expanded = text.replace(new RegExp(call.pattern, "gu"), (...match: unknown[]) => {
      const groups = (match[match.length - 1] ?? {}) as Record<string, string | undefined>;
      const id = groups.id ?? "";
      const phrase = call.phrases[id];
      if (phrase === undefined) { unresolved(line, `no phrase '${id}' in the repertoire`); printable = false; return ""; }
      const filled = fillSlots(phrase, (groups.args ?? "").trim(), id, slotPattern, line);
      if (filled === null) printable = false;
      return filled ?? "";
    });
    return printable ? expanded : null;
  };

  /*
   * Slots fill from three sources, in this order: the template's variables by
   * name; a marker argument into the marker slot, as the NAME of the asset its
   * pastille is — a repertoire that wants the pastille set in line wraps that
   * slot in its own inline syntax (`{img:⟨repère⟩}`); any other argument into
   * the first slot still open. A slot left open makes the line unprintable.
   */
  const fillSlots = (phrase: string, args: string, id: string, slotPattern: RegExp, line: string): string | null => {
    const markerSlot = grammar.call?.markerSlot;
    const markerValue = markerAsset(args);
    let freeArgument: string | undefined = markerValue === undefined && args.length > 0 ? args : undefined;
    let sawMarkerSlot = false;
    let complete = true;
    const filled = phrase.replace(slotPattern, (...match: unknown[]) => {
      const name = ((match[match.length - 1] ?? {}) as Record<string, string | undefined>).name ?? "";
      if (input.vars[name] !== undefined) return input.vars[name];
      if (markerValue !== undefined && name === markerSlot) { sawMarkerSlot = true; return markerValue; }
      if (freeArgument !== undefined) { const value = freeArgument; freeArgument = undefined; return value; }
      unresolved(line, `slot ⟨${name}⟩ of ${id} is not filled`);
      complete = false;
      return "";
    });
    if (markerValue !== undefined && !sawMarkerSlot) unresolved(line, `${id} has no slot for the marker '${args}'`);
    if (freeArgument !== undefined) unresolved(line, `${id} has no slot for '${freeArgument}'`);
    return complete ? filled.replace(/\s{2,}/g, " ").trim() : null;
  };

  /** Text with inline asset tokens becomes text runs and image runs, in order; the trailing rule splits the answer off a speech line. */
  const runsOf = async (text: string, prefix: string, line: string): Promise<Run[]> => {
    const runs: Run[] = [];
    if (grammar.inline) {
      const inlinePattern = new RegExp(grammar.inline.pattern, "gu");
      let last = 0;
      for (const match of text.matchAll(inlinePattern)) {
        const before = text.slice(last, match.index);
        if (before) runs.push({ text: before });
        const run = await inlineRun((match.groups?.name ?? "").trim(), line);
        if (run) runs.push(run);
        last = (match.index ?? 0) + match[0].length;
      }
      const rest = text.slice(last);
      if (rest) runs.push({ text: rest });
    } else if (text) {
      runs.push({ text });
    }
    const trailing = grammar.trailing;
    const appliesTo = !trailing?.prefixes || trailing.prefixes.includes(prefix);
    const lastRun = runs[runs.length - 1];
    if (trailing && appliesTo && lastRun && "text" in lastRun) {
      const match = new RegExp(trailing.pattern, "u").exec(lastRun.text);
      const tail = match?.groups?.tail ?? match?.[1];
      if (match && tail) {
        const head = lastRun.text.slice(0, match.index).replace(/\s+$/, "");
        runs.pop();
        if (head) runs.push({ text: `${head} ` });
        runs.push({ text: tail, ...(trailing.style ? { style: trailing.style } : {}), ...(trailing.translate === false ? { translate: false as const } : {}) });
      }
    }
    return runs;
  };

  for (const rawLine of input.guide.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const imageMatch = imagePattern?.exec(line);
    if (imageMatch?.groups) {
      flushImageAlone();
      const name = (imageMatch.groups.name ?? "").trim();
      pendingMarker = markerAsset(imageMatch.groups.marker?.trim() || undefined);
      const picture = input.pictures.find((p) => p.name === name);
      if (!picture) {
        unresolved(line, `no attached picture named '${name}' (attached: ${input.pictures.map((p) => p.name).join(", ") || "none"})`);
        continue;
      }
      // The teacher's copy is asked for by the grammar and drawn only where
      // the picture records its correct cell; a band with no key stays plain.
      const mark = grammar.image?.mark && picture.answerMark ? grammar.image.mark : undefined;
      const ref: MediaRef = mark ? { name: `${picture.name}-${mark}`, nodeId: picture.id, mark } : { name: picture.name, nodeId: picture.id };
      const ratio = await input.ratioOf(ref);
      if (ratio === null) { unresolved(line, `the file behind '${picture.name}' cannot be read for its shape`); continue; }
      input.media.set(ref.name, ref);
      const float = input.floatUnlessRatioAbove === undefined ? true : ratio <= input.floatUnlessRatioAbove;
      pendingImage = { ref, ratio, role: roleFor(name), float };
      report.images += 1;
      continue;
    }

    const lineMatch = linePattern.exec(line);
    if (!lineMatch?.groups) { report.kept += 1; continue; }
    const prefix = (lineMatch.groups.prefix ?? "").trim();
    const voice = grammar.prefixes[prefix];
    if (!voice) { unresolved(line, `unknown prefix '${prefix}'`); continue; }

    const expanded = expandCalls((lineMatch.groups.text ?? "").trim(), line);
    if (expanded === null) continue;
    const runs = await runsOf(expanded, prefix, line);

    // The pastille opens the block's first printed line — unless the phrase
    // that line calls already set it (« une seule pastille par activité »).
    if (pendingMarker) {
      const already = runs.some((run) => "image" in run && run.image.media === basename(grammar.inline?.assets[pendingMarker!]?.relPath ?? pendingMarker!));
      if (!already) { const pastille = await inlineRun(pendingMarker, line); if (pastille) runs.unshift(pastille); }
      pendingMarker = undefined;
    }
    if (pendingImage) { runs.unshift(imageRun(pendingImage)); pendingImage = undefined; }
    if (runs.length === 0) continue;

    blocks.push({
      kind: "line", runs, anchor: sectionId,
      ...(grammar.line.style ? { style: grammar.line.style } : {}),
      ...(voice.variant ? { variant: voice.variant } : {}),
    });
    report.printed += 1;
  }
  flushImageAlone();
  return { blocks, report };
}
