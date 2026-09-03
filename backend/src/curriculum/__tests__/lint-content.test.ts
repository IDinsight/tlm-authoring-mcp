/*
 * The content lint, against a corpus of REAL defects.
 *
 * The roadmap asks for exactly this: a regression corpus of live bugs the
 * checker must reproduce. Every fixture below is transcribed from the senegal
 * catalog as measured on 3 September 2026, so a rule that stops catching one of
 * them fails here rather than in production.
 *
 * Confirmed live, and reproduced below:
 *   • "Fiche de leçon — enseignement explicite (30 min)" — steps sum to 35
 *   • 11 of 16 routines carry no timing on at least one step
 *   • Annexe 7's six weighted sections total 80%
 *   • seven ids cited in prose that resolve to nothing, written TRUNCATED
 */
import { describe, it, expect } from "vitest";
import { lintContent, lintableRules, CONTENT_RULES, citedIds, minutesFromIso, minutesFromTitle } from "../lint-content.js";
import type { MutationGraph, MutationNode, MutationEdge } from "../../kg-store/index.js";

const node = (id: string, raw: Record<string, unknown>, labels = ["InstructionalRoutine"]): MutationNode =>
  ({ id, type: labels[0], namespace: "test", labels, spine: false, properties: { raw } } as unknown as MutationNode);

const edge = (from: string, to: string): MutationEdge =>
  ({ id: `hasPart:${from}->${to}`, type: "hasPart", from, to, namespace: "test", properties: {} } as unknown as MutationEdge);

// The catalog's three-level shape: root ─hasPart→ entry ─hasPart→ step.
const catalog = (entries: Array<{ entry: MutationNode; steps: MutationNode[] }>): MutationGraph => ({
  nodes: [node("cat-root", { description: "Catalog library" }), ...entries.flatMap((e) => [e.entry, ...e.steps])],
  edges: entries.flatMap((e) => [edge("cat-root", e.entry.id), ...e.steps.map((s) => edge(e.entry.id, s.id))]),
});

const rulesOf = (findings: { rule: string }[]) => findings.map((f) => f.rule);

// ── The live defects ─────────────────────────────────────────────────────────

describe("regression corpus — defects confirmed on the live catalog", () => {
  // Shared routine 78936410: declares 30 minutes, steps are 4+8+8+10+5 = 35.
  const explicitTeaching = catalog([{
    entry: node("explicit", { description: "Fiche de leçon — enseignement explicite (30 min)" }),
    steps: [
      node("s1", { description: "JE FAIS — Déclencheur", timeRequired: "PT4M" }),
      node("s2", { description: "JE FAIS — Modelage", timeRequired: "PT8M" }),
      node("s3", { description: "NOUS FAISONS", timeRequired: "PT8M" }),
      node("s4", { description: "TU FAIS", timeRequired: "PT10M" }),
      node("s5", { description: "NOUS FAISONS — Objectivation", timeRequired: "PT5M" }),
    ],
  }]);

  it("catches the 30-declared / 35-summed routine, and says both numbers", () => {
    const [finding] = lintContent({ graph: explicitTeaching });

    expect(finding.rule).toBe("routine-duration-mismatch");
    expect(finding.message).toContain("30 minutes");
    expect(finding.message).toContain("35");
    expect(finding.fix).toBeTruthy();
  });

  // 11 of 16 live routines look like this: a total in the name, no step timings.
  const untimedSteps = catalog([{
    entry: node("cgp", { description: "Fiche de remédiation hebdomadaire (CGP) L1/L2 — 60 min" }),
    steps: [
      node("c1", { description: "Étape 1 — Passation des consignes" }),
      node("c2", { description: "Étape 2 — Mise en situation" }),
      node("c3", { description: "Étape 3 — Entraînement", timeRequired: "PT20M" }),
    ],
  }]);

  it("catches a routine that times itself but not its steps, and names them", () => {
    const findings = lintContent({ graph: untimedSteps });

    expect(rulesOf(findings)).toContain("routine-step-untimed");
    const [finding] = findings.filter((f) => f.rule === "routine-step-untimed");
    expect(finding.message).toContain("2 of this routine's 3 steps");
    expect(finding.message).toContain("Étape 1");
    // The fix must say WHY the field matters, not just "add a duration".
    expect(finding.fix).toContain("cannot be read");
  });

  it("does NOT report a mismatch when the steps are only partly timed", () => {
    // A partial sum is not a contradiction — it is the missing-timings finding,
    // and reporting both would be two lines about one problem.
    expect(rulesOf(lintContent({ graph: untimedSteps }))).not.toContain("routine-duration-mismatch");
  });

  // Annexe 7: 20+15+10+15+10+10 = 80.
  const annexe7 = catalog([{
    entry: node("annexe-7", { description: "Annexe 7 — Grille d'évaluation des matériels", metadata: { catalogKind: "rubric", scale: "0-4" } }),
    steps: [20, 15, 10, 15, 10, 10].map((weight, i) =>
      node(`a7-${i}`, { description: `Section ${i}`, metadata: { weight: `${weight}%` } })),
  }]);

  it("catches the grid that totals 80%", () => {
    const [finding] = lintContent({ graph: annexe7 });

    expect(finding.rule).toBe("rubric-weights-sum");
    expect(finding.message).toContain("80%");
  });

  // The CGP entry cites three ids; two of them exist nowhere.
  const danglingRefs: MutationGraph = catalog([{
    entry: node("cgp-entry", {
      description: "Fiche de remédiation hebdomadaire (CGP)",
      metadata: {
        summary:
          "Distincte de la séance de remédiation d'intégration (edf2c696-…). " +
          "Les moyens matériels suivent le formatter des moyens matériels (`b3f4d5bc-…`), " +
          "en suivant le relâchement du formatter « Je fais / Nous faisons / Tu fais » (`6313dea1-…`).",
      },
    }),
    steps: [],
  }]);
  const existing = new Set(["edf2c696-db65-4d14-a19d-8c43fc674061", "6313dea1-cb2a-4362-bebd-d1252f41ff1b"]);

  it("catches TRUNCATED citations that resolve to nothing", () => {
    const [finding] = lintContent({ graph: danglingRefs, knownIds: existing });

    expect(finding.rule).toBe("dangling-reference");
    expect(finding.message).toContain("b3f4d5bc");
    // The two that DO resolve, by prefix, must not be reported.
    expect(finding.message).not.toContain("edf2c696");
    expect(finding.message).not.toContain("6313dea1");
  });

  /*
   * A catalog clone answers to TWO ids. `add_to_catalog` gives it a fresh `id`
   * and stores the SOURCE node's id as its `identifier` — so an entry cloned out
   * of ce1/reading carries prose citing reading's ids, which are exactly the
   * identifiers its own clones hold. Resolving `id` alone called every one of
   * those broken: of nine findings on the live catalog, four were citations that
   * were perfectly good, and chasing them cost a morning.
   */
  it("resolves a citation against a node's `identifier`, not only its `id`", () => {
    const clone = node("32559627-b1b6-4fac-a8e3-4735a5f8da48", {
      description: "Grille de caractéristiques du texte narratif (formatter)",
      identifier: "b946e7f4-85d3-4e23-8371-846b2561a539",   // the reading-graph node it was cloned from
    });
    const citing = catalog([{
      entry: node("citing-entry", {
        description: "Fiche de production d'écrits",
        metadata: { summary: "Applique la grille narrative (`b946e7f4-…`)." },
      }),
      steps: [],
    }]);
    const graph: MutationGraph = { nodes: [...citing.nodes, clone], edges: citing.edges };

    expect(lintContent({ graph }).filter((f) => f.rule === "dangling-reference")).toEqual([]);
  });

  it("tells the reader a citation may name a node in a namespace it cannot see", () => {
    // The rule reads the active subject and the catalog libraries — nothing
    // else. Saying "this was never authored" about a node in another subject's
    // graph is how a real formatter got drafted a second time.
    const [finding] = lintContent({ graph: danglingRefs, knownIds: existing });

    expect(finding.fix).toMatch(/ANOTHER subject/);
    expect(finding.fix).toMatch(/identifier/);
  });

  it("would have found NOTHING with a full-UUID scan — which is why prefixes matter", () => {
    // The scan that was run first, and pronounced the catalog clean while seven
    // references were broken.
    const fullUuidsOnly = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
    const prose = String((danglingRefs.nodes[1].properties!.raw as any).metadata.summary);

    expect(prose.match(fullUuidsOnly)).toBeNull();
    expect(citedIds(prose)).toHaveLength(3);
  });
});

// ── Not firing where it should not ───────────────────────────────────────────

describe("what the lint leaves alone", () => {
  it("says nothing about a routine whose steps add up", () => {
    const consistent = catalog([{
      entry: node("ok", { description: "Fiche de vocabulaire — 30 min" }),
      steps: [node("v1", { description: "A", timeRequired: "PT10M" }), node("v2", { description: "B", timeRequired: "PT20M" })],
    }]);
    expect(lintContent({ graph: consistent })).toEqual([]);
  });

  it("says nothing about an UNTIMED routine — that is a choice, not an omission", () => {
    const untimed = catalog([{
      entry: node("structure", { description: "Manuel de l'élève — structure d'un chapitre" }),
      steps: [node("p1", { description: "Une partie" }), node("p2", { description: "Une autre" })],
    }]);
    expect(lintContent({ graph: untimed })).toEqual([]);
  });

  it("says nothing about an unweighted checklist", () => {
    const yesNo = catalog([{
      entry: node("annexe-8", { description: "Annexe 8 — Grille d'approbation", metadata: { catalogKind: "rubric", scale: "oui-non" } }),
      steps: ["A", "B", "C"].map((name, i) => node(`a8-${i}`, { description: `Section ${name}` })),
    }]);
    expect(lintContent({ graph: yesNo })).toEqual([]);
  });

  it("leaves a PARTLY weighted grid to a person rather than guessing", () => {
    const partly = catalog([{
      entry: node("mixed", { description: "Grille mixte" }),
      steps: [node("m1", { description: "A", metadata: { weight: "60%" } }), node("m2", { description: "B" })],
    }]);
    expect(rulesOf(lintContent({ graph: partly }))).not.toContain("rubric-weights-sum");
  });
});

// ── The escape hatch ─────────────────────────────────────────────────────────

describe("silencing a finding that is deliberate", () => {
  // The first rule written here would have fired a false positive on its first
  // run: Annexe 7's shortfall is intentional, sections having been removed
  // pending review. A linter whose opening finding is wrong trains its reader
  // to skim past it.
  const deliberate = catalog([{
    entry: node("annexe-7", {
      description: "Annexe 7 — Grille d'évaluation des matériels",
      metadata: { catalogKind: "rubric", lintIgnore: ["rubric-weights-sum"] },
    }),
    steps: [20, 15, 10, 15, 10, 10].map((weight, i) =>
      node(`a7-${i}`, { description: `Section ${i}`, metadata: { weight: `${weight}%` } })),
  }]);

  it("respects metadata.lintIgnore on the node, with no deploy", () => {
    expect(lintContent({ graph: deliberate })).toEqual([]);
  });

  it("silences ONLY the named rule", () => {
    const stillTimed = catalog([{
      entry: node("e", { description: "Fiche — 30 min", metadata: { lintIgnore: ["rubric-weights-sum"] } }),
      steps: [node("s", { description: "Étape" })],
    }]);
    expect(rulesOf(lintContent({ graph: stillTimed }))).toContain("routine-step-untimed");
  });
});

// ── render vs prose (the WP3 follow-up) ──────────────────────────────────────

describe("a formatter's declared values against its own prose", () => {
  const formatter = (raw: Record<string, unknown>): MutationGraph =>
    ({ nodes: [node("spec", raw, ["FormatterSpec"])], edges: [] });

  it("catches a page size that contradicts the prose", () => {
    const graph = formatter({
      content: "FORMAT DE LA PAGE — A4 PORTRAIT, MARGES DE 2,5 CM.",
      render: { page: { size: "Letter" } },
    });
    const [finding] = lintContent({ graph });

    expect(finding.rule).toBe("render-contradicts-prose");
    expect(finding.message).toContain("Letter");
    expect(finding.message).toContain("A4");
  });

  it("reads the French decimal comma, so 2,5 cm matches 2.5", () => {
    const agreeing = formatter({
      content: "MARGES DE 2,5 CM sur les quatre côtés. Andika 12 points.",
      render: { page: { marginsCm: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 } }, type: { sizePt: 12 } },
    });
    expect(lintContent({ graph: agreeing })).toEqual([]);
  });

  it("catches a body size that contradicts the prose", () => {
    const graph = formatter({ content: "Andika 12 points — valeur FIXE.", render: { type: { sizePt: 11 } } });
    expect(lintContent({ graph })[0].message).toContain("11 pt");
  });

  it("stays quiet when the prose names SEVERAL sizes — it cannot tell which is meant", () => {
    const ambiguous = formatter({
      content: "Le corps est à 11 points ; les en-têtes à 12 points.",
      render: { type: { sizePt: 11 } },
    });
    expect(lintContent({ graph: ambiguous })).toEqual([]);
  });

  it("says nothing about a formatter with no declared values", () => {
    expect(lintContent({ graph: formatter({ content: "A4, 2,5 cm, Andika 12 points." }) })).toEqual([]);
  });
});

// ── The seam for the rules that need a rendered page ─────────────────────────

describe("rules declare what they need", () => {
  it("runs only the rules that read stored content", () => {
    expect(lintableRules().every((rule) => rule.requires === "graph")).toBe(true);
  });

  it("every rule declares its requirement, so nothing runs by accident", () => {
    expect(CONTENT_RULES.every((rule) => rule.requires === "graph" || rule.requires === "blockTree")).toBe(true);
    expect(new Set(CONTENT_RULES.map((r) => r.id)).size).toBe(CONTENT_RULES.length);
  });
});

describe("reading durations in the spellings the live data uses", () => {
  it("reads the machine form", () => {
    expect(minutesFromIso("PT30M")).toBe(30);
    expect(minutesFromIso("PT1H30M")).toBe(90);
    expect(minutesFromIso("30 min")).toBeNull();
  });

  it("reads the total stated in a title, which is where every live routine puts it", () => {
    expect(minutesFromTitle("Fiche de leçon — enseignement explicite (30 min)")).toBe(30);
    expect(minutesFromTitle("Séance de remédiation d'intégration (60 min)")).toBe(60);
    expect(minutesFromTitle("Manuel de l'élève — structure d'un chapitre")).toBeNull();
  });
});

// ── The FLAT step shape ──────────────────────────────────────────────────────
// An entry authored with add_nodes and filed with add_to_catalog holds its steps
// as direct `Material` children rather than child routines. Both shapes are live.
// Reading only the nested one would silently check nothing on the flat entries —
// and the rules would look like they had passed.

describe("entries whose steps are flat Materials", () => {
  const material = (id: string, raw: Record<string, unknown>) => node(id, raw, ["Material"]);

  it("checks a flat routine's durations like a nested one's", () => {
    const flat = catalog([{
      entry: node("flat", { description: "Séance d'intégration (30 min)" }),
      steps: [
        material("f1", { description: "Révision", position: 1, timeRequired: "PT10M" }),
        material("f2", { description: "Intégration", position: 2, timeRequired: "PT25M" }),
      ],
    }]);
    const [finding] = lintContent({ graph: flat });

    expect(finding.rule).toBe("routine-duration-mismatch");
    expect(finding.message).toContain("35");
  });

  it("catches untimed flat steps too", () => {
    const flat = catalog([{
      entry: node("flat", { description: "Fiche — 30 min" }),
      steps: [material("f1", { description: "Une étape" })],
    }]);
    expect(rulesOf(lintContent({ graph: flat }))).toContain("routine-step-untimed");
  });

  it("does NOT mistake a formatter's spec Materials for steps", () => {
    // A formatter's direct Materials are its specification. Treating them as
    // steps would invent a duration requirement no formatter has.
    const formatter = catalog([{
      entry: node("fmt", { description: "Style maison (30 min de lecture)", metadata: { catalogKind: "formatter" } }),
      steps: [material("spec", { description: "La spec", content: "…" })],
    }]);
    expect(lintContent({ graph: formatter })).toEqual([]);
  });
});

// ── Which nodes are ENTRIES ──────────────────────────────────────────────────
// Found in review. The catalog nests root → entry → step, all three carrying the
// same label, so "has a routine parent" also matches a STEP — and a step's
// Material body was then read as an untimed step of it. Every fixture above
// gives its steps no children, which is exactly why this stayed hidden.

describe("telling an entry apart from a step", () => {
  const material = (id: string, raw: Record<string, unknown>) => node(id, raw, ["Material"]);

  // The shape this module's own comments call normal: the step's text lives in
  // a Material grandchild.
  const nestedWithBody: MutationGraph = {
    nodes: [
      node("root", { description: "Catalog" }),
      node("entry", { description: "Fiche — 30 min" }),
      node("step", { description: "Une étape", timeRequired: "PT30M" }),
      material("body", { description: "Le corps", content: "…" }),
    ],
    edges: [edge("root", "entry"), edge("entry", "step"), edge("step", "body")],
  };

  it("does not report a step's own body as an untimed step", () => {
    expect(lintContent({ graph: nestedWithBody })).toEqual([]);
  });

  it("still reports the ENTRY when its steps are untimed", () => {
    const untimedStep: MutationGraph = {
      nodes: [
        node("root", { description: "Catalog" }),
        node("entry", { description: "Fiche — 30 min" }),
        node("step", { description: "Une étape" }),
        material("body", { description: "Le corps" }),
      ],
      edges: [edge("root", "entry"), edge("entry", "step"), edge("step", "body")],
    };
    const findings = lintContent({ graph: untimedStep });

    expect(findings).toHaveLength(1);
    expect(findings[0].nodeId).toBe("entry");   // the entry, never the step
  });

  it("sums a nested entry's step timings against its declared total", () => {
    const mismatched: MutationGraph = {
      nodes: [
        node("root", { description: "Catalog" }),
        node("entry", { description: "Fiche — 30 min" }),
        node("s1", { description: "Étape 1", timeRequired: "PT20M" }),
        node("s2", { description: "Étape 2", timeRequired: "PT15M" }),
        material("b1", { description: "corps 1" }),
        material("b2", { description: "corps 2" }),
      ],
      edges: [edge("root", "entry"), edge("entry", "s1"), edge("entry", "s2"), edge("s1", "b1"), edge("s2", "b2")],
    };
    const findings = lintContent({ graph: mismatched });

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("routine-duration-mismatch");
    expect(findings[0].message).toContain("35");
  });
});

// ── A grid whose sections are flat ───────────────────────────────────────────
// Also found in review: the weights rule read only the nested shape, so a grid
// authored with add_nodes was skipped — and skipping looks exactly like passing.

describe("weighted grids in the flat shape", () => {
  it("checks a grid whose sections are direct Materials", () => {
    const flatGrid = catalog([{
      entry: node("annexe", { description: "Annexe 7 — Grille", metadata: { catalogKind: "rubric" } }),
      steps: [20, 15, 10, 15, 10, 10].map((weight, i) =>
        node(`sec-${i}`, { description: `Section ${i}`, metadata: { weight: `${weight}%` } }, ["Material"])),
    }]);
    const findings = lintContent({ graph: flatGrid });

    expect(rulesOf(findings)).toContain("rubric-weights-sum");
    expect(findings[0].message).toContain("80%");
  });
});

/*
 * Naming the field a broken citation sits in.
 *
 * Found the hard way on the live catalog: five references were corrected in an
 * entry's `description`, the catalog reads showed the fixed ids, and the checker
 * went on reporting the old ones — because the same prose also sits in a field
 * no read displays. Without the field name that is an unsolvable puzzle; with
 * it, it is one edit.
 */
describe("a dangling reference says WHICH field it is in", () => {
  /** One node carrying authored prose, and the dangling findings it produces. */
  const danglingIn = (props: Record<string, unknown>) =>
    lintContent({
      graph: {
        nodes: [{ id: "real-node-1111", labels: ["Material"], properties: { raw: props } }],
        edges: [],
      } as unknown as MutationGraph,
    }).filter((f) => f.rule === "dangling-reference");

  it("names `description` when the visible copy is the broken one", () => {
    const [finding] = danglingIn({ description: "Voir 4359b4a3-0000-0000-0000-000000000000." });
    expect(finding.message).toContain("In: description");
  });

  it("names `metadata.summary` — the copy no catalog read shows", () => {
    const [finding] = danglingIn({
      description: "Une routine correcte.",
      metadata: { summary: "Voir 4359b4a3-0000-0000-0000-000000000000." },
    });
    expect(finding.message).toContain("In: metadata.summary");
    expect(finding.message).not.toContain("In: description");
  });

  it("names BOTH when the prose was fixed in one copy only", () => {
    // Exactly the live case: description corrected, the duplicate left behind.
    const [finding] = danglingIn({
      description: "Voir 4359b4a3-0000-0000-0000-000000000000.",
      content: "Voir 070573a2-0000-0000-0000-000000000000.",
    });
    // Each field named with the id that is broken IN it — the ids are reported
    // as written, truncated or full.
    expect(finding.message).toMatch(/description \(4359b4a3/);
    expect(finding.message).toMatch(/content \(070573a2/);
  });

  it("still reports each unresolved id once across the fields", () => {
    const [finding] = danglingIn({
      description: "Voir 4359b4a3-0000-0000-0000-000000000000.",
      content: "Voir aussi 4359b4a3-0000-0000-0000-000000000000.",
    });
    expect(finding.message).toContain("cites 1 id(s)");
  });
});
