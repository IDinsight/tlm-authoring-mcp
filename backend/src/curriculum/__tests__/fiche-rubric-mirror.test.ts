/*
 * The fiche evaluation grid mirrors the checklist it stands for.
 *
 * The teacher formatter's spec « Le contrôle de la fiche » lists the points a
 * fiche must satisfy; the Rubric attached to the Guide is the form the
 * reviewing model fills in (evaluate_document). Before 13 September 2026 the
 * grid asked ten questions for twenty-seven points, so a fiche could pass it
 * unchecked on most of them. This pins the mirror: one criterion per point,
 * each quoting its point by number, each saying how it is answered.
 *
 * Reads the ci/maths fixture graph, so it holds the two as published.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const graph = JSON.parse(readFileSync(join(process.cwd(), "test", "fixtures", "senegal", "ci", "maths", "knowledge_graph.json"), "utf8"));
const titleOf = (n: any) => String(n?.properties?.description ?? "").split("\n")[0].trim();
const labelsOf = (n: any): string[] => n?.labels ?? [];
const byId = new Map<string, any>(graph.nodes.map((n: any) => [n.id, n]));
const childrenOf = (id: string) => graph.relationships.filter((e: any) => e.type === "hasPart" && e.start === id).map((e: any) => byId.get(e.end));

const spec = graph.nodes.find((n: any) => labelsOf(n).includes("FormatterSpec") && /^Le contrôle de la fiche$/.test(titleOf(n)));
const rubric = graph.nodes.find((n: any) => labelsOf(n).includes("Rubric") && /^Contrôle d'une fiche du Guide/.test(titleOf(n)));
const points = (String(spec?.properties?.content ?? "").match(/^\d+\.\s/gm) ?? []).length;
const groups = (String(spec?.properties?.content ?? "").match(/^••\s.+?\s••$/gm) ?? []).length;
const sections = childrenOf(rubric?.id ?? "").filter((n: any) => labelsOf(n).includes("RubricSection"));
const criteria = sections.flatMap((s: any) => childrenOf(s.id)).filter((n: any) => labelsOf(n).includes("RubricCriterion"));

describe("the fiche grid mirrors « Le contrôle de la fiche »", () => {
  it("asks one question per point of the checklist, in the checklist's groups", () => {
    expect(points).toBeGreaterThan(20);
    expect(criteria.length).toBe(points);
    expect(sections.length).toBe(groups);
  });

  it("quotes each point by number, exactly once, and says how it is answered", () => {
    const cited = criteria.map((c: any) => Number(String(c.properties.content).match(/^Point (\d+) de « Le contrôle de la fiche »/)?.[1] ?? 0)).sort((a: number, b: number) => a - b);
    expect(cited).toEqual(Array.from({ length: points }, (_, i) => i + 1));
    for (const c of criteria) expect(String(c.properties.content), titleOf(c)).toMatch(/Comment on répond — /);
  });

  it("names the page rule that settles point 4 — the bullet style must declare its line budget", () => {
    const formatter = graph.nodes.find((n: any) => labelsOf(n).includes("Formatter") && /gabarit répété d'une fiche$/.test(titleOf(n)));
    expect(formatter?.properties?.render?.blocks?.puce?.maxChars).toBe(formatter?.properties?.render?.budget?.maxCharsPerLine);
  });
});
