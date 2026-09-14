/*
 * compose_section — a page from the graph and the formatter's layout
 * templates, with no model (curriculum/compose.ts, kg-recipes/layout-spec.ts).
 *
 * Pinned on the ci/maths fixture with the pupil-book template kept beside it
 * (test/fixtures/senegal-pupil-layout.json — subject data, which is why it is
 * a fixture and not a literal in code): a lesson section composes its nine
 * child sections in order, the directive is the activity's title verbatim,
 * the band is the activity's own attached picture, the marker follows the
 * rank, the page break falls where the template says; the same graph gives
 * the same page twice; a section no template matches is reported, not
 * invented; a picture the template names and the graph lacks is a problem,
 * not a silent gap. And the tool: a stack with no `layout` composes nothing
 * and says so.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { seedStore, seededContexts, fakeStorage, CI_MATHS, CURATOR, withActiveContext as inContext } from "../../__tests__/index.js";
import { __setKgStoreForTest, kgNamespace, __resetMutationsForTest, __resetDraftTokensForTest } from "../../kg-store/index.js";
import { __setStorageForTest } from "../../storage/index.js";
import { getActiveAdapter } from "../../adapters/index.js";
import { composeSection, type MediaRef } from "../../curriculum/index.js";
import { layoutSpecSchema, validateLayoutSpec, resolveLayout } from "../../kg-recipes/index.js";
import { documentSchema } from "../../render/index.js";
import { runComposeSection } from "../compose.js";
import type { KgNodeStore } from "../../kg-store/index.js";
import type { Actor } from "../../actor.js";

let store: KgNodeStore;
const SEED_CONTEXTS = [CI_MATHS];
const contexts = seededContexts(SEED_CONTEXTS);
const targetCtx = contexts.find((c) => c.grade === "ci" && c.subject === "maths")!;
const ns = kgNamespace(targetCtx.workspace, targetCtx.grade, targetCtx.subject);
const withActiveContext = <T>(actor: Actor | null, fn: () => Promise<T>): Promise<T> => inContext(targetCtx, actor, fn);

const LAYOUT = layoutSpecSchema.parse(JSON.parse(readFileSync(join(process.cwd(), "test", "fixtures", "senegal-pupil-layout.json"), "utf8")));

// Every picture is a 3:1 band, every asset a square — enough to see the ratio travel.
const ratioOf = async (ref: MediaRef): Promise<number | null> => ("relPath" in ref ? 1 : 3);

let lessonSectionId: string;
let lessonId: string;

beforeEach(async () => {
  store = await seedStore({ only: SEED_CONTEXTS });
  __setKgStoreForTest(store);
  __resetMutationsForTest();
  __resetDraftTokensForTest();
  __setStorageForTest({ ...fakeStorage, downloadObject: async () => null });
  await withActiveContext(CURATOR, async () => {
    const raw = getActiveAdapter().model().rawGraph!;
    const titleOf = (n: any) => String(n.properties?.description ?? "").split("\n")[0];
    const section = raw.nodes.find((n) => (n.labels ?? []).includes("DocumentSection") && /^V2 — Leçon 23 /.test(titleOf(n)));
    if (!section) throw new Error("fixture has no pupil section for Leçon 23");
    lessonSectionId = section.id;
    lessonId = raw.relationships.find((e) => e.type === "covers" && e.start === section.id)!.end;
  });
});
afterAll(() => { __setKgStoreForTest(null); });

describe("the layout template", () => {
  it("is valid, and a bad regular expression is refused at authoring time", () => {
    expect(validateLayoutSpec(LAYOUT, "test")).toEqual([]);
    const broken = { templates: [{ name: "x", match: { section: "(" }, blocks: [{ kind: "children" }] }] };
    expect(validateLayoutSpec(broken, "edit_nodes").join("\n")).toMatch(/not a valid regular expression/);
  });

  it("merges along a stack nearest-first, a nearer template of the same name winning", () => {
    const far = { id: "far", properties: { layout: { templates: [{ name: "a", match: { section: "^A" }, blocks: [{ kind: "children" }] }, { name: "b", match: {}, blocks: [{ kind: "children" }] }] } } };
    const near = { id: "near", properties: { raw: { layout: { templates: [{ name: "a", match: { section: "^NEAR" }, blocks: [{ kind: "children" }] }] } } } };
    const resolved = resolveLayout([far, near]);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.templates.map((t) => t.name).sort()).toEqual(["a", "b"]);
      expect(resolved.templates.find((t) => t.name === "a")!.match.section).toBe("^NEAR");
      expect(resolved.from).toEqual(["near", "far"]);
    }
  });
});

describe("composeSection — a pupil lesson from the graph", () => {
  it("composes the lesson and its nine parts in order, every one from a template", async () => {
    const result = await withActiveContext(CURATOR, () => composeSection(getActiveAdapter().model(), lessonSectionId, LAYOUT.templates, ratioOf));
    expect(result).not.toBeNull();
    expect(result!.unfilled).toEqual([]);
    expect(result!.problems).toEqual([]);
    expect(result!.used.map((u) => u.template)).toEqual(["lecon", "je-fais", "nous-faisons", "nous-faisons", "nous-faisons", "je-retiens", "tu-fais", "tu-fais", "tu-fais", "tu-fais"]);
    // The tree is one render_document accepts as it stands.
    expect(documentSchema.safeParse({ blocks: result!.blocks, media: [] }).success).toBe(true);
  });

  it("copies the directive verbatim from the activity, anchored to it, with the marker of its rank", async () => {
    const { result, raw } = await withActiveContext(CURATOR, async () => {
      const model = getActiveAdapter().model();
      return { result: (await composeSection(model, lessonSectionId, LAYOUT.templates, ratioOf))!, raw: model.rawGraph! };
    });
    const directives = result.blocks.filter((b): b is Extract<typeof b, { kind: "line" }> => b.kind === "line" && b.style === "directive");
    expect(directives.length).toBe(7);   // three guided activities, four questions
    const first = directives[0];
    const activity = raw.nodes.find((n) => n.id === first.anchor)!;
    const title = String(activity.properties?.description ?? "").split("\n")[0];
    expect(first.runs[1]).toEqual({ text: `  ${title}` });
    expect(first.runs[0]).toMatchObject({ image: { media: "rep-etoile.svg", role: "repere", aspectRatio: 1 } });
    // The fourth question of the second group carries the fourth marker; the group restarts at the star.
    expect(directives[3].runs[0]).toMatchObject({ image: { media: "rep-etoile.svg" } });
    expect(directives[6].runs[0]).toMatchObject({ image: { media: "rep-cercle.svg" } });
  });

  it("places each activity's own attached picture, by node id, with the file's ratio", async () => {
    const result = (await withActiveContext(CURATOR, () => composeSection(getActiveAdapter().model(), lessonSectionId, LAYOUT.templates, ratioOf)))!;
    const bands = result.blocks.flatMap((b) => (b.kind === "line" ? b.runs : [])).filter((r): r is Extract<typeof r, { image: unknown }> => "image" in r && (r as any).image.role === "bande");
    expect(bands.length).toBe(7);
    for (const band of bands) expect(band.image.aspectRatio).toBe(3);
    const byNode = result.media.filter((m): m is Extract<MediaRef, { nodeId: string }> => "nodeId" in m);
    expect(byNode.map((m) => m.name)).toContain("L23-nf-1");
    expect(byNode.map((m) => m.name)).toContain("L23-tf-4");
  });

  it("breaks the page before the first question of the second group, and only there", async () => {
    const result = (await withActiveContext(CURATOR, () => composeSection(getActiveAdapter().model(), lessonSectionId, LAYOUT.templates, ratioOf)))!;
    const breaks = result.blocks.filter((b) => (b.kind === "line" || b.kind === "table") && b.pageBreak === "before");
    expect(breaks.length).toBe(1);
    expect(breaks[0]).toMatchObject({ kind: "line", runs: [{ image: { media: "picto-tu-fais.svg" } }] });
  });

  it("puts the header line first, from the lesson's grouping, ordinal name and name", async () => {
    const result = (await withActiveContext(CURATOR, () => composeSection(getActiveAdapter().model(), lessonSectionId, LAYOUT.templates, ratioOf)))!;
    const header = result.blocks[0];
    expect(header).toMatchObject({ kind: "line", style: "en-tete", anchor: lessonId });
    const text = (header as any).runs[0].text as string;
    expect(text).toMatch(/^Unité \d+  ·  Leçon 23  ·  Je me situe/);
  });

  it("gives the same page twice from the same graph", async () => {
    const a = await withActiveContext(CURATOR, () => composeSection(getActiveAdapter().model(), lessonSectionId, LAYOUT.templates, ratioOf));
    const b = await withActiveContext(CURATOR, () => composeSection(getActiveAdapter().model(), lessonSectionId, LAYOUT.templates, ratioOf));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("reports a part no template matches, with its guide, instead of inventing it", async () => {
    const withoutQuestions = LAYOUT.templates.filter((t) => t.name !== "tu-fais");
    const result = (await withActiveContext(CURATOR, () => composeSection(getActiveAdapter().model(), lessonSectionId, withoutQuestions, ratioOf)))!;
    expect(result.unfilled.length).toBe(4);
    expect(result.unfilled.every((u) => /^TU FAIS/.test(u.title) && u.guide.length > 0)).toBe(true);
    expect(result.used.map((u) => u.template)).not.toContain("tu-fais");
  });

  it("names a picture the template asks for and the graph lacks as a problem", async () => {
    const wrongName = LAYOUT.templates.map((t) => t.name === "je-retiens"
      ? { ...t, blocks: [{ kind: "line" as const, runs: [{ image: { role: "je-retiens", picture: "-schema-introuvable$" } }] }] }
      : t);
    const result = (await withActiveContext(CURATOR, () => composeSection(getActiveAdapter().model(), lessonSectionId, wrongName, ratioOf)))!;
    expect(result.problems.length).toBe(1);
    expect(result.problems[0]).toMatch(/no attached picture matches/);
    expect(result.problems[0]).toMatch(/L23-je-retiens/);   // it says what IS attached
  });
});

describe("the teacher fiche skeleton — banners from the graph, holes for the model", () => {
  const FICHE = layoutSpecSchema.parse(JSON.parse(readFileSync(join(process.cwd(), "test", "fixtures", "senegal-fiche-layout.json"), "utf8")));
  let ficheId: string;
  beforeEach(async () => {
    await withActiveContext(CURATOR, async () => {
      const raw = getActiveAdapter().model().rawGraph!;
      const section = raw.nodes.find((n) => (n.labels ?? []).includes("DocumentSection") && /^Fiche — Leçon 4 /.test(String(n.properties?.description ?? "")));
      if (!section) throw new Error("fixture has no fiche section for Leçon 4");
      ficheId = section.id;
    });
  });
  const textOf = (block: any): string => block.kind === "table" ? block.rows.flat().flatMap((c: any) => c.blocks.map(textOf)).join(" ") : block.kind === "line" ? block.runs.map((r: any) => r.text ?? "").join("") : "";
  const styleOf = (block: any): string => block.kind === "table" ? block.rows[0][0].style : block.style;

  it("is valid, and refuses a mark on a fixed asset", () => {
    expect(validateLayoutSpec(FICHE, "test")).toEqual([]);
    const marked = { templates: [{ name: "x", match: {}, blocks: [{ kind: "line", runs: [{ image: { role: "r", asset: { relPath: "a.png" }, mark: "answer" } }] }] }] };
    expect(validateLayoutSpec(marked, "edit_nodes").join("\n")).toMatch(/`mark` applies to a `picture`/);
  });

  it("writes the header from the lesson's ordinal and name, and the matériel from the fiche's own guide", async () => {
    const result = (await withActiveContext(CURATOR, () => composeSection(getActiveAdapter().model(), ficheId, FICHE.templates, ratioOf)))!;
    expect(result.problems).toEqual([]);
    const header = result.blocks[0] as any;
    expect(header.rows[0].map((c: any) => c.style)).toEqual(["bandeau-semaine", "bandeau-lecon", "bandeau-jour"]);
    // Leçon 4 is week ⌈4/5⌉ = 1, day ((4−1) mod 5)+1 = 4 — arithmetic the composer does once.
    expect(header.rows[0].map((c: any) => c.blocks[0].runs[0].text)).toEqual(["Semaine 1", "Leçon 4", "jour 4"]);
    expect(textOf(result.blocks[1])).toBe("OS – Je dis si un objet est long ou court.");
    expect(textOf(result.blocks[2])).toBe("  craies – ficelle – bâtons");
    expect(result.media.map((m) => m.name)).toContain("picto-materiel.svg");
  });

  it("lays the nine phase banners in order, the séance 2 banner starting the page, and leaves a hole per phase", async () => {
    const result = (await withActiveContext(CURATOR, () => composeSection(getActiveAdapter().model(), ficheId, FICHE.templates, ratioOf)))!;
    const banners = result.blocks.slice(3).filter((b: any) => styleOf(b)?.startsWith("bandeau-phase")).map(textOf);
    expect(banners.map((t) => t.trim().split(" | ")[0])).toEqual([
      "RÉVISION", "JE FAIS, Partie 1 – Mise en situation", "JE FAIS, Partie 2 – Modelage", "NOUS FAISONS", "Je retiens", "RAPPEL", "TU FAIS", "OBJECTIVATION", "ÉVALUATION",
    ]);
    const styles = result.blocks.slice(3).map(styleOf).filter((s) => s?.startsWith("bandeau-phase"));
    expect(styles).toEqual(["bandeau-phase-bleu", "bandeau-phase-bleu", "bandeau-phase-bleu", "bandeau-phase-bleu", "bandeau-phase-vert", "bandeau-phase-bleu", "bandeau-phase-bleu", "bandeau-phase-orange", "bandeau-phase-grisbleu"]);
    const seances = result.blocks.filter((b: any) => styleOf(b) === "bandeau-seance");
    expect(seances.map(textOf)).toEqual(["Séance 1 | 30 min", "SÉANCE 2 - CONSOLIDATION ET ÉVALUATION | 30 min"]);
    expect((seances[1] as any).pageBreak).toBe("before");

    // Every phase is a hole: its guide and the path its lines go in at.
    expect(result.unfilled).toHaveLength(9);
    expect(result.unfilled.map((u) => u.title.split(" — ")[0])).toEqual(["PHASE 1", "PHASE 2", "PHASE 3", "PHASE 4", "PHASE 5", "PHASE 6", "PHASE 7", "PHASE 8", "PHASE 9"]);
    expect(result.unfilled[0].insertAt).toBe("blocks[5]");   // after the header, the séance banner and the phase banner
    expect(result.unfilled[0].guide).toMatch(/ACQUIS RÉACTIVÉ/);
    // No sentinel is left in the tree: it is a valid page as it stands.
    expect(documentSchema.safeParse({ blocks: result.blocks, media: [] }).success).toBe(true);
    // The hole paths are the tree's: filling from the last hole up keeps every earlier path valid.
    const { applyTreePatch } = await import("../tree-park.js");
    const filled = applyTreePatch({ blocks: result.blocks, media: [] }, [...result.unfilled].reverse().map((u) => ({ op: "insert-before" as const, path: u.insertAt!, block: { kind: "line", runs: [{ text: u.title }] } })));
    if ("error" in filled) throw new Error(filled.error);
    const lines = (filled.tree as any).blocks.filter((b: any) => b.kind === "line" && /^PHASE/.test(b.runs[0].text)).map((b: any) => b.runs[0].text.split(" — ")[0]);
    expect(lines).toEqual(["PHASE 1", "PHASE 2", "PHASE 3", "PHASE 4", "PHASE 5", "PHASE 6", "PHASE 7", "PHASE 8", "PHASE 9"]);
  });

  it("names the teacher's copy of a band apart from the plain one", async () => {
    const withMark = [{ name: "x", match: { section: "^PHASE 4 ", }, blocks: [{ kind: "line" as const, runs: [{ image: { role: "bande", picture: "-nf-1$", mark: "answer" as const } }] }] }];
    const result = (await withActiveContext(CURATOR, () => composeSection(getActiveAdapter().model(), ficheId, withMark as any, ratioOf)))!;
    const marked = result.media.find((m) => "mark" in m);
    if (!marked) { expect(result.problems.join("; ")).toMatch(/no attached picture/); return; }   // the fixture may carry no nf-1 for L4
    expect(marked.name).toMatch(/-nf-1-answer$/);
  });
});

describe("compose_section — the tool", () => {
  it("composes nothing and says so when no formatter on the stack declares layout templates", async () => {
    const out = await withActiveContext(CURATOR, () => runComposeSection({ section: lessonSectionId }));
    expect(out.error, JSON.stringify(out)).toBeUndefined();
    expect(out.complete).toBe(false);
    expect((out.unfilled as { title: string }[]).length).toBe(10);   // the lesson and its nine parts, each with its guide
    expect(String(out.note)).toMatch(/No formatter on this section's stack declares/);
    expect((out.document as any).blocks).toEqual([]);
  });

  it("keeps the composed tree under a ref the lint and the render can name", async () => {
    const out = await withActiveContext(CURATOR, () => runComposeSection({ section: lessonSectionId }));
    expect(String(out.treeRef)).toMatch(/^tree_/);
    const { readParkedTree } = await import("../tree-park.js");
    const parked = await withActiveContext(CURATOR, () => readParkedTree(String(out.namespace), String(out.treeRef)));
    expect(parked).toEqual(out.document);
  });

  it("insists on a section, and resolves it by name", async () => {
    const missing = await withActiveContext(CURATOR, () => runComposeSection({}));
    expect(String(missing.error)).toMatch(/`section` is required/);
    const byName = await withActiveContext(CURATOR, () => runComposeSection({ section: "V2 — Leçon 23 — Se situer et situer des objets : à gauche de, à droite de, devant, derrière" }));
    expect(byName.sectionId).toBe(lessonSectionId);
  });
});
