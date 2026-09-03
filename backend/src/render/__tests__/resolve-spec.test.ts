/*
 * Merging a formatter stack into one render spec.
 *
 * The interesting case is not "does it merge" but WHAT A SHALLOW MERGE WOULD
 * COST. A section that overrides one margin must not silently lose the page
 * size — that failure renders a Letter-sized sheet, 1.8 cm short per page, and
 * this project has already shipped a full production run that way once.
 */
import { describe, it, expect } from "vitest";
import { resolveRenderSpec, type SpecCarrier } from "../resolve-spec.js";

const spec = (id: string, render: unknown): SpecCarrier =>
  ({ id, properties: { raw: { render } as Record<string, unknown> } });

const DOC_WIDE = spec("doc-wide", {
  page: { size: "A4", marginsCm: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 } },
  type: { family: "Andika", sizePt: 12, leadingPt: 15.5, leadingRule: "exact" },
  blocks: { phaseBanner: { fill: "79D0F0", bold: true } },
});

describe("nearest wins", () => {
  it("lets a section override one value and inherit the rest", () => {
    const r = resolveRenderSpec([DOC_WIDE, spec("section", { type: { sizePt: 11 } })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.type?.sizePt).toBe(11);
    expect(r.spec.type?.family).toBe("Andika");
    expect(r.spec.type?.leadingRule).toBe("exact");
  });

  it("MERGES DEEPLY, so overriding one margin keeps the page size", () => {
    // The whole reason this is a deep merge. A shallow one replaces `page`
    // wholesale, `size` goes missing, and python-docx's Letter default is what
    // cropped 1.8 cm off every page of a real production run.
    const r = resolveRenderSpec([DOC_WIDE, spec("section", { page: { marginsCm: { top: 1.3 } } })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.page?.size).toBe("A4");
    expect(r.spec.page?.marginsCm?.top).toBe(1.3);
    expect(r.spec.page?.marginsCm?.left).toBe(2.5);
  });

  it("adds a block style without erasing the ones already declared", () => {
    const r = resolveRenderSpec([DOC_WIDE, spec("section", { blocks: { bullet: { marker: "•" } } })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.spec.blocks ?? {}).sort()).toEqual(["bullet", "phaseBanner"]);
  });

  it("REPLACES an array rather than concatenating it", () => {
    // Redeclaring language.variants means those variants, not those plus the
    // ones being overridden — otherwise a French-only section would still emit
    // a Wolof file.
    const base = spec("doc", { language: { strategy: "per-file", variants: [
      { id: "fr", lang: "fr", fileSuffix: "-FR" }, { id: "wo", lang: "wo", fileSuffix: "-WO" },
    ] } });
    const r = resolveRenderSpec([base, spec("section", { language: { variants: [
      { id: "fr", lang: "fr", fileSuffix: "-FR" },
    ] } })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.language?.variants).toHaveLength(1);
    expect(r.spec.language?.strategy).toBe("per-file");
  });
});

describe("what it skips and what it refuses", () => {
  it("ignores a formatter that is only prose", () => {
    const prose: SpecCarrier = { id: "prose", properties: { raw: { content: "Un bandeau…" } } };
    const r = resolveRenderSpec([DOC_WIDE, prose]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.from).toEqual(["doc-wide"]);
    expect(r.spec.type?.sizePt).toBe(12);
  });

  it("reports which formatters contributed, so a value can be traced back", () => {
    const r = resolveRenderSpec([DOC_WIDE, spec("section", { type: { sizePt: 11 } })]);
    expect(r.ok && r.from).toEqual(["doc-wide", "section"]);
  });

  it("resolves to an empty spec when nothing declares anything", () => {
    const r = resolveRenderSpec([]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec).toEqual({});
  });

  it("refuses a stack that merges into something invalid, naming the path", () => {
    const r = resolveRenderSpec([DOC_WIDE, spec("bad", { type: { leadingRule: "tight" } })]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("render.type.leadingRule");
  });

  it("refuses here rather than rendering a document nobody can explain", () => {
    // An override can only be caught after merging: each half is fine alone.
    const r = resolveRenderSpec([DOC_WIDE, spec("bad", { page: { size: "A6" } })]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain("render.page.size");
  });
});
