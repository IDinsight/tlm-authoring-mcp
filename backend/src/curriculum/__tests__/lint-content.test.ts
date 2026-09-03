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
