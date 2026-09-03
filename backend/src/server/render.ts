/*
 * Module: server · tool group: rendering a composed page into a .docx
 *
 * The step that used to happen on somebody's laptop.
 *
 * preview_generation already hands a caller everything a document needs and
 * then says "generate the .docx from it" — which was only ever true for the one
 * person with the Python scripts. This is the other half: the authoring model
 * composes the page as a BLOCK TREE, sends it here, and the server lays it out.
 *
 * The division is deliberate and is the whole WP3/WP4 argument:
 *
 *   • The MODEL decides what is on the page — which banner, in what order,
 *     where the page turns. That is authored per section and there is no schema
 *     that could hold it without describing one document type.
 *   • The FORMATTER decides what it looks like — page, type, colours, image
 *     ceilings, how a page break is written. That is `properties.render`.
 *   • This module decides NOTHING. It merges the stack, validates the tree, and
 *     renders. A `if (subject === …)` here would mean the split failed.
 *
 * Output goes to the SEGREGATED previews/ prefix, on the same isolation
 * preview_generation has: short-lived, invisible to reconcile/list_documents,
 * never recorded in history. Writing the canonical bucket is a separate
 * decision with separate stakes, and this tool deliberately cannot.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { asJson, guarded } from "./shared.js";
import { getActiveAdapter } from "../adapters/index.js";
import { activeWorkspace } from "../context/index.js";
import { getKgStore, kgNamespace, toAuditActor, nextAuditSeq } from "../kg-store/index.js";
import { currentActor } from "../actor.js";
import { getStorageAdapter } from "../storage/index.js";
import { formatterStackFor } from "../curriculum/index.js";
import { documentSchema, renderDocx, resolveRenderSpec, splitByVariant, deriveVariant, hasVariant, measureDocx, readDocx, proposeEdits, editItems, type DocumentTree } from "../render/index.js";
import { translate } from "../translation/index.js";
import { effectiveTerms, filterByText } from "./glossary-read.js";
import { denyUnlessMember } from "./membership.js";
import { CONFIG } from "../config.js";
import { resolveDraftModel, denyIfNotDraftReader, PREVIEW_LABEL } from "./preview.js";

type RenderArgs = {
  nodeId: string;
  document: unknown;
  relPath?: string;
  /** Variant id to fill in by translating, e.g. "wo". */
  translateInto?: string;
  /** Lay each file out and count its pages. Slow; off by default. */
  measure?: boolean;
};

/** A default name for the output, so a caller need not invent one. */
const defaultRelPath = (nodeId: string) => `previews/render-${nodeId}.docx`;

/** Insert a variant's suffix before the extension: "…/x.docx" -> "…/x-WO.docx". */
function suffixed(relPath: string, suffix: string): string {
  if (!suffix) return relPath;
  const dot = relPath.lastIndexOf(".");
  return dot < 0 ? relPath + suffix : relPath.slice(0, dot) + suffix + relPath.slice(dot);
}

/*
 * The glossary-grounded translator, in the shape render/ asks for.
 *
 * It scans each line for terms the curriculum already fixes a Wolof wording for
 * and hands those to Gemini as a term bank — the same grounding the `translate`
 * tool uses. Without it a page would drift from the wording of every material
 * already in classrooms, one line at a time.
 */
function glossaryTranslator(terms: Awaited<ReturnType<typeof effectiveTerms>>) {
  return async (text: string, from: string, to: string): Promise<string> => {
    const direction = from === "fr" && to === "wo" ? "fr>wo" : from === "wo" && to === "fr" ? "wo>fr" : "auto";
    const glossary = filterByText(terms, text, 40).map((e) => ({ francais: e.francais, wolof: e.wolof }));
    const result = await translate({ text, direction, glossary });
    return result.translation;
  };
}

export async function renderDocument(a: RenderArgs): Promise<Record<string, unknown>> {
  const adapter = getActiveAdapter();
  const ns = kgNamespace(activeWorkspace(), adapter.grade, adapter.subject);

  const denied = await denyIfNotDraftReader(ns);
  if (denied) return denied;

  const resolved = await resolveDraftModel(ns);
  if (!resolved) {
    return {
      preview: true, noDraft: true,
      message:
        `No draft exists for '${ns}' to render from. Rendering reflects UNPUBLISHED draft edits, so with no draft there is nothing to render. ` +
        `Stage an edit first, then call render_document again.`,
    };
  }

  const stack = formatterStackFor(resolved.model, a.nodeId);
  if (!stack) {
    return {
      preview: true,
      error:
        `'${a.nodeId}' is neither a DocumentSection nor a TeachingLearningMaterial in the draft, so it has no formatter stack to render with. ` +
        `Use find_node to turn a name into an id, or walk_document for a document's section ids.`,
    };
  }

  // The formatters merge before the tree is even looked at: a stack that cannot
  // resolve is the formatter author's problem, and saying so with the formatter
  // ids beats a page that comes out wrong for reasons nobody can trace.
  const spec = resolveRenderSpec(stack);
  if (!spec.ok) {
    return {
      preview: true,
      error: "The formatter stack for this node does not resolve to a valid render spec.",
      formatters: spec.from,
      problems: spec.errors,
    };
  }

  const tree = documentSchema.safeParse(a.document);
  if (!tree.success) {
    return {
      preview: true,
      error: "The document tree is not valid. Nothing was rendered.",
      problems: tree.error.issues.map((issue) => {
        const path = issue.path.length ? issue.path.join(".") : "(root)";
        return `document.${path}: ${issue.message}`;
      }),
      hint: "get_capabilities section:'document' describes the tree. Geometry does not belong in it: a block names a `style` and a picture a `role`, and the formatter says what those look like.",
    };
  }

  const media = (tree.data.media ?? []).map((m) => ({ name: m.name, data: Buffer.from(m.data, "base64") }));
  let composed: DocumentTree = { blocks: tree.data.blocks, media };

  // Fill in a language the tree does not carry, before splitting — a variant
  // with no lines would otherwise produce an empty file rather than a missing
  // one, which is the harder failure to notice.
  // A tree that already carries the language needs nothing derived — and so
  // spends nothing, which is why the membership and key checks sit INSIDE this
  // branch rather than in front of it.
  if (a.translateInto && !hasVariant(composed, a.translateInto)) {
    const declared = spec.spec.language?.variants ?? [];
    const target = declared.find((v) => v.id === a.translateInto);
    const source = declared.find((v) => v.id !== a.translateInto && !v.inAllFiles);
    if (!target || !source) {
      return {
        preview: true,
        error: `The formatter declares no variant '${a.translateInto}' to translate into, or no other variant to translate from.`,
        variants: declared.map((v) => v.id),
      };
    }
    // Members only, like the `translate` tool: every derived line spends Gemini
    // budget, and that is the one thing an open curriculum read never does.
    const deniedTranslate = await denyUnlessMember("translate", ns);
    if (deniedTranslate) return deniedTranslate;
    if (!CONFIG.gemini.apiKey) {
      return { preview: true, error: "Translation is unavailable: the server has no GEMINI_API_KEY configured." };
    }
    composed = await deriveVariant(
      composed, source.id, target.id, source.lang, target.lang,
      glossaryTranslator(await effectiveTerms()),
    );
  }

  const storage = getStorageAdapter();
  if (!storage.createPreviewUpload) {
    return { preview: true, error: "The active storage backend does not support preview uploads." };
  }

  // One file per language the formatter declares — CI maths composes one source
  // and produces two documents, black lines in both, each colour in its own.
  const variants = splitByVariant(composed, spec.spec);
  const relPath = a.relPath ?? defaultRelPath(a.nodeId);
  const files: Record<string, unknown>[] = [];

  const maxPages = spec.spec.budget?.maxPages;

  for (const variant of variants) {
    const bytes = renderDocx(variant.tree, spec.spec);

    /*
     * Counting happens on the RENDER, which is the project's own rule and was
     * paid for: a count derived from the source once put a document at 2.5
     * pages that rendered at eleven. It is opt-in because laying a file out
     * starts a whole office suite, and it reports `available: false` rather
     * than a guess when the environment has no layout engine.
     */
    const measurement = a.measure ? await measureDocx(bytes) : null;
    const fits = measurement?.available && maxPages !== undefined
      ? measurement.pages <= maxPages
      : null;
    const signed = await storage.createPreviewUpload(suffixed(relPath, variant.fileSuffix));
    // The server holds the bytes, so it does its own PUT rather than handing
    // the caller a URL — there is nothing left for the caller to upload.
    const put = await fetch(signed.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": signed.contentType },
      body: new Uint8Array(bytes),
    });
    if (!put.ok) {
      return { preview: true, error: `Upload failed (${put.status} ${put.statusText}).`, objectKey: signed.objectKey };
    }
    files.push({
      variant: variant.id || null,
      lang: variant.lang || null,
      downloadUrl: signed.downloadUrl,
      objectKey: signed.objectKey,
      expiresAt: signed.expiresAt,
      bytes: bytes.length,
      ...(measurement ? { measurement } : {}),
      ...(fits === null ? {} : { fits, maxPages }),
    });
  }

  await getKgStore().appendAudit({
    id: randomUUID(),
    ts: new Date().toISOString(), seq: nextAuditSeq(),
    actor: toAuditActor(currentActor()),
    namespace: ns,
    eventType: "preview",
    reason:
      `rendered ${tree.data.blocks.length} blocks for '${a.nodeId}' into ${files.length} file(s)` +
      `${a.translateInto ? `, deriving '${a.translateInto}' by translation` : ""}` +
      ` from draft${resolved.draftVersion ? ` ${resolved.draftVersion}` : ""}`,
  });

  return {
    preview: true,
    label: PREVIEW_LABEL,
    files,
    // The single-file shape stays on the response for a monolingual document,
    // so a caller that only ever produces one is not made to index an array.
    ...(files.length === 1 ? { downloadUrl: files[0].downloadUrl, objectKey: files[0].objectKey } : {}),
    blocks: tree.data.blocks.length,
    images: media.length,
    formatters: spec.from,
    translatedInto: a.translateInto ?? null,
    draftVersion: resolved.draftVersion,
    isolation:
      "Rendered from the UNPUBLISHED draft into the segregated previews/ prefix. It will NOT appear in list_documents or reconcile, must NEVER be recorded via log_generation, and expires at expiresAt.",
  };
}

export function registerRenderTools(server: McpServer) {
  server.registerTool(
    "render_document",
    {
      title: "Render a composed page into a .docx",
      description:
        "Turn a page YOU composed into a Word file. `nodeId` is the DocumentSection (or TeachingLearningMaterial) being rendered; `document` is the block tree. The server merges that node's formatter stack into one render spec, validates the tree against it, lays out the .docx and returns a short-lived `downloadUrl`. " +
        "YOU decide what is on the page — which banner, in what order, where it turns; the FORMATTER decides what it looks like. So the tree carries NO geometry: no colour, no point size, no centimetre. A block names a `style` and a picture names a `role`, both defined by the formatter; a page break says only `pageBreak:'before'` and the formatter's `pagination.pageBreakCarrier` decides how it is written. The tree shape is in get_capabilities section:'document'; call preview_generation first for the section's curriculum, routine and formatter prose. " +
        "Unknown keys are REFUSED rather than ignored, and nothing is rendered when the tree or the stack is invalid — the response names the path. " +
        "ONE SOURCE, ONE FILE PER LANGUAGE. When the formatter's `language.strategy` is 'per-file', each declared variant gets its own document: lines marked `inAllFiles` print in every one, a line tagged with a variant prints only in that variant's file, and `files[]` comes back with one entry each. Pass `translateInto` (a variant id, e.g. 'wo') to have the server DERIVE that language from the one the tree already carries, translating line by line through the subject's MOHEBS glossary so the wording matches materials already in classrooms — a tree that already has those lines is left alone. Translation spends a metered backend, so it needs a ROLE in the workspace. " +
        "Pass `measure:true` to lay each file out and COUNT ITS PAGES — page counts are measured on the render, never estimated from the source (an estimate once put a document at 2.5 pages that rendered at eleven). Each file then carries `measurement` with the page count, the page size actually produced, and the whitespace left below the last line of each page; with `budget.maxPages` declared it also carries `fits`. Measuring starts a whole office suite, so it is off by default, and where the deployment has no layout engine it reports `available:false` rather than a guess. " +
        "Output goes to the SEGREGATED previews/ prefix: short-lived, invisible to list_documents and reconcile, and never to be recorded via log_generation. Reads the UNPUBLISHED draft; curators and approvers only.",
      inputSchema: {
        nodeId: z.string(),
        document: z.unknown(),
        relPath: z.string().optional(),
        translateInto: z.string().optional(),
        measure: z.boolean().optional(),
      },
    },
    guarded(async (a: RenderArgs) => asJson(await renderDocument(a))),
  );

  server.registerTool(
    "propose_from_document",
    {
      title: "Read a corrected document back into proposed edits",
      description:
        "An expert opened a sheet, fixed some wording and sent it back: this works out what that means for the curriculum. `relPath` is the corrected .docx IN THE BUCKET. It returns `proposals` and, for the ones that can simply be applied, `editItems` in the exact shape `edit_nodes` takes. " +
        "IT PROPOSES AND NEVER WRITES. Applying goes through edit_nodes like any other change, so the diff is seen and confirmed first. " +
        "Three outcomes, and the difference matters: an EDIT (same node, different words) is unambiguous; MISSING (the graph has it, the document no longer does) is reported and NOT deleted, because a deliberate cut and a slip while editing look identical in a Word file; UNPLACED (text belonging to no node) is reported without a parent, because guessing one from position is how a sentence ends up under the wrong lesson. " +
        "It works by reading the node ids render_document wrote into the file. A document produced any other way comes back `anchored:false` with its text but no matches — that is the honest answer, not a failure. Comparison ignores the bullet the formatter adds and whitespace Word normalised. Reads the graph; curators and approvers only.",
      inputSchema: {
        relPath: z.string(),
        markers: z.array(z.string()).optional(),
      },
    },
    guarded(async (a: ProposeArgs) => asJson(await proposeFromDocument(a))),
  );
}


// ── propose_from_document ────────────────────────────────────────────────────

/*
 * A corrected sheet in, proposed graph edits out.
 *
 * The expert's half of the loop. They open a document, fix a sentence and send
 * it back; this works out what that means for the curriculum and STOPS. It
 * proposes; it never writes. Every proposal goes through the same two-phase
 * edit as any other change, so a person sees the diff and confirms it — a tool
 * that read a Word file and silently rewrote the curriculum would be the most
 * dangerous thing in this codebase.
 *
 * It works because the renderer put the node ids IN the file. On sheets from
 * the old pipeline nothing tied a line to a node, and matching meant guessing
 * from position and wording; an unanchored document still reads here, it just
 * cannot say where anything belongs, which is the honest answer rather than a
 * confident wrong one.
 */
type ProposeArgs = { relPath: string; markers?: string[] };

export async function proposeFromDocument(a: ProposeArgs): Promise<Record<string, unknown>> {
  const adapter = getActiveAdapter();
  const ns = kgNamespace(activeWorkspace(), adapter.grade, adapter.subject);

  const denied = await denyIfNotDraftReader(ns);
  if (denied) return denied;

  let bytes: Buffer;
  try {
    bytes = await getStorageAdapter().downloadDocx(a.relPath);
  } catch (error) {
    return { error: `Could not read '${a.relPath}' from the bucket: ${(error as Error).message}` };
  }

  const read = readDocx(bytes);
  if (read.anchors.length === 0) {
    return {
      relPath: a.relPath,
      anchored: false,
      blocks: read.blocks.length,
      message:
        "This document carries no node ids, so nothing in it can be matched back to the curriculum — it was not produced by render_document, or it was rebuilt from scratch. Its text reads fine; what cannot be said is which node any line belongs to. Re-render it through render_document and correct THAT copy, and the round trip works.",
    };
  }

  // Published, not draft: a correction is judged against what the curriculum
  // currently SAYS, and a half-finished draft would report edits the expert
  // never made.
  const model = adapter.model();
  const raw = model.rawGraph;
  const current = new Map<string, string>();
  for (const nodeId of read.anchors) {
    const node = raw?.nodes.find((n) => n.id === nodeId);
    const content = (node?.properties as Record<string, unknown> | undefined)?.content;
    if (typeof content === "string") current.set(nodeId, content);
  }

  const proposals = proposeEdits(read, current, { markers: a.markers ?? ["•"] });
  const edits = editItems(proposals);
  const missing = proposals.filter((p) => p.kind === "missing");
  const unplaced = proposals.filter((p) => p.kind === "unplaced");

  return {
    relPath: a.relPath,
    anchored: true,
    blocks: read.blocks.length,
    matched: current.size,
    // Anchors the document carries that this subject's graph does not hold —
    // usually a document read against the wrong context.
    unknownAnchors: read.anchors.filter((id) => !current.has(id)),
    proposals,
    editItems: edits,
    counts: { edits: edits.length, missing: missing.length, unplaced: unplaced.length },
    nextSteps: [
      edits.length
        ? `Apply the ${edits.length} edit(s): edit_nodes with \`items\` set to \`editItems\` — it stages a draft, so you see the diff before anything is live.`
        : "Nothing to apply: no anchored line differs from the graph.",
      ...(missing.length
        ? [`${missing.length} line(s) the graph has and this document no longer does. A deliberate cut and an editing slip look the same in a Word file, so they are reported, not deleted — read them and decide.`]
        : []),
      ...(unplaced.length
        ? [`${unplaced.length} block(s) of text belong to no node. Where new material goes cannot be read off its position; add_nodes it where it belongs.`]
        : []),
    ],
  };
}
