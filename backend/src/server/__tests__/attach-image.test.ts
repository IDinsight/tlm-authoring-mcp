/*
 * attach_image — a picture becomes a `Material` node under the lesson or
 * activity it illustrates (docs/design-notes/illustrations-as-materials.md).
 *
 * The invariant the verb exists for has two halves, and each is pinned here:
 * the file must really be in the bucket (the tool layer's probe), and the
 * node must hang where a picture may (the recipe's check). Then the read side:
 * a section covering that lesson lists the picture, so a composer can place
 * it by id and never transcribes a path.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  seedStore, seededContexts, fakeStorage, CI_MATHS, CURATOR,
  withActiveContext as inContext,
} from "../../__tests__/index.js";
import { __setKgStoreForTest, kgNamespace, __resetMutationsForTest, __resetDraftTokensForTest } from "../../kg-store/index.js";
import { __setStorageForTest } from "../../storage/index.js";
import { getActiveAdapter } from "../../adapters/index.js";
import { runAttachImage } from "../document-authoring.js";
import { walkDocumentSection } from "../graph.js";
import type { KgNodeStore } from "../../kg-store/index.js";
import type { Actor } from "../../actor.js";
import { CONFIG } from "../../config.js";

// The URI a picture keeps in its identifier names the bucket, so the suite needs one.
const BUCKET = "tlm-test-bucket";

let store: KgNodeStore;
const SEED_CONTEXTS = [CI_MATHS];
const contexts = seededContexts(SEED_CONTEXTS);
const targetCtx = contexts.find((c) => c.grade === "ci" && c.subject === "maths")!;
const ns = kgNamespace(targetCtx.workspace, targetCtx.grade, targetCtx.subject);

const withActiveContext = <T>(actor: Actor | null, fn: () => Promise<T>): Promise<T> =>
  inContext(targetCtx, actor, fn);

// The bucket, as the verb sees it: one image is there, nothing else is.
const UPLOADED = "media/lecon-01/bande-1.png";
const bucketWith = (present: string[]) => ({
  ...fakeStorage,
  getObjectMd5: async (relPath: string) => (present.includes(relPath) ? "md5-of-" + relPath : null),
});

// A DocumentSection that covers a Lesson, and that lesson — read off the fixture
// rather than hard-coded, so a reshaped spine fails loudly here.
let sectionId: string;
let lessonId: string;
let lessonTitle: string;
let chapterId: string;

// Dry-run then confirm, the way a caller does.
async function confirmed(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const preview = await runAttachImage(args);
  expect(preview.phase, JSON.stringify(preview)).toBe("preview");
  const mintedNodeIds = preview.mintedNodeIds as string[];
  return runAttachImage({ ...args, confirm: true, confirmationToken: preview.confirmationToken as string, mintedNodeId: mintedNodeIds[0] });
}

beforeAll(() => { __setStorageForTest(bucketWith([UPLOADED])); CONFIG.firebaseBucket = BUCKET; });
beforeEach(async () => {
  store = await seedStore({ only: SEED_CONTEXTS });
  __setKgStoreForTest(store);
  __resetMutationsForTest();
  __resetDraftTokensForTest();
  __setStorageForTest(bucketWith([UPLOADED]));

  await withActiveContext(CURATOR, async () => {
    const raw = getActiveAdapter().model().rawGraph!;
    const byId = new Map(raw.nodes.map((n) => [n.id, n]));
    const pair = raw.relationships.find((e) =>
      e.type === "covers"
      && (byId.get(e.start)?.labels ?? []).includes("DocumentSection")
      && (byId.get(e.end)?.labels ?? []).includes("Lesson"));
    if (!pair) throw new Error("fixture has no DocumentSection covering a Lesson");
    sectionId = pair.start;
    lessonId = pair.end;
    lessonTitle = String((byId.get(lessonId)!.properties as Record<string, unknown>).description ?? "").split("\n")[0];
    chapterId = raw.nodes.find((n) => (n.labels ?? []).includes("LessonGrouping"))!.id;
  });
});
afterAll(() => { __setKgStoreForTest(null); });

describe("attach_image — the file must exist before the graph may point at it", () => {
  it("refuses, naming the path, when nothing is at relPath", async () => {
    const out = await withActiveContext(CURATOR, () =>
      runAttachImage({ to: lessonId, name: "bande-1", description: "Trois colliers", relPath: "media/lecon-01/nope.png" }));
    expect(String(out.error)).toContain("media/lecon-01/nope.png");
    expect(String(out.error)).toMatch(/create_media_upload_url/);
    expect(out.confirmationToken).toBeUndefined();
  });

  it("refuses a file render_document could not embed", async () => {
    __setStorageForTest(bucketWith(["media/lecon-01/notes.pdf"]));
    const out = await withActiveContext(CURATOR, () =>
      runAttachImage({ to: lessonId, name: "notes", description: "x", relPath: "media/lecon-01/notes.pdf" }));
    expect(String(out.error)).toMatch(/not an image/);
  });

  it("creates a COMMISSIONED picture with no file yet, pointing where the file must land", async () => {
    // The illustrator has not drawn it: the node carries the brief and the
    // path; delivery is an upload to that path, with no graph edit.
    const planned = "media/lecon-01/bande-2.png";
    const done = await withActiveContext(CURATOR, () =>
      confirmed({ to: lessonId, name: "bande-2", description: "Deux colliers, celui de Moussa plus long.", relPath: planned, commissioned: true }));
    expect(done.ok, JSON.stringify(done)).toBe(true);
    expect(done.commissioned).toBe(true);
    expect(String(done.note)).toMatch(/No file was checked/);

    const pointer = (await store.readPointer(ns))!;
    const node = (await store.listNodes(ns, pointer.draftSlot!)).find((n) => n.id === (done.mintedNodeIds as string[])[0])!;
    expect((node.properties.raw as Record<string, unknown>).identifier).toMatch(new RegExp(`/documents/${planned}$`));
  });

  it("without `commissioned`, a missing file is still a refusal", async () => {
    const out = await withActiveContext(CURATOR, () =>
      runAttachImage({ to: lessonId, name: "bande-2", description: "x", relPath: "media/lecon-01/bande-2.png", commissioned: false }));
    expect(String(out.error)).toMatch(/No image at/);
  });

  it("insists on a description — that is what makes the picture checkable", async () => {
    const out = await withActiveContext(CURATOR, () =>
      runAttachImage({ to: lessonId, name: "bande-1", relPath: UPLOADED }));
    expect(String(out.error)).toMatch(/what the picture shows/);
  });
});

describe("attach_image — where a picture may hang", () => {
  it("creates a Material under the lesson, with what it shows and where its file is", async () => {
    const done = await withActiveContext(CURATOR, () =>
      confirmed({ to: lessonId, name: "bande-1", description: "Trois colliers de coquillages, celui de Binta au milieu.", relPath: UPLOADED }));
    expect(done.ok, JSON.stringify(done)).toBe(true);
    const pictureId = (done.mintedNodeIds as string[])[0];

    const pointer = (await store.readPointer(ns))!;
    const nodes = await store.listNodes(ns, pointer.draftSlot!);
    const edges = await store.listEdges(ns, pointer.draftSlot!);
    const picture = nodes.find((n) => n.id === pictureId)!;
    const raw = picture.properties.raw as Record<string, any>;

    expect(picture.labels).toContain("Material");
    expect(raw.content).toBe("Trois colliers de coquillages, celui de Binta au milieu.");
    expect(raw.name).toBe("bande-1");
    expect(raw.materialType).toBe("Supporting");
    // The identifier IS the file: a real object URI, bucket + namespace key +
    // the path the upload named — and nothing of ours beside it.
    expect(raw.identifier).toBe(`gs://${BUCKET}/${targetCtx.workspace}/${targetCtx.grade}/${targetCtx.subject}/documents/${UPLOADED}`);
    expect(raw.metadata?.media).toBeUndefined();
    // Hangs under the lesson by the canonical content edge.
    expect(edges.some((e) => e.type === "hasPart" && e.from === lessonId && e.to === pictureId)).toBe(true);
  });

  it("resolves the lesson BY NAME, and an id resolves to itself", async () => {
    const preview = await withActiveContext(CURATOR, () =>
      runAttachImage({ to: lessonTitle, name: "bande-1", description: "x", relPath: UPLOADED }));
    // Either it resolved to that one lesson, or the name is shared and it asks —
    // both are the contract; what it must never do is pick silently.
    if (preview.needsChoice) {
      const candidates = preview.candidates as Array<{ id: string }>;
      expect(candidates.some((c) => c.id === lessonId)).toBe(true);
    } else {
      expect(preview.phase).toBe("preview");
    }
  });

  it("refuses a chapter: a picture illustrates a lesson or an activity", async () => {
    const out = await withActiveContext(CURATOR, () =>
      runAttachImage({ to: chapterId, name: "bande-1", description: "x", relPath: UPLOADED }));
    expect(out.confirmationToken).toBeUndefined();
    expect(JSON.stringify(out)).toMatch(/not a Lesson or an Activity/);
  });

  it("refuses a second picture with the same name under the same lesson", async () => {
    await withActiveContext(CURATOR, () =>
      confirmed({ to: lessonId, name: "bande-1", description: "first", relPath: UPLOADED }));
    const again = await withActiveContext(CURATOR, () =>
      runAttachImage({ to: lessonId, name: "bande-1", description: "second", relPath: UPLOADED }));
    expect(again.confirmationToken).toBeUndefined();
    expect(JSON.stringify(again)).toMatch(/already has a picture named 'bande-1'/);
  });
});

describe("the read side — a section covering the lesson lists its pictures", () => {
  // The fixture is a snapshot of live, which has carried its pictures since the
  // 2026-09-12 migration — so the read is asserted RELATIVE to what is already
  // there, never against an empty list.
  const picturesOf = async (options: Record<string, unknown> = {}) => {
    const scope = await withActiveContext(CURATOR, () => walkDocumentSection({ sectionId, ...options }));
    return scope.pictures as Array<Record<string, unknown>>;
  };

  it("lists the pictures the graph already carries, each with what a composer needs", async () => {
    const pictures = await picturesOf();
    expect(pictures.length).toBeGreaterThan(0);
    for (const picture of pictures) {
      expect(String(picture.name)).toMatch(/^L\d\d-/);
      expect(String(picture.uri)).toMatch(/^gs:\/\/.*\/documents\/media\//);
      expect(String(picture.relPath)).toMatch(/^media\//);
      expect(typeof picture.description).toBe("string");
      expect(typeof picture.illustrates).toBe("string");
    }
  });

  it("walk_document_section returns a newly attached picture with the id a render media entry needs", async () => {
    const before = (await picturesOf()).length;
    const done = await withActiveContext(CURATOR, () =>
      confirmed({ to: lessonId, name: "bande-1", description: "Trois colliers.", relPath: UPLOADED }));
    const pictureId = (done.mintedNodeIds as string[])[0];

    const pictures = await picturesOf({ slot: "draft" });
    expect(pictures.length).toBe(before + 1);
    const picture = pictures.find((p) => p.id === pictureId)!;
    expect(picture).toMatchObject({ name: "bande-1", description: "Trois colliers.", relPath: UPLOADED, contentType: "image/png", illustrates: lessonId });
    expect(String(picture.uri)).toMatch(/^gs:\/\//);
  });

  it("does not mistake a plain Material for a picture — its identifier is no file", async () => {
    // A routine step or a spec is a Material too; only an image URI makes a picture.
    const { runAddNodes } = await import("../authoring.js");
    const before = (await picturesOf()).length;
    await withActiveContext(CURATOR, async () => {
      const items = [{ kind: "Material", parentId: lessonId, description: "Consigne", properties: { content: "Lis l'énoncé." } }];
      const dry = await runAddNodes({ items });
      await runAddNodes({ items, confirm: true, confirmationToken: dry.confirmationToken as string, mintedNodeIds: dry.mintedNodeIds as string[] });
    });
    expect((await picturesOf({ slot: "draft" })).length).toBe(before);
  });

  it("keeps the list even when the caller asks for the section alone", async () => {
    const full = await picturesOf();
    const alone = await picturesOf({ include: [] });
    expect(alone.length).toBe(full.length);
    expect(alone.length).toBeGreaterThan(0);
  });
});
