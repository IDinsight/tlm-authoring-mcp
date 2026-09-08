/*
 * resolveBoilerplate — the repeated sentences a document calls by reference.
 *
 * The tests that matter here are the ones about what this module must NOT know.
 * ci/maths writes its sentence ids as "PT-01" and calls them with `{pt:…}`; a
 * second subject writing "R7" and `{phrase:…}` has to work identically, and a
 * subject using none of this has to come back silent rather than complaining.
 * Each of those is a test below, because each is a way the abstraction could be
 * one subject's convention wearing a generic name.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolveBoilerplate, type ProseSource } from "../boilerplate.js";

const prose = (nodeId: string, text: string): ProseSource => ({ nodeId, text });

// A repertoire in the live ci/maths shape: id, the phases it applies to, the
// wording in guillemets, then its default state.
const MATHS_REPERTOIRE = prose("fmt-repertoire", [
  "Format : NUMÉRO · phase(s) · « rédaction unique » · emplacements · statut.",
  "PT-01 · phase 2 · « E. écoute les réponses sans les corriger. » · — · imprimée.",
  "PT-04 · phases 4 et 7 · « E. dit de mettre le doigt sur le repère ⟨repère⟩. » · — · imprimée.",
  "PT-10 · phase 6 · « E. fait relire la règle à voix haute. » · — · déclassée.",
].join("\n"));

describe("resolving a document's repeated sentences", () => {
  it("takes the wording from the quotation marks on the definition line", () => {
    const table = resolveBoilerplate(
      [prose("sec-1", "Ouverture : {pt:PT-01}")],
      [MATHS_REPERTOIRE],
    );
    const entry = table.entries.find((candidate) => candidate.id === "PT-01");
    expect(entry?.text).toBe("E. écoute les réponses sans les corriger.");
    expect(entry?.referencedBy).toEqual(["sec-1"]);
    expect(entry?.definedIn).toBe("fmt-repertoire");
    // The fields this module refuses to parse apart stay available verbatim.
    expect(entry?.definition).toContain("· imprimée.");
  });

  /*
   * `{pt:PT-04 ▲}` and a bare `{pt:PT-04}` are the same sentence — the second
   * word fills the ⟨repère⟩ its wording leaves open. Read as two different ids
   * they would produce one resolved sentence and one phantom undefined one.
   */
  it("reads a call's argument as an argument, not as a different sentence", () => {
    const table = resolveBoilerplate(
      [prose("sec-4", "{pt:PT-04 ▲}"), prose("sec-7", "{pt:PT-04 ●}"), prose("sec-9", "{pt:PT-04}")],
      [MATHS_REPERTOIRE],
    );
    expect(table.entries.map((entry) => entry.id)).toEqual(["PT-04"]);
    expect(table.entries[0].arguments).toEqual(["▲", "●"]);
    expect(table.entries[0].referencedBy).toEqual(["sec-4", "sec-7", "sec-9"]);
    expect(table.entries[0].placeholders).toEqual(["⟨repère⟩"]);
    expect(table.problems.filter((problem) => problem.kind === "undefined-reference")).toEqual([]);
  });

  /*
   * The paragraph documenting the convention writes the syntax out. Reported as
   * undefined references, those findings land on the one paragraph that explains
   * the feature — and a check that cries wolf there gets ignored everywhere.
   */
  it("does not mistake the prose explaining the syntax for calls", () => {
    const table = resolveBoilerplate(
      [prose("fmt-howto", "Un appel s'écrit {pt:<numéro>}, une image {img:…}, un rôle {img:⟨pictogramme de la section⟩}.")],
      [prose("fmt-empty", "rien à définir ici")],
    );
    expect(table.problems).toEqual([]);
    expect(table.entries).toEqual([]);
    expect(table.templates).toEqual(["{img:…}", "{img:⟨pictogramme de la section⟩}", "{pt:<numéro>}"]);
  });

  it("reports a sentence that is called but never written down", () => {
    const table = resolveBoilerplate(
      [prose("sec-2", "{pt:PT-99}")],
      [prose("fmt-empty", "rien à définir ici")],
    );
    expect(table.problems).toHaveLength(1);
    expect(table.problems[0]).toMatchObject({ kind: "undefined-reference", id: "PT-99", where: ["sec-2"] });
    expect(table.problems[0].message).toContain("print in clear");
  });

  /*
   * Finding these is what forces the id shape to be DERIVED. Nothing references
   * PT-10, so it can only be recognised as a definition by matching the shape of
   * the ids that ARE referenced.
   */
  it("reports a sentence that is written down but never called", () => {
    const table = resolveBoilerplate(
      [prose("sec-1", "{pt:PT-01} puis {pt:PT-04}")],
      [MATHS_REPERTOIRE],
    );
    expect(table.problems.map((problem) => [problem.kind, problem.id]))
      .toEqual([["unused-definition", "PT-10"]]);
  });

  /*
   * THE GENERICITY TEST. Same module, a different subject's convention: ids that
   * are a letter and a digit, called through a namespace of another name, with
   * straight quotation marks instead of guillemets. No code may change for this.
   */
  it("works on a different subject's id shape, namespace and quotation marks", () => {
    const table = resolveBoilerplate(
      [prose("week-3", 'Say {phrase:R7} then {phrase:R12 loudly}.')],
      [prose("fmt-en", [
        'R7 — every day — "Show me the page with your finger."',
        'R12 — Monday only — "Read the title ⟨title⟩ together."',
      ].join("\n"))],
    );
    expect(table.keys).toEqual(["phrase"]);
    expect(table.entries.map((entry) => entry.id)).toEqual(["R12", "R7"]);
    expect(table.entries.find((entry) => entry.id === "R7")?.text)
      .toBe("Show me the page with your finger.");
    expect(table.entries.find((entry) => entry.id === "R12")?.arguments).toEqual(["loudly"]);
    expect(table.problems).toEqual([]);
  });

  /*
   * The common case, and the one a naive implementation gets wrong by being
   * noisy: only one of the two live Senegal subjects uses references at all.
   * A document that uses none is not a document with a problem.
   */
  it("is silent for a document that uses no references at all", () => {
    const table = resolveBoilerplate(
      [prose("week-1", "Lire le texte avec les élèves, puis poser les questions.")],
      [prose("fmt", "Mise en page : A4, marges de 2 cm.")],
    );
    expect(table).toEqual({ entries: [], problems: [], keys: [], templates: [] });
  });

  it("does not read a mention in passing as a definition", () => {
    const table = resolveBoilerplate(
      [prose("sec-1", "{pt:PT-01}")],
      [prose("fmt", [
        "La phrase PT-01 remplace l'ancienne rédaction.",   // mentions it, mid-line
        "PT-01 · phase 2 · « La vraie rédaction. » · — · imprimée.",
      ].join("\n"))],
    );
    expect(table.entries[0].text).toBe("La vraie rédaction.");
  });
});

/*
 * The same code over the two committed subjects, which are shaped nothing alike:
 * ci/maths has 60 lessons under 12 groupings and uses references; ce1/reading has
 * 105 lessons under weeks and days and uses none.
 *
 * The counts are NOT asserted. These fixtures are snapshots of graphs that keep
 * moving, and pinning a number here would make a routine refresh look like a
 * regression. What is asserted is what must hold for any subject at all.
 */
describe("over both committed subjects", () => {
  const load = (path: string) => {
    const graph = JSON.parse(readFileSync(`test/fixtures/${path}/knowledge_graph.json`, "utf8"));
    return (graph.nodes as Array<{ id: string; properties?: Record<string, any> }>)
      .map((node) => ({
        nodeId: node.id,
        text: [node.properties?.content, node.properties?.metadata?.assemblyGuide,
               node.properties?.metadata?.summary].filter(Boolean).join("\n"),
      }))
      .filter((source) => source.text) as ProseSource[];
  };

  const subjects = {
    "senegal/ci/maths": load("senegal/ci/maths"),
    "senegal/ce1/reading": load("senegal/ce1/reading"),
  };

  for (const [name, sources] of Object.entries(subjects)) {
    it(`returns a coherent table for ${name}`, () => {
      const table = resolveBoilerplate(sources, sources);

      // Every resolved entry can be traced back to the line that defines it.
      for (const entry of table.entries) {
        expect(entry.definition).toBeTruthy();
        expect(entry.definedIn).toBeTruthy();
        expect(entry.referencedBy.length).toBeGreaterThan(0);
      }
      // Every problem names somewhere to go and look.
      for (const problem of table.problems) {
        expect(problem.where.length).toBeGreaterThan(0);
        expect(problem.message).toBeTruthy();
      }
      // Nothing is both resolved and reported missing.
      const resolved = new Set(table.entries.map((entry) => entry.id));
      const missing = table.problems
        .filter((problem) => problem.kind === "undefined-reference")
        .map((problem) => problem.id);
      expect(missing.filter((id) => resolved.has(id))).toEqual([]);
      // Syntax documentation is never reported as a broken call.
      expect(table.templates.filter((template) => missing.some((id) => template.includes(id)))).toEqual([]);
    });
  }

  it("uses references in maths and none in reading — and stays quiet where there are none", () => {
    const maths = resolveBoilerplate(subjects["senegal/ci/maths"], subjects["senegal/ci/maths"]);
    const reading = resolveBoilerplate(subjects["senegal/ce1/reading"], subjects["senegal/ce1/reading"]);

    expect(maths.keys.length).toBeGreaterThan(0);
    expect(reading.keys).toEqual([]);
    expect(reading.entries).toEqual([]);
    // The point: a subject that does not use the feature has no findings about it.
    expect(reading.problems).toEqual([]);
  });
});
