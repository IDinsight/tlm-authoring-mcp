/*
 * The declared image geometry against the fiches that were delivered.
 *
 * The renderer draws a picture AT its role's cap, so the caps are sizes. The
 * ten delivered fiches of Leçons 21–30 (two pages each, accepted by the
 * experts) are the reference: measured by scripts/measure-fiches.mjs and
 * pinned in test/fixtures/reference-fiches-21-30.json. A geometry that draws
 * bands taller or wider than any delivered band, or that sends bands full
 * width at a proportion the delivered fiches float, is a regression the 12
 * September note found by hand — three floated bands stacking and cropping.
 * This makes it a failing test instead.
 *
 * Reads the ci/maths fixture graph, so it holds the formatter as published.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES = join(process.cwd(), "test", "fixtures");
const reference = JSON.parse(readFileSync(join(FIXTURES, "reference-fiches-21-30.json"), "utf8"));
const graph = JSON.parse(readFileSync(join(FIXTURES, "senegal", "ci", "maths", "knowledge_graph.json"), "utf8"));
const titleOf = (n: any) => String(n?.properties?.description ?? "").split("\n")[0].trim();
const formatter = graph.nodes.find((n: any) => (n.labels ?? []).includes("Formatter") && /^Guide de l'enseignant — gabarit répété d'une fiche$/.test(titleOf(n)));
const images = formatter?.properties?.render?.images ?? {};

describe("the teacher formatter's image geometry stays within the delivered fiches (Leçons 21–30)", () => {
  it("has a reference to compare with — ten fiches, two pages each", () => {
    expect(reference.fiches).toBe(10);
    expect(reference.pages.every((p: number) => p === 2)).toBe(true);
    expect(reference.pictures.bande.count).toBeGreaterThan(50);
  });

  it("caps a band no taller and no wider than any delivered band", () => {
    expect(images.maxHeightCm?.bande).toBeLessThanOrEqual(reference.pictures.bande.heightMax);
    expect(images.maxWidthCm).toBeLessThanOrEqual(reference.pictures.bande.widthMax);
  });

  it("caps a scene no taller than any delivered scene", () => {
    for (const role of ["amorce", "notion", "scene"]) {
      expect(images.maxHeightCm?.[role], role).toBeLessThanOrEqual(reference.pictures.scene.heightMax);
    }
  });

  it("does not send full width a band the delivered fiches float — the threshold sits above every delivered proportion", () => {
    // Every one of the delivered bands floats, 63 of 76 above 4:1. A threshold
    // inside that range would lay most of a fiche out unlike anything delivered.
    expect(reference.pictures.bande.floated).toBe(reference.pictures.bande.count);
    if (images.fullWidthAboveAspectRatio !== undefined) {
      expect(images.fullWidthAboveAspectRatio).toBeGreaterThan(reference.pictures.bande.ratioMax);
    }
  });

  it("keeps the page and type the delivered fiches have", () => {
    const page = formatter?.properties?.render?.page?.marginsCm ?? {};
    for (const side of ["top", "bottom", "left", "right"]) expect(page[side], side).toBeCloseTo(reference.margins[side], 1);
    expect(formatter?.properties?.render?.type?.sizePt).toBe(reference.sizePt);
  });
});
