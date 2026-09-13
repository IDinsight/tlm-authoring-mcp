/*
 * The pupil book's declared geometry against the lessons that were delivered.
 *
 * The twenty delivered lessons of the Outil de l'élève (Leçons 1–20, French
 * and Wolof, 38 of 40 files at two pages — Leçon 5 is a one-session lesson on
 * one page) are the reference, measured the way the fiches were and pinned in
 * test/fixtures/reference-pupil-1-20.json. The renderer draws a picture AT
 * its role's cap, so a cap above any delivered size is a page unlike anything
 * delivered; a body size above the delivered one is a lesson that no longer
 * fits two pages. Before this bag existed the formatter carried prose only,
 * and render_document refused every pupil page.
 *
 * Reads the ci/maths fixture graph, so it holds the formatter as published.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES = join(process.cwd(), "test", "fixtures");
const reference = JSON.parse(readFileSync(join(FIXTURES, "reference-pupil-1-20.json"), "utf8"));
const graph = JSON.parse(readFileSync(join(FIXTURES, "senegal", "ci", "maths", "knowledge_graph.json"), "utf8"));
const titleOf = (n: any) => String(n?.properties?.description ?? "").split("\n")[0].trim();
const formatter = graph.nodes.find((n: any) => (n.labels ?? []).includes("Formatter") && /^CI maths V2 — production et typographie de l'Outil de l'élève$/.test(titleOf(n)));
const render = formatter?.properties?.render ?? {};
const images = render.images ?? {};

describe("the pupil formatter's geometry stays within the delivered lessons (Leçons 1–20)", () => {
  it("has a reference to compare with — twenty lessons, two pages each but the one-session Leçon 5", () => {
    expect(reference.lessons).toBe(20);
    const pages = Object.entries(reference.pages) as [string, number][];
    expect(pages.length).toBe(40);
    for (const [file, count] of pages) expect(count, file).toBe(/:5$/.test(file) ? 1 : 2);
    expect(reference.pictures.bande.count).toBeGreaterThan(100);
  });

  it("carries a render bag at all — the pupil formatters had none until 2026-09-13", () => {
    expect(render.page).toBeDefined();
    expect(render.type).toBeDefined();
    expect(render.budget?.maxPages).toBe(2);
  });

  it("keeps the page and type the delivered lessons have", () => {
    for (const side of ["top", "bottom", "left", "right"]) expect(render.page?.marginsCm?.[side], side).toBeCloseTo(reference.margins[side], 1);
    expect(render.type?.family).toBe(reference.family);
    expect(render.type?.sizePt).toBeLessThanOrEqual(reference.sizePt);
    expect(render.blocks?.["en-tete"]?.sizePt).toBeLessThanOrEqual(reference.headerLinePt);
    expect(render.blocks?.["question-orale"]?.sizePt).toBeLessThanOrEqual(reference.oralQuestionPt);
  });

  it("caps a band no taller and no wider than any delivered band, and never floats it", () => {
    expect(images.maxHeightCm?.bande).toBeLessThanOrEqual(reference.pictures.bande.heightMax);
    expect(images.maxWidthCm).toBeLessThanOrEqual(reference.pictures.bande.widthMax);
    expect(reference.pictures.bande.floated).toBe(0);
    expect(images.placement).not.toMatch(/^float/);
  });

  it("caps the scene and the notion image no taller than any delivered one", () => {
    expect(images.maxHeightCm?.amorce).toBeLessThanOrEqual(reference.pictures.scene.heightMax);
    expect(images.maxHeightCm?.["je-retiens"]).toBeLessThanOrEqual(reference.pictures.notion.heightMax);
  });

  it("places the section pictograms and the shape markers at their delivered sizes", () => {
    // Two sizes in the corpus: the pictogram in the margin at 0.42, the shape
    // marker at the head of a directive at about 1 cm. The answer sign under a
    // cell is in no delivered file yet (that rule is newer than the corpus), so
    // it is held to the marker's ceiling rather than to a measurement.
    expect(images.inlineHeightCm?.["picto-section"]).toBeCloseTo(reference.pictures.picto.heightMax, 2);
    expect(images.inlineHeightCm?.repere).toBeLessThanOrEqual(reference.pictures.repere.heightMax);
    expect(images.inlineHeightCm?.repere).toBeGreaterThan(reference.pictures.picto.heightMax);
    expect(images.inlineHeightCm?.signe).toBeLessThanOrEqual(reference.pictures.repere.heightMax);
  });

  it("reserves the foot of page 2 the production team asked for", () => {
    expect(render.budget?.reserveBottomCm).toBeGreaterThanOrEqual(1.5);
  });
});
