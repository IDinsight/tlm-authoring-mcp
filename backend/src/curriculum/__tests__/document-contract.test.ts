/*
 * documentContract — everything needed to produce one document, in one call.
 *
 * Two kinds of test here. The first kind checks it gathers what it says it
 * gathers. The second, and the reason this module exists in this shape, checks
 * it REFUSES to answer the two questions the graph cannot answer — because
 * inventing a control-point list or a quotation marking is easy, plausible, and
 * exactly the failure that put a hand-written prompt in the middle of the last
 * production run.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { documentContract } from "../document-contract.js";
import type { CurriculumModel, RawGraphSnapshot } from "../../types.js";

type N = RawGraphSnapshot["nodes"][number];
type E = RawGraphSnapshot["relationships"][number];

const node = (id: string, labels: string[], properties: Record<string, unknown> = {}): N =>
  ({ id, labels, properties });
const edge = (type: string, start: string, end: string): E =>
  ({ id: `${type}:${start}->${end}`, type, start, end, properties: {} });

/*
 * A document shaped like the live ones: a spine of two sections, a formatter
 * carrying geometry, a spec carrying prose, and a routine hanging off the
 * COURSE rather than the document — which is where ci/maths' routine ended up
 * when its per-lesson edges were collapsed.
 */
const NODES: N[] = [
  node("crs", ["Course"], { description: "Cours" }),
  node("les-1", ["Lesson"], { position: 1, description: "Leçon 1" }),
  node("routine", ["InstructionalRoutine"], { description: "La routine en 9 phases" }),

  node("tlm", ["TeachingLearningMaterial"], {
    description: "Guide de l'enseignant",
    metadata: { assemblyGuide: "Une séance par page." },
  }),
  node("sec-1", ["DocumentSection"], {
    position: 1,
    description: "Phase 2",
    metadata: { assemblyGuide: "Ouvrir avec {pt:PT-01}, puis montrer {img:picto-materiel}." },
  }),
  node("sec-2", ["DocumentSection"], {
    position: 2,
    description: "Phase 4",
    metadata: { assemblyGuide: "Dire {pt:PT-04 ▲}." },
  }),

  node("fmt", ["Formatter"], {
    description: "Gabarit",
    render: {
      page: { size: "A4" },
      type: { family: "Andika", sizePt: 12 },
      blocks: { puce: { marker: "•" } },
      images: { inlineHeightCm: { "picto-materiel": 0.5 } },
    },
  }),
  node("spec", ["FormatterSpec"], {
    description: "Le répertoire",
    content: [
      "PT-01 · phase 2 · « E. écoute sans corriger. » · — · imprimée.",
      "PT-04 · phase 4 · « Doigt sur le repère ⟨repère⟩. » · — · imprimée.",
    ].join("\n"),
  }),
];

const EDGES: E[] = [
  edge("hasPart", "crs", "les-1"),
  edge("usesRoutine", "crs", "routine"),
  edge("hasPart", "tlm", "sec-1"),
  edge("hasPart", "tlm", "sec-2"),
  edge("hasPart", "tlm", "fmt"),
  edge("hasPart", "fmt", "spec"),
  edge("covers", "tlm", "crs"),
  edge("covers", "sec-1", "les-1"),
];

const MODEL = { rawGraph: { nodes: NODES, relationships: EDGES } } as unknown as CurriculumModel;

const contractOf = (id: string) => {
  const result = documentContract(MODEL, id);
  if (result === null || "error" in result) throw new Error(`no contract for ${id}`);
  return result;
};

describe("gathering a document's production rules", () => {
  it("returns the spine in reading order with what each section covers", () => {
    const contract = contractOf("tlm");
    expect(contract.spine.total).toBe(2);
    expect(contract.spine.sections.map((section) => section.id)).toEqual(["sec-1", "sec-2"]);
    expect(contract.spine.sections[0].covers).toEqual(["les-1"]);
    expect(contract.assemblyGuide).toBe("Une séance par page.");
  });

  it("merges the formatter stack's settings rather than handing back a list", () => {
    const contract = contractOf("tlm");
    expect(contract.formatterStack).toContain("fmt");
    expect(contract.render.ok).toBe(true);
    if (!contract.render.ok) return;
    expect(contract.render.spec.type?.family).toBe("Andika");
    expect(contract.render.spec.page?.size).toBe("A4");
  });

  /*
   * The routine hangs off the Course, not the document. Looking only at the
   * document answers "none" — which reads like a real answer and is wrong for
   * every ci/maths document.
   */
  it("finds a routine the document inherits from the curriculum it covers", () => {
    expect(contractOf("tlm").routine).toEqual({ id: "routine", resolvedFrom: "crs", scope: "curriculum" });
  });

  it("resolves the repeated sentences its sections call", () => {
    const { boilerplate } = contractOf("tlm");
    const sentences = boilerplate.entries.filter((entry) => entry.key === "pt");
    expect(sentences.map((entry) => entry.id)).toEqual(["PT-01", "PT-04"]);
    expect(sentences.find((entry) => entry.id === "PT-04")?.arguments).toEqual(["▲"]);
    expect(sentences.find((entry) => entry.id === "PT-01")?.text).toBe("E. écoute sans corriger.");
  });

  /*
   * A picture is named in the render settings, never in a sentence. Without
   * those names as definitions, every correctly-declared picture is reported as
   * a broken reference — noise that buries the real findings.
   */
  it("treats a picture named in the render settings as defined", () => {
    const { boilerplate } = contractOf("tlm");
    const missing = boilerplate.problems
      .filter((problem) => problem.kind === "undefined-reference")
      .map((problem) => problem.id);
    expect(missing).not.toContain("picto-materiel");

    // It resolves as an entry like any other reference, with no wording — a
    // picture is declared by NAME, and there is no sentence to quote.
    const picture = boilerplate.entries.find((entry) => entry.id === "picto-materiel");
    expect(picture).toMatchObject({ key: "img", text: null, referencedBy: ["sec-1"] });
  });

  /*
   * THE POINT OF THE MODULE. Both of these are trivially fakeable and both would
   * be believed. Saying so is the feature.
   */
  it("refuses to invent the two things the graph does not mark", () => {
    const { unavailable } = contractOf("tlm");
    expect(unavailable.map((part) => part.part).sort()).toEqual(["controlPoints", "quotations"]);
    for (const part of unavailable) {
      expect(part.why).toBeTruthy();
      expect(part.wouldNeed).toBeTruthy();
    }
  });

  /*
   * The refusal is not permanent — it is a statement about THIS document's data.
   * Once the formatter marks its quotations, the same call answers.
   */
  it("answers quotations once the document marks them", () => {
    const marked = JSON.parse(JSON.stringify(NODES)) as N[];
    const formatter = marked.find((candidate) => candidate.id === "fmt")!;
    (formatter.properties as Record<string, any>).render.overflow = {
      policy: "tighten-text",
      neverShorten: ["N!", "FR!"],
    };
    const model = { rawGraph: { nodes: marked, relationships: EDGES } } as unknown as CurriculumModel;

    const contract = documentContract(model, "tlm");
    if (contract === null || "error" in contract) throw new Error("no contract");
    expect(contract.quotations).toEqual({ markedBy: ["N!", "FR!"] });
    expect(contract.unavailable.map((part) => part.part)).toEqual(["controlPoints"]);
  });

  it("returns null for a node that is not a document", () => {
    expect(documentContract(MODEL, "les-1")).toBeNull();
    expect(documentContract(MODEL, "nope")).toBeNull();
  });
});

/*
 * The same call over the two committed subjects. They share no shape: ci/maths
 * has two documents over 500-odd sections each; ce1/reading has one over 21,
 * organised by week and day, and uses no references at all.
 *
 * Counts are not asserted — these snapshots move.
 */
describe("over both committed subjects", () => {
  const documentsIn = (path: string) => {
    const graph = JSON.parse(readFileSync(`test/fixtures/${path}/knowledge_graph.json`, "utf8"));
    const model = { rawGraph: graph } as unknown as CurriculumModel;
    const tlms = (graph.nodes as N[]).filter((candidate) => (candidate.labels ?? []).includes("TeachingLearningMaterial"));
    return { model, tlms };
  };

  for (const path of ["senegal/ci/maths", "senegal/ce1/reading"]) {
    it(`returns a usable contract for every document in ${path}`, () => {
      const { model, tlms } = documentsIn(path);
      expect(tlms.length).toBeGreaterThan(0);

      for (const tlm of tlms) {
        const contract = documentContract(model, tlm.id);
        expect(contract).not.toBeNull();
        if (contract === null || "error" in contract) throw new Error("no contract");

        expect(contract.documentId).toBe(tlm.id);
        expect(contract.spine.sections.length).toBeLessThanOrEqual(contract.spine.total);
        // Precedence order is the point of the stack: no id may appear twice.
        expect(new Set(contract.formatterStack).size).toBe(contract.formatterStack.length);
        // Whatever the settings resolve to, it is answered — merged or refused,
        // never silently empty.
        expect(typeof contract.render.ok).toBe("boolean");
        // The refusals are unconditional: they do not depend on the subject.
        expect(contract.unavailable.map((part) => part.part).sort())
          .toEqual(["controlPoints", "quotations"]);
      }
    });
  }
});
