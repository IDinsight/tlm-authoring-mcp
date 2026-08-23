/*
 * The structural WIRING lint (kg-store/lint.ts) — the rules behind check_draft
 * and publish_draft's `checks`.
 *
 * Pure over a hand-built graph, because every rule is a statement about edges
 * and nothing else. Two things are asserted throughout: that each rule fires on
 * exactly the shape it names, and — the one that matters most — that a correctly
 * wired graph is SILENT. A lint that cries wolf on a healthy document teaches an
 * expert to ignore it, which costs more than the rule was worth.
 */
import { describe, it, expect } from "vitest";
import { lintGraph } from "../lint.js";
import type { MutationGraph, MutationNode, MutationEdge } from "../types.js";

const NS = "test/ns";

const node = (id: string, label: string, description = id): MutationNode =>
  ({ id, type: label, namespace: NS, labels: [label], spine: false, properties: { raw: { description } } });

const edge = (type: string, from: string, to: string): MutationEdge =>
  ({ id: `${type}:${from}->${to}`, type, from, to, namespace: NS, properties: {} });

// A correctly wired document over a one-lesson course: the TLM covers the
// Course, carries a Formatter, and its section covers the Lesson.
const healthy = (): MutationGraph => ({
  nodes: [
    node("course", "Course", "Guide de l'enseignant"),
    node("lesson", "Lesson", "Leçon 1"),
    node("tlm", "TeachingLearningMaterial", "Manuel de l'élève"),
    node("section", "DocumentSection", "Chapitre 1"),
    node("formatter", "Formatter", "Style maison"),
  ],
  edges: [
    edge("hasPart", "course", "lesson"),
    edge("covers", "tlm", "course"),
    edge("hasPart", "tlm", "section"),
    edge("covers", "section", "lesson"),
    edge("hasPart", "tlm", "formatter"),
  ],
});

const rules = (graph: MutationGraph): string[] => lintGraph(graph).map((finding) => finding.rule);

describe("lintGraph — a well-wired graph is silent", () => {
  it("finds nothing to report", () => {
    expect(lintGraph(healthy())).toEqual([]);
  });
});

describe("lintGraph — the document rules", () => {
  it("flags a document that covers nothing (the silent empty-generation case)", () => {
    const graph = healthy();
    graph.edges = graph.edges.filter((e) => !(e.type === "covers" && e.from === "tlm"));
    // Its section still covers the lesson, so the document is NOT orphaned…
    expect(rules(graph)).not.toContain("document-sans-contenu");

    // …but drop that too and the document renders empty with no error anywhere.
    graph.edges = graph.edges.filter((e) => e.type !== "covers");
    const finding = lintGraph(graph).find((f) => f.rule === "document-sans-contenu");
    expect(finding?.nodeId).toBe("tlm");
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toMatch(/vide/);
    expect(finding?.fix).toBeTruthy();
  });

  it("flags a document with no formatter", () => {
    const graph = healthy();
    graph.nodes = graph.nodes.filter((n) => n.id !== "formatter");
    graph.edges = graph.edges.filter((e) => e.to !== "formatter");
    expect(rules(graph)).toContain("document-sans-mise-en-forme");
  });

  it("flags a section outside any document, but treats a front-matter section as info", () => {
    const graph = healthy();
    graph.edges = graph.edges.filter((e) => !(e.type === "hasPart" && e.to === "section"));
    expect(rules(graph)).toContain("section-hors-document");

    // A section that covers nothing is legitimate front matter — reported, but
    // as info with a fix that says so, never as a warning.
    const frontMatter = healthy();
    frontMatter.edges = frontMatter.edges.filter((e) => !(e.type === "covers" && e.from === "section"));
    const finding = lintGraph(frontMatter).find((f) => f.rule === "section-sans-contenu");
    expect(finding?.severity).toBe("info");
    expect(finding?.fix).toMatch(/page de garde|sommaire/);
  });
});

describe("lintGraph — the curriculum rules", () => {
  it("flags a routine no lesson uses, and stays quiet once one does", () => {
    const graph = healthy();
    graph.nodes.push(node("routine", "InstructionalRoutine", "Déroulé de séance"));
    expect(rules(graph)).toContain("routine-inutilisee");

    graph.edges.push(edge("usesRoutine", "lesson", "routine"));
    expect(rules(graph)).not.toContain("routine-inutilisee");
  });

  it("flags a node with no edge at all", () => {
    const graph = healthy();
    graph.nodes.push(node("orphan", "Lesson", "Leçon oubliée"));
    const finding = lintGraph(graph).find((f) => f.rule === "noeud-isole");
    expect(finding?.nodeId).toBe("orphan");
  });
});

describe("lintGraph — scoping and ordering", () => {
  it("reports only the nodes a caller asks about", () => {
    const graph = healthy();
    graph.nodes.push(node("orphan", "Lesson"), node("routine", "InstructionalRoutine"));

    expect(lintGraph(graph)).toHaveLength(2);
    expect(lintGraph(graph, { onlyNodes: new Set(["orphan"]) }).map((f) => f.nodeId)).toEqual(["orphan"]);
    expect(lintGraph(graph, { onlyNodes: new Set(["course"]) })).toEqual([]);
  });

  it("says one thing per node: an unused routine with no edges is not also 'isolated'", () => {
    const graph = healthy();
    graph.nodes.push(node("routine", "InstructionalRoutine", "Routine oubliée"));

    const forRoutine = lintGraph(graph).filter((finding) => finding.nodeId === "routine");
    expect(forRoutine.map((finding) => finding.rule)).toEqual(["routine-inutilisee"]);
  });

  it("puts warnings before info", () => {
    const graph = healthy();
    graph.edges = graph.edges.filter((e) => !(e.type === "covers" && e.from === "section"));
    graph.nodes.push(node("orphan", "Lesson"));

    const severities = lintGraph(graph).map((f) => f.severity);
    expect(severities.indexOf("warning")).toBeLessThan(severities.lastIndexOf("info"));
  });

  it("does not hang on a containment cycle", () => {
    const graph: MutationGraph = {
      nodes: [node("a", "TeachingLearningMaterial"), node("b", "DocumentSection")],
      edges: [edge("hasPart", "a", "b"), edge("hasPart", "b", "a")],
    };
    expect(() => lintGraph(graph)).not.toThrow();
  });
});
