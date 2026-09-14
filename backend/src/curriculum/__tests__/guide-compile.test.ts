/*
 * The guide compiler (curriculum/guide-compile.ts) on an INVENTED grammar.
 *
 * Deliberately not the CI-maths one: the compiler must know no prefix, no
 * phrase number and no marker glyph of any subject, and a test written on the
 * real grammar could not tell. Here the voices are « M : » and « É : », a
 * phrase is called as <R-12>, a picture as (photo : name), an inline asset as
 * {{name}}. If the CI-maths grammar works and this one does too, the code
 * reads the declaration and not the subject.
 */
import { describe, it, expect } from "vitest";
import { compileGuide, type GuideCompileInput } from "../guide-compile.js";
import type { GuideGrammar } from "../../kg-recipes/index.js";
import type { SectionPicture } from "../documents.js";
import type { MediaRef } from "../compose-types.js";

const GRAMMAR: GuideGrammar = {
  line: { pattern: "^(?<prefix>[A-ZÉ]) : (?<text>.*)$", style: "ligne" },
  prefixes: { M: { variant: "maitre" }, É: { variant: "eleves" } },
  call: {
    pattern: "<(?<id>R-\\d+)(?<args>[^>]*)>",
    phrases: {
      "R-12": "Le maître fait relire la phrase {{picto-lecture}}.",
      // The marker slot sits inside the inline syntax, so the pastille is set in line.
      "R-20": "Montrez le repère {{⟨repere⟩}} puis dites ⟨mot⟩.",
    },
    markerSlot: "repere",
  },
  inline: {
    pattern: "\\{\\{(?<name>[a-z-]+)\\}\\}",
    assets: {
      "picto-lecture": { relPath: "assets/picto-lecture.svg", role: "picto" },
      "rep-a": { relPath: "assets/rep-a.svg", role: "marqueur" },
      "rep-b": { relPath: "assets/rep-b.svg", role: "marqueur" },
    },
  },
  image: { pattern: "^(?<marker>[AB])?\\s*\\(photo : (?<name>[^)]+)\\)$", roles: [{ match: "^portrait-", role: "portrait" }], defaultRole: "photo", mark: "answer" },
  markers: { A: "rep-a", B: "rep-b" },
  trailing: { pattern: "\\s(?<tail>\\[[^\\[\\]]+\\])$", style: "reponse", translate: false, prefixes: ["M"] },
};

const picture = (name: string, answer?: boolean): SectionPicture => ({
  id: `pic-${name}`, name, description: "", uri: `gs://b/${name}.png`, relPath: `${name}.png`, contentType: "image/png", illustrates: "act",
  ...(answer ? { answerMark: { cells: [2], of: 3 } } : {}),
});

// Every attached picture is 4:1, every asset is square — enough to see the ratio travel.
const ratioOf = async (ref: MediaRef): Promise<number | null> => ("relPath" in ref ? 1 : 4);

const compile = (guide: string, extra: Partial<GuideCompileInput> = {}) =>
  compileGuide({ guide, grammar: GRAMMAR, sectionId: "sec", sectionTitle: "Jour 2", pictures: [picture("semaine3-jour2"), picture("portrait-awa", true)], vars: {}, ratioOf, media: new Map(), ...extra });

const textOf = (block: any): string => block.runs.map((r: any) => r.text ?? "").join("");

describe("the guide compiler, on a grammar it has never seen", () => {
  it("prints the prefixed lines in their voice and keeps the rest in the guide", async () => {
    const { blocks, report } = await compile("M : Regardez la photo.\nOn attend une phrase complète.\nÉ : Elle lit.\n\nNOTE : rien de plus.");
    expect(blocks.map(textOf)).toEqual(["Regardez la photo.", "Elle lit."]);
    expect(blocks.map((b: any) => b.variant)).toEqual(["maitre", "eleves"]);
    expect(blocks.every((b: any) => b.style === "ligne" && b.anchor === "sec")).toBe(true);
    expect(report).toMatchObject({ printed: 2, kept: 2, images: 0, unresolved: [] });
  });

  it("floats a picture on the block's first printed line, with the marker as its pastille", async () => {
    const { blocks, report } = await compile("A (photo : semaine3-jour2)\nM : Que fait la fille ?\nÉ : Elle lit.");
    const [first, second] = blocks as any[];
    // The floated picture anchors at the head of the line, then the pastille, then the words.
    expect(first.runs[0]).toEqual({ image: { media: "semaine3-jour2", role: "photo", aspectRatio: 4, float: true } });
    expect(first.runs[1]).toEqual({ image: { media: "rep-a.svg", role: "marqueur", aspectRatio: 1 } });
    expect(first.runs[2]).toEqual({ text: "Que fait la fille ?" });
    expect(second.runs).toEqual([{ text: "Elle lit." }]);
    expect(report.images).toBe(1);
  });

  it("does not float a picture wider than the threshold, and marks the teacher's copy only where a key is recorded", async () => {
    const media = new Map<string, MediaRef>();
    const { blocks } = await compile("(photo : portrait-awa)\nM : Voici Awa.\n(photo : semaine3-jour2)\nM : Et la classe.", { media, floatUnlessRatioAbove: 3 });
    const runs = (blocks as any[]).map((b) => b.runs[0].image);
    expect(runs[0]).toMatchObject({ media: "portrait-awa-answer", role: "portrait", float: false });
    expect(runs[1]).toMatchObject({ media: "semaine3-jour2", float: false });
    expect(media.get("portrait-awa-answer")).toEqual({ name: "portrait-awa-answer", nodeId: "pic-portrait-awa", mark: "answer" });
    expect(media.get("semaine3-jour2")).toEqual({ name: "semaine3-jour2", nodeId: "pic-semaine3-jour2" });
  });

  it("gives a picture no printed line follows a line of its own", async () => {
    const { blocks } = await compile("(photo : semaine3-jour2)\nCommentaire sans préfixe.");
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as any).runs).toEqual([{ image: { media: "semaine3-jour2", role: "photo", aspectRatio: 4, float: true } }]);
  });

  it("replaces a call by the repertoire's phrase, its slots filled from the template, the marker and the argument", async () => {
    const grammar: GuideGrammar = { ...GRAMMAR, call: { ...GRAMMAR.call!, phrases: { ...GRAMMAR.call!.phrases, "R-30": "Lisez ⟨mot⟩ à voix ⟨ton⟩." } } };
    const { blocks, report } = await compile("M : <R-12>\nB (photo : semaine3-jour2)\nM : <R-20 B>\nM : <R-30 haute>", { grammar, vars: { mot: "doucement" } });
    // R-12 carries an inline pictogram, set as a run.
    expect((blocks[0] as any).runs).toEqual([{ text: "Le maître fait relire la phrase " }, { image: { media: "picto-lecture.svg", role: "picto", aspectRatio: 1 } }, { text: "." }]);
    // R-20 B: the marker fills ⟨repere⟩ as the pastille asset, the template's var fills ⟨mot⟩ —
    // and the block's own marker is NOT doubled, since the phrase already set it.
    const second = blocks[1] as any;
    expect(second.runs.filter((r: any) => r.image?.media === "rep-b.svg")).toHaveLength(1);
    expect(textOf(second)).toBe("Montrez le repère  puis dites doucement.");
    // R-30 haute: the var fills ⟨mot⟩ by name, the free argument the slot still open.
    expect(textOf(blocks[2])).toBe("Lisez doucement à voix haute.");
    expect(report.unresolved).toEqual([]);
  });

  it("reports what it cannot resolve, line by line, and invents nothing", async () => {
    const { blocks, report } = await compile("X : une voix inconnue\nM : <R-99>\nM : <R-20>\n(photo : introuvable)\nM : {{picto-absent}} suite");
    // A call with a slot nothing fills does not print half-made; the line with the unknown asset prints without it.
    expect(blocks.map(textOf)).toEqual([" suite"]);
    expect(report.unresolved.map((u) => u.reason)).toEqual([
      "unknown prefix 'X'",
      "no phrase 'R-99' in the repertoire",
      "slot ⟨repere⟩ of R-20 is not filled",
      "slot ⟨mot⟩ of R-20 is not filled",
      "no attached picture named 'introuvable' (attached: semaine3-jour2, portrait-awa)",
      "no inline asset named 'picto-absent' in the grammar",
    ]);
  });

  it("splits the answer off the end of a speech line, in its own style and never translated", async () => {
    const { blocks } = await compile("M : Qui lit ? [Awa]\nÉ : Awa. [pas un repère]");
    expect((blocks[0] as any).runs).toEqual([{ text: "Qui lit ? " }, { text: "[Awa]", style: "reponse", translate: false }]);
    // The trailing rule names the voices it applies to: the pupils' line keeps its brackets.
    expect((blocks[1] as any).runs).toEqual([{ text: "Awa. [pas un repère]" }]);
  });
});
