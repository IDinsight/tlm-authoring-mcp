/*
 * lint_content with a composed page — the wiring, not the rules.
 *
 * The rules themselves are pinned in curriculum/__tests__/lint-page.test.ts.
 * What is under test here is the part that decides whether a rule can say
 * anything at all, and the property that matters is this:
 *
 *   A REFUSAL AND A CLEAN PAGE MUST NOT LOOK THE SAME.
 *
 * Every page rule reads a limit out of the merged `render` spec, so with no spec
 * to read every one of them returns nothing — which is byte-for-byte what a
 * flawless page returns. This exact shape has already cost real work once: a
 * render test staged a bag, asserted no error, and passed while rendering
 * against an EMPTY spec, and `render_document` reported `formatters: []`, which
 * reads both as "success" and as "no formatters found". An expert trusted it and
 * rebuilt a bilingual layout by hand.
 *
 * So each way of not being able to check comes back as its own refusal, naming
 * what is missing and what to do — and the tests below are mostly about that.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { seedStore, seededContexts, fakeStorage, CE1_READING, CURATOR } from "../../__tests__/index.js";
import { newSessionState, runInSession } from "../../context/index.js";
import { __setKgStoreForTest, __resetMutationsForTest, type KgNodeStore } from "../../kg-store/index.js";
import { __setStorageForTest } from "../../storage/index.js";
import { __setActorForTest, type Actor } from "../../actor.js";
import { activateContext } from "../../activate.js";
import { getActiveAdapter } from "../../adapters/index.js";
import { runLintContent } from "../check.js";

const ctx = seededContexts([CE1_READING]).find((c) => c.grade === "ce1" && c.subject === "reading")!;

let store: KgNodeStore;

async function withCtx<T>(actor: Actor | null, fn: () => Promise<T>): Promise<T> {
  return runInSession(newSessionState(), async () => {
    __setActorForTest(actor);
    const activation = await activateContext(ctx.workspace, ctx.grade, ctx.subject);
    if (!activation.ok) throw new Error(`activate: ${activation.error}`);
    return fn();
  });
}

/** A DocumentSection from the fixture — read off the graph, never invented. */
function aSectionId(): string {
  const raw = getActiveAdapter().model().rawGraph!;
  const section = raw.nodes.find((node) => (node.labels ?? []).includes("DocumentSection"));
  if (!section) throw new Error("fixture has no DocumentSection");
  return section.id;
}

const TREE = { blocks: [{ kind: "line", style: "bullet", runs: [{ text: "Regardez bien." }] }] };

beforeEach(async () => {
  __resetMutationsForTest?.();
  store = await seedStore({ only: [CE1_READING] });
  __setKgStoreForTest(store);
  __setStorageForTest(fakeStorage);
});
afterAll(() => { __setKgStoreForTest(null); });

describe("not being able to check is never reported as a clean page", () => {
  it("refuses a `document` with no `nodeId` — there is no geometry without one", async () => {
    const result = await withCtx(CURATOR, () => runLintContent({ document: TREE }));

    expect(String((result.page as any).error)).toMatch(/needs `nodeId`/);
    // And it did NOT quietly report the page rules as having run.
    expect(result.rulesRun).not.toContain("page-missing-media");
    expect((result.rulesPending as any[]).some((rule) => rule.id === "page-missing-media")).toBe(true);
  });

  it("refuses a tree that is not a valid block tree, in the renderer's own words", async () => {
    const result = await withCtx(CURATOR, async () =>
      runLintContent({ document: { blocks: [{ kind: "line", bold: true, runs: [] }] }, nodeId: aSectionId() }));

    // Reusing validateDocumentTree rather than re-implementing it means a page
    // refused here is refused at render time for the same reason, in the same
    // words — `bold` is geometry, and a line may not carry it.
    expect(String((result.page as any).error)).toMatch(/not a valid block tree/);
    expect(String((result.page as any).error)).toMatch(/bold/);
  });

  it("refuses a nodeId that carries no formatter stack", async () => {
    const result = await withCtx(CURATOR, () => runLintContent({ document: TREE, nodeId: "no-such-node" }));
    expect(String((result.page as any).error)).toMatch(/neither a DocumentSection nor a TeachingLearningMaterial/);
  });

  it("refuses when the stack carries NO render geometry, and says it is a refusal", async () => {
    // The live state of both subjects: formatters that are pure prose. Every
    // page rule would find nothing, which is indistinguishable from a clean
    // page — so this says which of the two it is, in those words.
    const result = await withCtx(CURATOR, () => runLintContent({ document: TREE, nodeId: aSectionId() }));

    const error = String((result.page as any).error);
    expect(error).toMatch(/no geometry to check this page against/);
    expect(error).toMatch(/REFUSAL, not a pass/);
    // It also points at the fix and at the tool that refuses for the same reason.
    expect(error).toMatch(/render_document refuses for the same reason/);
  });
});

describe("what a caller is told about coverage", () => {
  it("lists the page rules as pending, with what they need, when no page is sent", async () => {
    const result = await withCtx(CURATOR, () => runLintContent({}));

    const pending = result.rulesPending as { id: string; needs: string }[];
    const pageRule = pending.find((rule) => rule.id === "page-unknown-block-style");
    expect(pageRule?.needs).toMatch(/composed page/);
    // The note says how to check a page rather than leaving it to be discovered.
    expect(String(result.note)).toMatch(/pass `document`.*`nodeId`/);
  });

  it("still runs the GRAPH rules when the page half refuses", async () => {
    // A refusal on one half must not cost the other: the graph findings are
    // exactly what they would be with no page sent at all.
    const withPage = await withCtx(CURATOR, () => runLintContent({ document: TREE, nodeId: aSectionId() }));
    const withoutPage = await withCtx(CURATOR, () => runLintContent({}));

    expect(withPage.count).toBe(withoutPage.count);
    expect(withPage.rulesRun).toEqual(withoutPage.rulesRun);
  });
});
