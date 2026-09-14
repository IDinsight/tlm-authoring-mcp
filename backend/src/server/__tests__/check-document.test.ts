/*
 * check_document — is a document ready to be produced? (curriculum/readiness.ts)
 *
 * Pinned on the ci/maths fixture's two documents, whose state the September
 * migrations left known: both cover curriculum through their sections, both
 * carry a formatter with layout settings, the teacher guide carries a grid
 * and the pupil book does not, and a routine reaches both through the course
 * they cover. Then a document built bare — create_document, nothing else —
 * must come back NOT ready, each gap naming its verb. The report never blocks:
 * a not-ready document is a report, not an error.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { seedStore, seededContexts, CI_MATHS, CURATOR, withActiveContext as inContext } from "../../__tests__/index.js";
import { __setKgStoreForTest, kgNamespace, __resetMutationsForTest, __resetDraftTokensForTest } from "../../kg-store/index.js";
import { getActiveAdapter } from "../../adapters/index.js";
import { documentReadiness } from "../../curriculum/index.js";
import { runCheckDocument } from "../document-readiness.js";
import { runCreateDocument } from "../document-authoring.js";
import type { KgNodeStore } from "../../kg-store/index.js";
import type { Actor } from "../../actor.js";

let store: KgNodeStore;
const SEED_CONTEXTS = [CI_MATHS];
const contexts = seededContexts(SEED_CONTEXTS);
const targetCtx = contexts.find((c) => c.grade === "ci" && c.subject === "maths")!;
const ns = kgNamespace(targetCtx.workspace, targetCtx.grade, targetCtx.subject);
const withActiveContext = <T>(actor: Actor | null, fn: () => Promise<T>): Promise<T> => inContext(targetCtx, actor, fn);

let pupilBookId: string;
let teacherGuideId: string;
let lessonId: string;

const statusOf = (report: { checks: { id: string; status: string }[] }, id: string) => report.checks.find((c) => c.id === id)!.status;

beforeEach(async () => {
  store = await seedStore({ only: SEED_CONTEXTS });
  __setKgStoreForTest(store);
  __resetMutationsForTest();
  __resetDraftTokensForTest();
  await withActiveContext(CURATOR, async () => {
    const raw = getActiveAdapter().model().rawGraph!;
    const titleOf = (n: any) => String(n.properties?.description ?? "").split("\n")[0];
    const documents = raw.nodes.filter((n) => (n.labels ?? []).includes("TeachingLearningMaterial"));
    pupilBookId = documents.find((n) => /^Outil de l'élève$/.test(titleOf(n)))!.id;
    teacherGuideId = documents.find((n) => /^Guide/.test(titleOf(n)))!.id;
    lessonId = raw.nodes.find((n) => (n.labels ?? []).includes("Lesson"))!.id;
  });
});
afterAll(() => { __setKgStoreForTest(null); });

describe("documentReadiness — the two live documents", () => {
  it("finds the pupil book producible: covers, sections, formatter, layout settings", async () => {
    const report = await withActiveContext(CURATOR, async () => documentReadiness(getActiveAdapter().model(), pupilBookId)!);
    expect(report.ready).toBe(true);
    for (const id of ["covers", "sections", "formatter", "render", "routine"]) expect(statusOf(report, id), id).toBe("ok");
    // No grid on the pupil book yet: reported, not failed.
    expect(statusOf(report, "rubric")).toBe("info");
    expect(report.checks.find((c) => c.id === "rubric")!.fix).toMatch(/use_rubric/);
  });

  it("finds the teacher guide producible, with its grid", async () => {
    const report = await withActiveContext(CURATOR, async () => documentReadiness(getActiveAdapter().model(), teacherGuideId)!);
    expect(report.ready).toBe(true);
    expect(statusOf(report, "rubric")).toBe("ok");
    expect(statusOf(report, "render")).toBe("ok");
  });

  it("returns null for a node that is not a document", async () => {
    const report = await withActiveContext(CURATOR, async () => {
      const raw = getActiveAdapter().model().rawGraph!;
      const lesson = raw.nodes.find((n) => (n.labels ?? []).includes("Lesson"))!;
      return documentReadiness(getActiveAdapter().model(), lesson.id);
    });
    expect(report).toBeNull();
  });
});

describe("check_document — a bare new document", () => {
  it("is not ready, and every gap names the verb that closes it", async () => {
    const created = await withActiveContext(CURATOR, async () => {
      // By id: a lesson often shares its title with the standard it teaches, and an id resolves to itself.
      const preview = await runCreateDocument({ name: "Cahier d'exercices", covers: lessonId });
      expect(preview.phase, JSON.stringify(preview)).toBe("preview");
      return runCreateDocument({ name: "Cahier d'exercices", covers: lessonId, confirm: true, confirmationToken: preview.confirmationToken as string, mintedNodeId: (preview.mintedNodeIds as string[])[0] });
    });
    expect(created.ok, JSON.stringify(created)).toBe(true);

    const out = await withActiveContext(CURATOR, () => runCheckDocument({ document: "Cahier d'exercices" }));
    expect(out.error, JSON.stringify(out)).toBeUndefined();
    expect(out.readFrom).toBe("draft");
    expect(out.ready).toBe(false);
    const checks = out.checks as { id: string; status: string; fix?: string }[];
    const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(byId.covers.status).toBe("ok");                 // create_document wired it
    expect(byId.sections.status).toBe("missing");
    expect(byId.sections.fix).toMatch(/add_section/);
    expect(byId.formatter.status).toBe("missing");
    expect(byId.formatter.fix).toMatch(/use_formatter/);
    expect(byId.render.status).toBe("missing");
    expect(byId.rubric.status).toBe("info");
    expect(String(out.summary)).toMatch(/cannot be produced yet/);
  });

  it("insists on a document name, and resolves it", async () => {
    const missing = await withActiveContext(CURATOR, () => runCheckDocument({}));
    expect(String(missing.error)).toMatch(/`document` is required/);
    const byName = await withActiveContext(CURATOR, () => runCheckDocument({ document: "Outil de l'élève" }));
    expect((byName.document as { id: string }).id).toBe(pupilBookId);
    expect(byName.ready).toBe(true);
  });
});
