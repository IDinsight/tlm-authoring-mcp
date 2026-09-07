/*
 * The page rules — a composed block tree against the geometry that will lay it out.
 *
 * These are the `requires: "blockTree"` half of lint_content, which sat
 * advertised-but-empty until both halves existed: a block tree (WP4's renderer)
 * and a merged `render` spec to judge it against.
 *
 * Every rule here catches a page that RENDERS SUCCESSFULLY and wrongly, which is
 * the point of having them. An undefined style silently becomes body text; an
 * unresolvable picture silently becomes the document's first picture. No page
 * count catches either, so a human has to look — and the reported session's
 * experience is that a human looks by luck.
 *
 * What is NOT tested here, because it must not exist: any rule that knows what a
 * CI-maths fiche looks like. Every limit below comes from the spec passed in.
 */
import { describe, it, expect } from "vitest";
import { lintPage, PAGE_RULES, type PageInput } from "../lint-page.js";
import type { Block } from "../../render/index.js";
import type { RenderSpec } from "../../kg-recipes/index.js";

const line = (text: string, style?: string): Block => ({ kind: "line", runs: [{ text }], ...(style ? { style } : {}) });
const picture = (media: string, role = "band"): Block => ({ kind: "line", runs: [{ image: { media, role, aspectRatio: 1 } }] });

/** A page, with a formatter that defines two block styles by default. */
function page(blocks: Block[], spec: RenderSpec, media: string[] = [], ignore?: string[]): PageInput {
  return {
    tree: { blocks, media: media.map((name) => ({ name })) },
    spec,
    scopeId: "sec-1",
    ...(ignore ? { ignore: new Set(ignore) } : {}),
  };
}

const twoStyles = { blocks: { banner: { fill: "1F7A1F" }, bullet: { maxChars: 40 } } } as RenderSpec;

const rulesOf = (findings: { rule: string }[]) => findings.map((finding) => finding.rule);

describe("a style the formatter stack does not define", () => {
  it("flags it, and lists what IS defined", () => {
    const findings = lintPage(page([line("Phase 1", "bandeau")], twoStyles));

    expect(rulesOf(findings)).toEqual(["page-unknown-block-style"]);
    // Naming the defined styles is what turns the finding into a fix: the
    // commonest cause is a near-miss spelling of a real one.
    expect(findings[0].message).toContain("'bandeau'");
    expect(findings[0].message).toContain("banner");
    expect(findings[0].fix).toMatch(/silently lose their styling/);
  });

  it("looks inside tables, and inside tables in tables", () => {
    // The pupil tool's answer grids are nested tables; a walker that stopped at
    // the first level would miss most of a page.
    const nested: Block = {
      kind: "table",
      rows: [[{ blocks: [{ kind: "table", rows: [[{ blocks: [line("x", "ghost")] }]] }] }]],
    };
    expect(rulesOf(lintPage(page([nested], twoStyles)))).toEqual(["page-unknown-block-style"]);
  });

  it("checks a run's and a cell's style, not only a block's", () => {
    const runStyled: Block = { kind: "line", runs: [{ text: "x", style: "ghostRun" }] };
    const cellStyled: Block = { kind: "table", rows: [[{ blocks: [], style: "ghostCell" }]] };
    const message = lintPage(page([runStyled, cellStyled], twoStyles))[0].message;

    expect(message).toContain("ghostRun");
    expect(message).toContain("ghostCell");
  });

  it("stays quiet when the stack defines NO block styles at all", () => {
    // That is a different and larger problem — the formatter carries no geometry
    // — and render_document already refuses it. Reporting every style here as
    // unknown would bury that under noise.
    expect(lintPage(page([line("x", "anything")], {} as RenderSpec))).toEqual([]);
  });

  it("is quiet on a page whose styles are all defined", () => {
    expect(lintPage(page([line("Phase 1", "banner"), line("a", "bullet")], twoStyles))).toEqual([]);
  });
});

describe("a line longer than its own style allows", () => {
  it("flags it against the limit the SPEC declares", () => {
    const findings = lintPage(page([line("x".repeat(41), "bullet")], twoStyles));

    expect(rulesOf(findings)).toEqual(["page-line-over-max-chars"]);
    expect(findings[0].message).toContain("allows 40");
    expect(findings[0].message).toContain("41");
  });

  it("is quiet at exactly the limit", () => {
    expect(lintPage(page([line("x".repeat(40), "bullet")], twoStyles))).toEqual([]);
  });

  it("says nothing about a style that declares no limit", () => {
    expect(lintPage(page([line("x".repeat(500), "banner")], twoStyles))).toEqual([]);
  });

  it("measures the whole line, runs joined", () => {
    // A line is composed of runs; measuring one run would let a long line
    // through in pieces.
    const split: Block = { kind: "line", style: "bullet", runs: [{ text: "x".repeat(30) }, { text: "y".repeat(30) }] };
    expect(rulesOf(lintPage(page([split], twoStyles)))).toEqual(["page-line-over-max-chars"]);
  });
});

describe("more pictures than the geometry allows", () => {
  const capped = { images: { maxPerSection: 2 } } as RenderSpec;

  it("flags a page over the cap", () => {
    const findings = lintPage(page([picture("a.png"), picture("b.png"), picture("c.png")], capped, ["a.png", "b.png", "c.png"]));

    expect(rulesOf(findings)).toContain("page-images-over-cap");
    expect(findings[0].message).toContain("allows 2");
  });

  it("tells the reader to check the cap before cutting the page", () => {
    // The live ci/maths bag still carries a two-image ceiling its prose dropped,
    // so cropping a good page to satisfy it would be the wrong repair.
    const findings = lintPage(page([picture("a.png"), picture("b.png"), picture("c.png")], capped, ["a.png", "b.png", "c.png"]));
    expect(findings[0].fix).toMatch(/CHECK WHICH before you cut/);
  });

  it("is quiet at the cap, and when no cap is declared", () => {
    expect(lintPage(page([picture("a.png"), picture("b.png")], capped, ["a.png", "b.png"]))).toEqual([]);
    expect(lintPage(page([picture("a.png"), picture("b.png"), picture("c.png")], {} as RenderSpec, ["a.png", "b.png", "c.png"]))).toEqual([]);
  });
});

describe("a picture the document does not carry", () => {
  it("flags it — the renderer would substitute a DIFFERENT picture", () => {
    const findings = lintPage(page([picture("missing.png")], twoStyles, ["present.png"]));

    expect(rulesOf(findings)).toEqual(["page-missing-media"]);
    expect(findings[0].message).toContain("'missing.png'");
    // The reason this one must not be shipped past: docx.ts resolves an
    // unknown media name with `?? "rId1"`, so the page comes out looking
    // finished with the wrong image in that slot.
    expect(findings[0].fix).toMatch(/FIRST picture/);
  });

  it("reports each missing name once, however many times it is placed", () => {
    const findings = lintPage(page([picture("gone.png"), picture("gone.png")], twoStyles, []));
    expect(findings[0].message).toContain("1 picture(s)");
  });

  it("is quiet when every picture is carried", () => {
    expect(lintPage(page([picture("a.png")], twoStyles, ["a.png"]))).toEqual([]);
  });
});

describe("the per-node escape hatch reaches the page rules too", () => {
  it("silences exactly the named rule and no other", () => {
    const bad = [line("x".repeat(41), "bullet"), picture("missing.png")];
    // Both rules fire without the hatch…
    expect(rulesOf(lintPage(page(bad, twoStyles, []))).sort())
      .toEqual(["page-line-over-max-chars", "page-missing-media"]);
    // …and silencing one leaves the other standing, which is what makes the
    // hatch usable: it is declared per rule, on the node, with no deploy.
    expect(rulesOf(lintPage(page(bad, twoStyles, [], ["page-line-over-max-chars"]))))
      .toEqual(["page-missing-media"]);
  });
});

describe("the rule set", () => {
  it("declares a stable id and a summary for each rule, so rulesPending can list them", () => {
    expect(PAGE_RULES.map((rule) => rule.id)).toEqual([
      "page-unknown-block-style", "page-line-over-max-chars", "page-images-over-cap", "page-missing-media",
    ]);
    expect(PAGE_RULES.every((rule) => rule.summary.length > 20)).toBe(true);
  });

  it("reports every finding against the node the page was composed for", () => {
    const findings = lintPage(page([line("x", "ghost"), picture("gone.png")], twoStyles, []));
    expect(findings.every((finding) => finding.nodeId === "sec-1")).toBe(true);
  });
});
