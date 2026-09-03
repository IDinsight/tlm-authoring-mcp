/*
 * render_document — a composed page in, a .docx out.
 *
 * The step that used to happen on somebody's laptop, and the one the whole
 * roadmap turns on: until this existed, "self-serve authoring" meant self-serve
 * right up to the moment you wanted a document.
 *
 * What is under test is the DIVISION, more than the bytes:
 *
 *   • the model brings the STRUCTURE (a block tree) and nothing else — a tree
 *     carrying geometry is refused;
 *   • the formatter brings the GEOMETRY, merged from the node's own stack in
 *     application order;
 *   • neither half is guessed at when the other is wrong: an invalid tree or an
 *     unresolvable stack renders NOTHING and names the path.
 *
 * Plus the isolation preview_generation already has: output to the segregated
 * previews/ prefix, never the canonical bucket or history.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { seedStore, seededContexts, CE1_READING, CURATOR, APPROVER, SIGNED_IN_NO_ROLE } from "../../__tests__/index.js";
import { newSessionState, runInSession, previewKey } from "../../context/index.js";
import { __setKgStoreForTest, __resetMutationsForTest } from "../../kg-store/index.js";
import { __setStorageForTest } from "../../storage/index.js";
import { __setActorForTest, type Actor } from "../../actor.js";
import { activateContext } from "../../activate.js";
import { runEditNodes } from "../recipes.js";
import { renderDocument, proposeFromDocument } from "../render.js";
import { checkStale } from "../documents.js";
import { unzip, documentSchema } from "../../render/index.js";
import { CONFIG } from "../../config.js";
import type { StorageAdapter, HistoryFile } from "../../types.js";

// Gemini is stubbed: the point under test is the WIRING — that a missing
// language reaches the translator, comes back grounded in the glossary, and
// lands in its own file — not that Gemini translates. A real call here would
// spend metered budget on every test run.
const translated: { text: string; direction: string; glossaryTerms: number }[] = [];
vi.mock("../../translation/index.js", () => ({
  translate: async (input: { text: string; direction: string; glossary?: unknown[] }) => {
    translated.push({ text: input.text, direction: input.direction, glossaryTerms: (input.glossary ?? []).length });
    return { translation: `wo:${input.text}`, sourceLanguage: "French", targetLanguage: "Wolof", model: "stub", glossaryTermsUsed: 0 };
  },
}));

const emptyHistory: HistoryFile = { version: 4, entries: [] };
let canonicalUploads = 0;
let historyWrites = 0;
// Captures every PUT, keyed by object key, so the test can open each produced
// file — a per-file document writes more than one.
let uploaded: Buffer | null = null;
const uploads: { key: string; body: Buffer }[] = [];
let nextKey = "";

const storage: StorageAdapter = {
  listDocuments: async () => [],
  getObjectMd5: async () => null,
  downloadDocx: async () => Buffer.from(""),
  createUploadUrl: async () => { canonicalUploads++; return { url: "", objectKey: "", contentType: "", expiresAt: "" }; },
  createDownloadUrl: async () => ({ url: "", objectKey: "", expiresAt: "", exists: false }),
  createPreviewUpload: async (relPath) => {
    nextKey = previewKey(relPath);
    return {
      uploadUrl: "https://signed/put", downloadUrl: `https://signed/get/${relPath}`,
      objectKey: nextKey, contentType: "docx", expiresAt: "1970-01-01T00:10:00Z",
    };
  },
  readHistory: async () => emptyHistory,
  writeHistory: async () => { historyWrites++; },
};

const realFetch = globalThis.fetch;
// Registering the fixture contexts has to happen before one can be activated,
// so it runs at module load, the way every other suite here does it.
const ctx = seededContexts([CE1_READING]).find((c) => c.grade === "ce1" && c.subject === "reading")!;

// The one FormatterSpec this suite gives a render bag to, and a section whose
// stack reaches it. Both are read off the fixture rather than invented, so the
// test breaks if the fixture's document layer changes shape.
let specId: string;
let sectionId: string;

async function withCtx<T>(actor: Actor | null, fn: () => Promise<T>): Promise<T> {
  return runInSession(newSessionState(), async () => {
    __setActorForTest(actor);
    const activation = await activateContext(ctx.workspace, ctx.grade, ctx.subject);
    if (!activation.ok) throw new Error(`activate: ${activation.error}`);
    return fn();
  });
}

// A minimal page: a banner whose cell holds a line, one bulleted line, and a
// second banner that starts a page. Enough to exercise style lookup, the
// language variant, the marker and the break carrier.
const TREE = {
  blocks: [
    { kind: "table", rows: [[{ style: "sessionBanner", blocks: [
      { kind: "line", runs: [{ text: "Séance 1" }] },
    ] }]] },
    { kind: "line", style: "bullet", variant: "fr", runs: [{ text: "Regardez bien." }] },
    { kind: "table", pageBreak: "before", rows: [[{ style: "sessionBanner", blocks: [
      { kind: "line", runs: [{ text: "Séance 2" }] },
    ] }]] },
  ],
};

const RENDER_BAG = {
  page: { size: "A4", marginsCm: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 } },
  type: { family: "Andika", sizePt: 12, leadingPt: 15.5, leadingRule: "exact" },
  blocks: { sessionBanner: { fill: "09A9E1", textColour: "FFFFFF", bold: true }, bullet: { marker: "•" } },
  pagination: { pageBreakCarrier: "banner-property" },
  language: { strategy: "per-file", variants: [
    { id: "commun", lang: "fr", colour: "000000", inAllFiles: true },
    { id: "fr", lang: "fr", colour: "C0504D", prefix: "[FR]", fileSuffix: "-FR" },
  ] },
};

/** Stage a render bag on a FormatterSpec, so the draft has a stack to resolve. */
async function stageRenderBag(bag: unknown, target = specId): Promise<void> {
  const items = [{ nodeId: target, properties: { render: bag } }];
  const dry = await runEditNodes({ items });
  if (!dry.confirmationToken) throw new Error(`staging refused: ${JSON.stringify(dry.errors)}`);
  // The items go back with the confirm: this store does not park payloads, and
  // a token-only confirm is then an ARGS_MISMATCH rather than a replay.
  const done = await runEditNodes({ items, confirm: true, confirmationToken: dry.confirmationToken as string });
  if (!done.ok) throw new Error(`staging confirm failed: ${JSON.stringify(done)}`);
}

beforeAll(() => {
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    uploaded = Buffer.from(init?.body as Uint8Array);
    uploads.push({ key: nextKey, body: uploaded });
    return { ok: true, status: 200, statusText: "OK" };
  }) as unknown as typeof fetch;
});
afterAll(() => { globalThis.fetch = realFetch; });

beforeEach(async () => {
  __setKgStoreForTest(await seedStore({ only: [CE1_READING] }));
  __setStorageForTest(storage);
  __resetMutationsForTest();
  canonicalUploads = 0; historyWrites = 0; uploaded = null; uploads.length = 0;

  // Find a section and a formatter spec on its stack, from the fixture itself,
  // so the suite breaks loudly if the document layer changes shape rather than
  // quietly testing nothing.
  await withCtx(CURATOR, async () => {
    const { formatterStackFor } = await import("../../curriculum/index.js");
    const { getActiveAdapter } = await import("../../adapters/index.js");
    const model = getActiveAdapter().model();
    const sections = (model.rawGraph?.nodes ?? []).filter((n) => (n.labels ?? []).includes("DocumentSection"));
    for (const section of sections) {
      const spec = (formatterStackFor(model, section.id) ?? [])
        .find((n) => (n.labels ?? []).includes("FormatterSpec"));
      if (spec) { sectionId = section.id; specId = spec.id; return; }
    }
    throw new Error("fixture has no DocumentSection with a FormatterSpec on its stack");
  });
});

describe("render_document produces a document", () => {
  it("renders a tree through the node's own formatter stack", async () => {
    const out = await withCtx(CURATOR, async () => {
      await stageRenderBag(RENDER_BAG);
      return renderDocument({ nodeId: sectionId, document: TREE });
    });

    expect(out.error).toBeUndefined();
    expect(out.blocks).toBe(3);
    expect(out.formatters).toContain(specId);
    expect(String(out.downloadUrl)).toContain("https://signed/get");
    expect(uploaded!.length).toBeGreaterThan(500);
  });

  it("writes a file whose geometry came from the formatter, not a default", async () => {
    await withCtx(CURATOR, async () => {
      await stageRenderBag(RENDER_BAG);
      await renderDocument({ nodeId: sectionId, document: TREE });
    });
    const doc = unzip(uploaded!).get("word/document.xml")!.toString("utf8");

    expect(doc).toContain('<w:pgSz w:w="11906" w:h="16838"/>');       // A4, explicitly
    expect(doc).toContain('w:top="1417"');                             // 2.5 cm
    expect(doc).toContain('<w:spacing w:line="310" w:lineRule="exact"/>');
    expect(doc).toContain('w:fill="09A9E1"');                          // the banner style
    expect(doc).toContain('<w:color w:val="C0504D"/>');                // the French variant
    expect(doc).toContain("<w:pageBreakBefore/>");                     // the declared carrier
    expect(doc).toContain("Regardez bien.");
  });

  it("keeps the output segregated from the canonical bucket and history", async () => {
    const out = await withCtx(CURATOR, async () => {
      await stageRenderBag(RENDER_BAG);
      return renderDocument({ nodeId: sectionId, document: TREE });
    });
    expect(String(out.objectKey)).toContain("previews/");
    expect(String(out.objectKey)).not.toMatch(/^documents\//);
    expect(canonicalUploads).toBe(0);
    expect(historyWrites).toBe(0);
  });
});

describe("one source, one file per language", () => {
  // A tree carrying both languages: black lines belong in every file, the
  // French and Wolof ones each in their own.
  const BILINGUAL = {
    blocks: [
      { kind: "table", rows: [[{ style: "sessionBanner", blocks: [
        { kind: "line", runs: [{ text: "Séance 1" }] },
      ] }]] },
      { kind: "line", variant: "commun", runs: [{ text: "E. pose des cailloux." }] },
      { kind: "line", variant: "fr", runs: [{ text: "Nommez ces objets." }] },
      { kind: "line", variant: "wo", runs: [{ text: "Tudd-leen yëf yii." }] },
    ],
  };

  const WITH_WOLOF = {
    ...RENDER_BAG,
    language: { strategy: "per-file", variants: [
      { id: "commun", lang: "fr", colour: "000000", inAllFiles: true },
      { id: "fr", lang: "fr", colour: "C0504D", prefix: "[FR]", fileSuffix: "-FR" },
      { id: "wo", lang: "wo", colour: "0070C0", prefix: "[WO]", fileSuffix: "-WO" },
    ] },
  };

  it("writes two documents from one call, named by the formatter", async () => {
    const out = await withCtx(CURATOR, async () => {
      await stageRenderBag(WITH_WOLOF);
      return renderDocument({ nodeId: sectionId, document: BILINGUAL, relPath: "lecon-1.docx" });
    });
    const files = out.files as Array<Record<string, unknown>>;
    expect(files.map((f) => f.variant)).toEqual(["fr", "wo"]);
    expect(files.map((f) => f.lang)).toEqual(["fr", "wo"]);
    expect(uploads.map((u) => u.key)).toEqual([
      expect.stringContaining("lecon-1-FR.docx"),
      expect.stringContaining("lecon-1-WO.docx"),
    ]);
  });

  it("puts each language only in its own file, and the shared lines in both", async () => {
    await withCtx(CURATOR, async () => {
      await stageRenderBag(WITH_WOLOF);
      await renderDocument({ nodeId: sectionId, document: BILINGUAL, relPath: "lecon-1.docx" });
    });
    const [fr, wo] = uploads.map((u) => unzip(u.body).get("word/document.xml")!.toString("utf8"));

    expect(fr).toContain("Nommez ces objets.");
    expect(fr).not.toContain("Tudd-leen");
    expect(wo).toContain("Tudd-leen yëf yii.");
    expect(wo).not.toContain("Nommez ces objets.");

    // The black line and the banner are in both — the second is structure, and
    // a file that lost it would be missing its scaffolding, not a translation.
    for (const doc of [fr, wo]) {
      expect(doc).toContain("E. pose des cailloux.");
      expect(doc).toContain("Séance 1");
      expect(doc).toContain('w:fill="09A9E1"');
    }
  });

  it("stays one file when the formatter declares one language", async () => {
    const out = await withCtx(CURATOR, async () => {
      await stageRenderBag(RENDER_BAG);   // fr + a shared variant, no Wolof
      return renderDocument({ nodeId: sectionId, document: TREE });
    });
    expect((out.files as unknown[]).length).toBe(1);
    // The single-file shape survives, so a monolingual caller need not index.
    expect(out.downloadUrl).toBeDefined();
  });

  it("refuses to translate into a language the formatter never declared", async () => {
    const out = await withCtx(CURATOR, async () => {
      await stageRenderBag(RENDER_BAG);
      return renderDocument({ nodeId: sectionId, document: TREE, translateInto: "en" });
    });
    expect(out.error).toContain("no variant 'en'");
    expect(uploads).toHaveLength(0);
  });

  it("does not translate a tree that already carries the language", async () => {
    // Deriving over the top would double every line, and re-translating what an
    // author wrote by hand is the one thing this must never do. No Gemini key
    // is configured here, so reaching the translator at all would error.
    const out = await withCtx(CURATOR, async () => {
      await stageRenderBag(WITH_WOLOF);
      return renderDocument({ nodeId: sectionId, document: BILINGUAL, translateInto: "wo" });
    });
    expect((out.files as unknown[]).length).toBe(2);
    expect(out.translatedInto).toBe("wo");
  });
});

describe("deriving Wolof from the French the tree carries", () => {
  const WITH_WOLOF = {
    ...RENDER_BAG,
    language: { strategy: "per-file", variants: [
      { id: "commun", lang: "fr", colour: "000000", inAllFiles: true },
      { id: "fr", lang: "fr", colour: "C0504D", prefix: "[FR]", fileSuffix: "-FR" },
      { id: "wo", lang: "wo", colour: "0070C0", prefix: "[WO]", fileSuffix: "-WO" },
    ] },
  };

  const FRENCH_ONLY = {
    blocks: [
      { kind: "table", rows: [[{ style: "sessionBanner", blocks: [
        { kind: "line", runs: [{ text: "Séance 1" }] },
      ] }]] },
      { kind: "line", variant: "commun", runs: [{ text: "E. pose des cailloux." }] },
      { kind: "line", variant: "fr", runs: [{ text: "Nommez ces objets." }] },
    ],
  };

  beforeEach(() => { translated.length = 0; CONFIG.gemini.apiKey = "test-key"; });
  afterAll(() => { CONFIG.gemini.apiKey = ""; });

  it("produces the Wolof file from a tree that had no Wolof in it", async () => {
    const out = await withCtx(CURATOR, async () => {
      await stageRenderBag(WITH_WOLOF);
      return renderDocument({ nodeId: sectionId, document: FRENCH_ONLY, relPath: "lecon-1.docx", translateInto: "wo" });
    });

    expect(out.translatedInto).toBe("wo");
    expect((out.files as unknown[]).length).toBe(2);

    const [fr, wo] = uploads.map((u) => unzip(u.body).get("word/document.xml")!.toString("utf8"));
    expect(fr).toContain("Nommez ces objets.");
    expect(fr).not.toContain("wo:");
    expect(wo).toContain("wo:Nommez ces objets.");
    expect(wo).not.toContain("&gt;Nommez ces objets.&lt;");
  });

  it("translates the spoken lines and nothing else", async () => {
    // The banner is structure and the black line prints in both files as it is.
    // Sending either through a translator would spend budget to produce a
    // second copy of a line that was already correct.
    await withCtx(CURATOR, async () => {
      await stageRenderBag(WITH_WOLOF);
      await renderDocument({ nodeId: sectionId, document: FRENCH_ONLY, translateInto: "wo" });
    });
    expect(translated.map((t) => t.text)).toEqual(["Nommez ces objets."]);
    expect(translated[0].direction).toBe("fr>wo");
  });

  it("colours the derived lines as the formatter says, in their own file", async () => {
    await withCtx(CURATOR, async () => {
      await stageRenderBag(WITH_WOLOF);
      await renderDocument({ nodeId: sectionId, document: FRENCH_ONLY, translateInto: "wo" });
    });
    const [fr, wo] = uploads.map((u) => unzip(u.body).get("word/document.xml")!.toString("utf8"));
    expect(fr).toContain('<w:color w:val="C0504D"/>');    // French red
    expect(fr).not.toContain('<w:color w:val="0070C0"/>');
    expect(wo).toContain('<w:color w:val="0070C0"/>');    // Wolof blue
    expect(wo).not.toContain('<w:color w:val="C0504D"/>');
  });

  it("says so plainly when the server has no translation key", async () => {
    CONFIG.gemini.apiKey = "";
    const out = await withCtx(CURATOR, async () => {
      await stageRenderBag(WITH_WOLOF);
      return renderDocument({ nodeId: sectionId, document: FRENCH_ONLY, translateInto: "wo" });
    });
    expect(out.error).toContain("GEMINI_API_KEY");
    expect(uploads).toHaveLength(0);
  });
});

describe("counting the pages", () => {
  // No LibreOffice in this environment, which is the case worth pinning: the
  // tool must report that it could not measure rather than fill the gap in.
  it("reports that it could not measure, and never invents a count", async () => {
    const out = await withCtx(CURATOR, async () => {
      await stageRenderBag(RENDER_BAG);
      return renderDocument({ nodeId: sectionId, document: TREE, measure: true });
    });
    const file = (out.files as Array<Record<string, unknown>>)[0];
    const measurement = file.measurement as { available: boolean; reason?: string };
    expect(measurement).toBeDefined();
    expect(measurement.available).toBe(false);
    expect(measurement.reason).toMatch(/LibreOffice|pdfinfo/);
    expect(file.pages).toBeUndefined();
    expect(file.fits).toBeUndefined();
  });

  it("does not measure unless asked — laying a file out is not free", async () => {
    const out = await withCtx(CURATOR, async () => {
      await stageRenderBag(RENDER_BAG);
      return renderDocument({ nodeId: sectionId, document: TREE });
    });
    expect((out.files as Array<Record<string, unknown>>)[0].measurement).toBeUndefined();
  });

  it("still produces the document when it cannot be measured", async () => {
    // A missing page count is not a failed render. The file is the deliverable.
    const out = await withCtx(CURATOR, async () => {
      await stageRenderBag(RENDER_BAG);
      return renderDocument({ nodeId: sectionId, document: TREE, measure: true });
    });
    expect(out.error).toBeUndefined();
    expect(uploads).toHaveLength(1);
    expect(uploads[0].body.length).toBeGreaterThan(500);
  });
});

describe("reading a corrected document back", () => {
  // The expert's half of the loop. A sheet goes out, comes back with a fixed
  // sentence, and the correction has to reach the graph — without any tool
  // silently rewriting curriculum from a Word file.
  let anchorId: string;
  let originalText: string;

  // Serve the "corrected" file back through the storage stub, so the tool
  // reads it exactly as it would read one an expert uploaded.
  let corrected: Buffer = Buffer.alloc(0);
  const readable: StorageAdapter = { ...storage, downloadDocx: async () => corrected };

  async function renderWithAnchor(text: string): Promise<Buffer> {
    const { renderDocx, resolveRenderSpec } = await import("../../render/index.js");
    const stack = [{ id: "f", properties: { raw: { render: RENDER_BAG } } }];
    const spec = resolveRenderSpec(stack);
    if (!spec.ok) throw new Error(spec.errors.join("; "));
    const tree = documentSchema.parse({
      blocks: [{ kind: "line", anchor: anchorId, style: "bullet", runs: [{ text }] }],
    });
    return renderDocx({ blocks: tree.blocks, media: [] }, spec.spec);
  }

  beforeEach(async () => {
    __setStorageForTest(readable);
    await withCtx(CURATOR, async () => {
      const { getActiveAdapter } = await import("../../adapters/index.js");
      const raw = getActiveAdapter().model().rawGraph!;
      const withContent = raw.nodes.find(
        (n) => typeof (n.properties as Record<string, unknown>)?.content === "string"
          && ((n.properties as Record<string, unknown>).content as string).length > 20,
      )!;
      anchorId = withContent.id;
      originalText = (withContent.properties as Record<string, unknown>).content as string;
    });
  });

  it("proposes the edit an expert actually made", async () => {
    corrected = await renderWithAnchor(originalText + " ET UNE PHRASE AJOUTÉE.");
    const out = await withCtx(CURATOR, async () => proposeFromDocument({ relPath: "corrigé.docx" }));

    expect(out.anchored).toBe(true);
    const proposals = out.proposals as Array<Record<string, unknown>>;
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ kind: "edit", nodeId: anchorId });
    expect(String(proposals[0].after)).toContain("ET UNE PHRASE AJOUTÉE.");
  });

  it("hands back edits in the exact shape edit_nodes takes", async () => {
    corrected = await renderWithAnchor(originalText + " ET UNE PHRASE AJOUTÉE.");
    const out = await withCtx(CURATOR, async () => proposeFromDocument({ relPath: "corrigé.docx" }));
    const items = out.editItems as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(Object.keys(items[0]).sort()).toEqual(["content", "nodeId"]);
  });

  it("proposes NOTHING when the expert changed nothing", async () => {
    // Including the bullet the formatter added, which the graph never held.
    corrected = await renderWithAnchor(originalText);
    const out = await withCtx(CURATOR, async () => proposeFromDocument({ relPath: "corrigé.docx" }));
    expect(out.proposals).toEqual([]);
    expect((out.counts as Record<string, number>).edits).toBe(0);
  });

  it("says so plainly when a document carries no node ids", async () => {
    // An old sheet, or one rebuilt by hand. Its text reads; what cannot be said
    // is where any of it belongs, and saying that beats a confident guess.
    const { renderDocx, resolveRenderSpec } = await import("../../render/index.js");
    const spec = resolveRenderSpec([{ id: "f", properties: { raw: { render: RENDER_BAG } } }]);
    if (!spec.ok) throw new Error("spec");
    corrected = renderDocx(
      { blocks: documentSchema.parse({ blocks: [{ kind: "line", runs: [{ text: "Sans ancre." }] }] }).blocks, media: [] },
      spec.spec,
    );
    const out = await withCtx(CURATOR, async () => proposeFromDocument({ relPath: "vieux.docx" }));
    expect(out.anchored).toBe(false);
    expect(out.proposals).toBeUndefined();
    expect(String(out.message)).toContain("no node ids");
  });

  it("never writes to the graph", async () => {
    // The whole safety property: a Word file cannot change the curriculum on
    // its own. Reading one leaves no draft behind.
    corrected = await renderWithAnchor(originalText + " CHANGÉ.");
    const draftAfter = await withCtx(CURATOR, async () => {
      await proposeFromDocument({ relPath: "corrigé.docx" });
      const { resolveDraftModel } = await import("../preview.js");
      const { kgNamespace } = await import("../../kg-store/index.js");
      return resolveDraftModel(kgNamespace(ctx.workspace, ctx.grade, ctx.subject));
    });
    expect(draftAfter).toBeNull();
  });

  it("blocks a signed-in caller with no role", async () => {
    corrected = await renderWithAnchor(originalText);
    const out = await withCtx(SIGNED_IN_NO_ROLE, async () => proposeFromDocument({ relPath: "corrigé.docx" }));
    expect(out.proposals).toBeUndefined();
  });
});

describe("knowing which produced documents have gone out of date", () => {
  // The gap: the bucket holds sheets quoting wording the graph has since moved
  // past, and nothing tells them apart from the current ones.
  let anchorId: string;
  let originalText: string;
  let stored: Buffer = Buffer.alloc(0);

  // Behaves like the real bucket for one file: downloadable back, and it
  // reports an md5, so recordContent will accept it.
  const bucket: StorageAdapter = {
    ...storage,
    downloadDocx: async () => stored,
    getObjectMd5: async () => "md5-of-the-stored-file",
  };

  async function renderAnchored(text: string): Promise<Buffer> {
    const { renderDocx, resolveRenderSpec } = await import("../../render/index.js");
    const spec = resolveRenderSpec([{ id: "f", properties: { raw: { render: RENDER_BAG } } }]);
    if (!spec.ok) throw new Error(spec.errors.join("; "));
    const tree = documentSchema.parse({
      blocks: [{ kind: "line", anchor: anchorId, style: "bullet", runs: [{ text }] }],
    });
    return renderDocx({ blocks: tree.blocks, media: [] }, spec.spec);
  }

  /** Record the stored file the way a real generation would. */
  async function logIt(relPath: string): Promise<void> {
    const { recordContent } = await import("../../storage/index.js");
    const { readDocx, sourcesFrom } = await import("../../render/index.js");
    const { getActiveAdapter } = await import("../../adapters/index.js");
    const raw = getActiveAdapter().model().rawGraph!;
    const anchors = readDocx(stored).anchors;
    const current = new Map<string, string>();
    for (const id of anchors) {
      const node = raw.nodes.find((n) => n.id === id);
      const content = (node?.properties as Record<string, unknown>)?.content;
      if (typeof content === "string") current.set(id, content);
    }
    await recordContent("pipeline", {
      nodeId: anchorId, relPath, content: { summary: "test" },
      sources: sourcesFrom(anchors, current),
    });
  }

  /** Rewrite one node's content and publish it. Run as an APPROVER: a curator
   *  may stage and discard a draft, but publishing is the approver's move. */
  async function rewrite(nodeId: string, content: string): Promise<void> {
    const items = [{ nodeId, content }];
    const dry = await runEditNodes({ items });
    await runEditNodes({ items, confirm: true, confirmationToken: dry.confirmationToken as string });
    const { publishDraft, kgNamespace } = await import("../../kg-store/index.js");
    await publishDraft(kgNamespace(ctx.workspace, ctx.grade, ctx.subject));
  }

  beforeEach(async () => {
    __setStorageForTest(bucket);
    await withCtx(CURATOR, async () => {
      const { getActiveAdapter } = await import("../../adapters/index.js");
      const raw = getActiveAdapter().model().rawGraph!;
      const node = raw.nodes.find(
        (n) => typeof (n.properties as Record<string, unknown>)?.content === "string"
          && ((n.properties as Record<string, unknown>).content as string).length > 20,
      )!;
      anchorId = node.id;
      originalText = (node.properties as Record<string, unknown>).content as string;
      stored = await renderAnchored(originalText);
      await logIt("lecon_01/fiche.docx");
    });
  });

  it("reports a freshly produced document as current", async () => {
    const out = await withCtx(CURATOR, async () => checkStale());
    expect((out.counts as Record<string, number>).current).toBeGreaterThanOrEqual(1);
    expect(out.stale).toEqual([]);
  });

  it("flags it once the curriculum it quotes has moved, and names the node", async () => {
    await withCtx(APPROVER, async () => rewrite(anchorId, originalText + " UNE PHRASE DE PLUS."));
    // A separate session, so the graph is re-read — which is also how this
    // would actually happen: one person edits, another asks what is stale.
    const out = await withCtx(CURATOR, async () => checkStale());

    const stale = (out.stale as Array<Record<string, unknown>>)
      .find((d) => d.relPath === "lecon_01/fiche.docx");
    expect(stale).toBeDefined();
    expect(stale!.changed).toEqual([anchorId]);
    expect(stale!.removed).toEqual([]);
  });

  it("does NOT flag it when a lesson it never quoted changes", async () => {
    // The reason staleness is per document. A graph-wide version would mark all
    // eighty files on any edit, and a flag that is always on gets ignored.
    const other = await withCtx(APPROVER, async () => {
      const { getActiveAdapter } = await import("../../adapters/index.js");
      const raw = getActiveAdapter().model().rawGraph!;
      const node = raw.nodes.find(
        (n) => n.id !== anchorId && typeof (n.properties as Record<string, unknown>)?.content === "string",
      )!;
      await rewrite(node.id, "Tout autre chose.");
      return node.id;
    });
    expect(other).not.toBe(anchorId);

    const out = await withCtx(CURATOR, async () => checkStale());
    expect((out.stale as Array<Record<string, unknown>>)
      .some((d) => d.relPath === "lecon_01/fiche.docx")).toBe(false);
  });

  it("calls a document with no recorded sources UNKNOWN, never current", async () => {
    // Everything produced before this existed is in that state, and reporting
    // it as up to date would be the most misleading thing here.
    const out = await withCtx(CURATOR, async () => {
      const { recordContent } = await import("../../storage/index.js");
      await recordContent("pipeline", {
        nodeId: anchorId, relPath: "lecon_01/ancienne.docx", content: { summary: "no sources" },
      });
      return checkStale();
    });
    expect(out.unknown).toContain("lecon_01/ancienne.docx");
    expect((out.stale as Array<Record<string, unknown>>)
      .some((d) => d.relPath === "lecon_01/ancienne.docx")).toBe(false);
    expect((out.nextSteps as string[]).join(" ")).toContain("NOT the same as being current");
  });
});

describe("render_document refuses rather than guesses", () => {
  it("refuses a tree carrying geometry — that is the formatter's half", async () => {
    const out = await withCtx(CURATOR, async () => {
      await stageRenderBag(RENDER_BAG);
      return renderDocument({
        nodeId: sectionId,
        document: { blocks: [{ kind: "line", runs: [{ text: "x" }], colour: "FF0000" }] },
      });
    });
    expect(out.error).toContain("not valid");
    expect((out.problems as string[]).join(" ")).toContain("colour");
    expect(uploaded).toBeNull();
  });

  it("names the path, so a caller knows which block it got wrong", async () => {
    const out = await withCtx(CURATOR, async () => {
      await stageRenderBag(RENDER_BAG);
      return renderDocument({
        nodeId: sectionId,
        document: { blocks: [{ kind: "line", runs: [{ text: "ok" }] }, { kind: "line", runs: [{ text: 7 }] }] },
      });
    });
    expect((out.problems as string[])[0]).toContain("blocks.1.runs.0");
  });

  it("cannot even be given an unresolvable stack — authoring refuses it first", () => {
    // The stack-resolution guard in render_document is a second line, not the
    // first: `edit_nodes` validates a `render` bag when it is WRITTEN, so an
    // invalid one never reaches the graph. Asserting that here keeps the two
    // halves honest — if authoring ever stopped validating, this fails rather
    // than the failure surfacing as an unexplainable document.
    return withCtx(CURATOR, async () => {
      await expect(stageRenderBag({ type: { leadingRule: "tight" } }))
        .rejects.toThrow(/render\.type\.leadingRule/);
    });
  });

  it("refuses a node that has no formatter stack at all", async () => {
    const out = await withCtx(CURATOR, async () => {
      await stageRenderBag(RENDER_BAG);
      return renderDocument({ nodeId: "not-a-node", document: TREE });
    });
    expect(out.error).toContain("neither a DocumentSection nor a TeachingLearningMaterial");
    expect(uploaded).toBeNull();
  });

  it("says so when there is no draft to render from", async () => {
    const out = await withCtx(CURATOR, async () => renderDocument({ nodeId: sectionId, document: TREE }));
    expect(out.noDraft).toBe(true);
    expect(uploaded).toBeNull();
  });

  it("blocks a signed-in caller with no role, like every other draft read", async () => {
    const out = await withCtx(SIGNED_IN_NO_ROLE, async () => renderDocument({ nodeId: sectionId, document: TREE }));
    expect(out.downloadUrl).toBeUndefined();
    expect(uploaded).toBeNull();
  });
});
