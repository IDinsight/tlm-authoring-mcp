/*
 * Lint rules a formatter declares as data (kg-recipes/lint-rules.ts,
 * curriculum/lint-declared.ts).
 *
 * The recurring guide defects of the fiche were re-found by hand on every
 * production. Pinned here: a rule authored on the teacher formatter is
 * validated at edit time, runs over the guides of the document it governs
 * and the curriculum those sections cover, reports each break against the
 * node that holds it under `declared:<id>`, is silenced per node like any
 * rule, and the fiche's own rule list catches the defects the Leçon 4 fixture
 * really has.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { seedStore, seededContexts, fakeStorage, CI_MATHS, CURATOR, APPROVER, withActiveContext as inContext } from "../../__tests__/index.js";
import { __setKgStoreForTest, kgNamespace, __resetMutationsForTest, __resetDraftTokensForTest, publishDraftWithConfirm, type KgNodeStore, type MutationGraph } from "../../kg-store/index.js";
import { __setStorageForTest } from "../../storage/index.js";
import { getActiveAdapter } from "../../adapters/index.js";
import { validateLintRules, lineBreaks } from "../../kg-recipes/index.js";
import { lintDeclared, lintDeclaredPage, declaredPageRules } from "../../curriculum/index.js";
import { runEditNodes } from "../recipes.js";
import { runLintContent } from "../check.js";
import type { Actor } from "../../actor.js";

const FICHE_RULES = JSON.parse(readFileSync(join(process.cwd(), "test", "fixtures", "senegal-fiche-lint-rules.json"), "utf8")).lintRules;

describe("a rule, line by line", () => {
  it("validates, and refuses a bad regex, a duplicate id, or sections on a page rule", () => {
    expect(validateLintRules(FICHE_RULES, "test")).toEqual([]);
    expect(validateLintRules([{ id: "x", where: "guide", match: "(", message: "m" }], "edit_nodes").join("\n")).toMatch(/not a valid regular expression/);
    expect(validateLintRules([{ id: "x", where: "guide", match: "a", message: "m" }, { id: "x", where: "guide", match: "b", message: "m" }], "edit_nodes").join("\n")).toMatch(/used twice/);
    expect(validateLintRules([{ id: "x", where: "page", sections: "^A", match: "a", message: "m" }], "edit_nodes").join("\n")).toMatch(/cannot pick sections/);
  });

  it("breaks on the four things a rule can ask, and only on matched lines", () => {
    const requireRule = { id: "r", where: "guide" as const, match: "^\\[FR\\].*\\?$", require: "\\([^()]+\\)$", message: "m" };
    expect(lineBreaks(requireRule, "[FR] Qui est près du chef ? (la rangée)")).toBeNull();
    expect(lineBreaks(requireRule, "[FR] Qui est près du chef ?")).toMatch(/required/);
    expect(lineBreaks(requireRule, "[N] E. montre la scène.")).toBeNull();
    expect(lineBreaks({ id: "f", where: "guide", match: "^\\[N\\]", forbid: "insiste", message: "m" }, "[N] E. insiste sur le mot.")).toMatch(/forbidden/);
    expect(lineBreaks({ id: "l", where: "guide", match: "^\\[N\\]", maxChars: 10, message: "m" }, "[N] beaucoup trop long")).toMatch(/over 10/);
    expect(lineBreaks({ id: "u", where: "guide", match: "^\\[N\\]", maxChars: 10, unless: "PT-01", message: "m" }, "[N] {pt:PT-01} beaucoup trop long")).toBeNull();
    expect(lineBreaks({ id: "m", where: "guide", match: "Aujourd.hui", message: "m" }, "[FR] Aujourd'hui, nous allons apprendre")).toMatch(/should not/);
  });
});

// A small document: a TLM with a formatter carrying rules, one section whose
// guide breaks two of them, covering an activity whose content breaks a third.
const node = (id: string, labels: string[], raw: Record<string, unknown>) => ({ id, labels, properties: { raw, title: String(raw.description ?? id).split("\n")[0] } });
const GRAPH: MutationGraph = {
  nodes: [
    node("tlm", ["TeachingLearningMaterial"], { description: "Guide", metadata: { assemblyGuide: "[N] {pt:PT-07}" } }),
    node("fmt", ["Formatter"], { description: "Gabarit", lintRules: [
      { id: "pt-07-sans-exemple", where: "guide", match: "\\{pt:PT-07\\s*\\}", message: "PT-07 sans exemple" },
      { id: "phase-2-only", where: "guide", sections: "^PHASE 2 ", match: "^\\[FR\\].*\\?$", require: "\\)$", message: "question sans réponse" },
      { id: "no-insist", where: "content", match: "insiste", message: "pas d'insistance" },
    ] }),
    node("sec2", ["DocumentSection"], { description: "PHASE 2 — Mise en situation", metadata: { assemblyGuide: "[FR] Qui est près du chef ?\n[N] {pt:PT-07}" } }),
    node("sec4", ["DocumentSection"], { description: "PHASE 4 — Nous faisons", metadata: { assemblyGuide: "[FR] Quel objet est long ?\n[N] {pt:PT-07 avec deux crayons}", lintIgnore: ["pt-07-sans-exemple"] } }),
    node("act", ["Activity"], { description: "Activité", content: "E. insiste sur le mot COURT." }),
  ],
  edges: [
    { id: "e1", type: "hasPart", from: "tlm", to: "fmt" },
    { id: "e2", type: "hasPart", from: "tlm", to: "sec2" },
    { id: "e3", type: "hasPart", from: "tlm", to: "sec4" },
    { id: "e4", type: "covers", from: "sec4", to: "act" },
  ],
} as unknown as MutationGraph;

describe("running the declared rules over what a formatter governs", () => {
  it("reads the guides of the document and its sections, and the content the sections cover", () => {
    const { findings, rulesRun } = lintDeclared(GRAPH);
    expect(rulesRun.sort()).toEqual(["declared:no-insist", "declared:phase-2-only", "declared:pt-07-sans-exemple"]);
    const byRule = (id: string) => findings.filter((f) => f.rule === `declared:${id}`).map((f) => f.nodeId).sort();
    // PT-07 without its example: on the document's own guide and on sec2; sec4 has the example.
    expect(byRule("pt-07-sans-exemple")).toEqual(["sec2", "tlm"]);
    // The section filter: sec4's question has no parenthesis either, but the rule reads PHASE 2 only.
    expect(byRule("phase-2-only")).toEqual(["sec2"]);
    // Content: the activity sec4 covers.
    expect(byRule("no-insist")).toEqual(["act"]);
    const first = findings.find((f) => f.rule === "declared:pt-07-sans-exemple" && f.nodeId === "sec2")!;
    expect(first.message).toMatch(/PT-07 sans exemple — « \[N\] \{pt:PT-07\} »/);
    expect(first.severity).toBe("warning");
  });

  it("is silenced on a node by metadata.lintIgnore, bare id or prefixed", () => {
    const silencedGraph = { ...GRAPH, nodes: GRAPH.nodes.map((n) => n.id === "sec2" ? { ...n, properties: { ...n.properties, raw: { ...(n.properties as any).raw, metadata: { ...(n.properties as any).raw.metadata, lintIgnore: ["declared:pt-07-sans-exemple", "phase-2-only"] } } } } : n) } as MutationGraph;
    const { findings } = lintDeclared(silencedGraph);
    expect(findings.filter((f) => f.nodeId === "sec2")).toEqual([]);
  });

  it("checks a composed page against the stack's page rules", () => {
    const rules = declaredPageRules([{ id: "fmt", properties: { raw: { lintRules: [{ id: "no-letter", where: "page", match: "^\\s*[ABC][.)]\\s", message: "pas de lettre" }] } } }]);
    const findings = lintDeclaredPage(rules, [
      { kind: "line", runs: [{ text: "A. la natte" }] },
      { kind: "table", rows: [[{ blocks: [{ kind: "line", runs: [{ text: "B) le ciel" }] }] }]] },
      { kind: "line", runs: [{ text: "• la natte" }] },
    ], { id: "sec", title: "page", ignore: new Set() });
    expect(findings.map((f) => f.message)).toHaveLength(2);
    expect(findings[0].rule).toBe("declared:no-letter");
  });
});

// ── through the tool, on the real fixture ────────────────────────────────────
const contexts = seededContexts([CI_MATHS]);
const ctx = contexts.find((c) => c.grade === "ci" && c.subject === "maths")!;
const ns = kgNamespace(ctx.workspace, ctx.grade, ctx.subject);
const withCtx = <T>(actor: Actor | null, fn: () => Promise<T>): Promise<T> => inContext(ctx, actor, fn);
let store: KgNodeStore;

beforeEach(async () => {
  store = await seedStore({ only: [CI_MATHS] });
  __setKgStoreForTest(store);
  __resetMutationsForTest();
  __resetDraftTokensForTest();
  __setStorageForTest(fakeStorage);
});
afterAll(() => { __setKgStoreForTest(null); });

describe("the fiche's own rules, authored on the teacher formatter", () => {
  it("are refused at edit time when malformed, accepted when valid, and then catch the fixture's real defects", async () => {
    const formatterId = await withCtx(APPROVER, async () => {
      const raw = getActiveAdapter().model().rawGraph!;
      const fmt = raw.nodes.find((n) => (n.labels ?? []).includes("Formatter") && /^Guide de l'enseignant — gabarit répété/.test(String(n.properties?.description ?? "")))!;
      // Malformed: refused with the path, nothing staged.
      const bad = await runEditNodes({ items: [{ nodeId: fmt.id, properties: { lintRules: [{ id: "x", where: "guide", match: "(", message: "m" }] } }] });
      expect(JSON.stringify(bad)).toMatch(/lintRules\[0\]\.match.*not a valid regular expression/);
      // Valid: staged and published.
      const items = [{ nodeId: fmt.id, properties: { lintRules: FICHE_RULES } }];
      const dry = await runEditNodes({ items });
      if (!dry.confirmationToken) throw new Error(JSON.stringify(dry));
      await runEditNodes({ items, confirm: true, confirmationToken: dry.confirmationToken as string });
      const pub = await publishDraftWithConfirm(ns) as { confirmationToken?: string };
      const done = await publishDraftWithConfirm(ns, { confirm: true, token: pub.confirmationToken });
      if (!("ok" in done && done.ok)) throw new Error(JSON.stringify(done));
      return fmt.id;
    });
    expect(formatterId).toBeTruthy();

    const result = await withCtx(CURATOR, () => runLintContent({ scope: "subject" }));
    const declared = (result.findings as Array<{ rule: string; nodeId: string; title: string; message: string }>).filter((f) => f.rule.startsWith("declared:"));
    expect(result.rulesRun).toContain("declared:annonce-objectif-imprimee");
    // The defects the diagnosis named, found by data: a [FR] « Aujourd'hui… » line, a PT-07 with no example.
    const byRule = (id: string) => declared.filter((f) => f.rule === `declared:${id}`);
    expect(byRule("annonce-objectif-imprimee").length).toBeGreaterThan(0);
    expect(byRule("pt-07-sans-exemple").length).toBeGreaterThan(0);
    // Every finding names the section that holds the line and quotes it.
    for (const f of declared.slice(0, 5)) { expect(f.title).toMatch(/PHASE|Fiche|Guide/); expect(f.message).toMatch(/« .+ »/); }
  });
});
