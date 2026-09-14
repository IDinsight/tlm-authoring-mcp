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
import { activeWorkspace, relPathOfDocumentObjectUri } from "../context/index.js";
import { getKgStore, kgNamespace, toAuditActor, nextAuditSeq } from "../kg-store/index.js";
import { currentActor } from "../actor.js";
import { getStorageAdapter } from "../storage/index.js";
import { formatterStackFor } from "../curriculum/index.js";
import { documentSchema, renderDocx, resolveRenderSpec, missingMediaNames, splitByVariant, deriveVariant, hasVariant, measureDocx, readDocx, proposeEdits, editItems, documentText, normalise, rasterizeSvgMedia, markAnswerCells, type AnswerMark, usableWidthCm, imageSizeCm, floatGutterCm, PAGE_CM, type DocumentTree, type TextSlot, type TranslateLines } from "../render/index.js";
import { displayName, descriptionBody, imageMimeFor } from "../utils/index.js";
import { translateBatch } from "../translation/index.js";
import { effectiveTerms, filterByText } from "./glossary-read.js";
import { denyUnlessMember } from "./membership.js";
import { CONFIG } from "../config.js";
import { resolveDraftModel, denyIfNotDraftReader, PREVIEW_LABEL } from "./preview.js";
import { resolveTreeInput, parkTree, TREE_PATCH_SCHEMA, type TreePatchOp } from "./tree-park.js";

type RenderArgs = {
  nodeId: string;
  /** The block tree — or `treeRef` (+ `patch`) naming one a previous call kept. */
  document?: unknown;
  treeRef?: string;
  patch?: TreePatchOp[];
  relPath?: string;
  /** Variant id to fill in by translating, e.g. "wo". */
  translateInto?: string;
  /** Lay each file out and count its pages. Slow; off by default. */
  measure?: boolean;
};

/*
 * How long one file's layout may take before the render gives up counting it.
 * Under the client's three-minute tool limit with room for the upload and
 * the readers; the file is delivered either way.
 */
const MEASURE_BUDGET_MS = 100_000;

/** A default name for the output, so a caller need not invent one. */
const defaultRelPath = (nodeId: string) => `previews/render-${nodeId}.docx`;

/** Insert a variant's suffix before the extension: "…/x.docx" -> "…/x-WO.docx". */
/*
 * The bucket path an attached picture's node points at, or why it cannot be
 * read here. The node's `identifier` is the file's URI; resolving it checks the
 * bucket and the namespace, so a graph moved to another deployment — or a
 * picture from another subject — refuses rather than reads the wrong object.
 */
type GraphNode = { id: string; labels?: string[]; properties?: Record<string, unknown> };

function attachedPicturePath(nodes: GraphNode[], nodeId: string): { relPath: string } | { refused: string } {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return { refused: `no node '${nodeId}' in this graph` };
  if (!(node.labels ?? []).includes("Material")) return { refused: `'${nodeId}' is not a Material` };
  const identifier = (node.properties ?? {}).identifier;
  if (typeof identifier !== "string" || !imageMimeFor(identifier)) return { refused: `'${nodeId}' is a Material but not a picture (its identifier names no image file)` };
  return relPathOfDocumentObjectUri(identifier);
}

/*
 * The correct cell(s) a picture records — `metadata.answerMark.cells`, set by
 * attach_image's `answerCells` or edit_nodes. Absent is a refusal at the
 * media entry that asked for the mark: a teacher's copy with no check on it
 * is the plain band wearing the key's name.
 */
function answerMarkOf(nodes: GraphNode[], nodeId: string): AnswerMark | null {
  const metadata = (nodes.find((n) => n.id === nodeId)?.properties ?? {}).metadata as { answerMark?: { cells?: unknown; of?: unknown } } | undefined;
  const cells = metadata?.answerMark?.cells;
  if (!Array.isArray(cells) || cells.length === 0 || !cells.every((c) => typeof c === "number")) return null;
  const of = metadata?.answerMark?.of;
  return { cells: cells as number[], ...(typeof of === "number" ? { of } : {}) };
}

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
 *
 * The lines go through `translateBatch`, the same path the `translate` tool
 * takes: several in flight at once, each with its own term bank, order kept by
 * index. One line failing does not lose the others' work, but it does refuse
 * the render — a Wolof file with a French line left in it reads as finished.
 */
function glossaryTranslator(terms: Awaited<ReturnType<typeof effectiveTerms>>): TranslateLines {
  return async (texts: string[], from: string, to: string): Promise<string[]> => {
    const direction = from === "fr" && to === "wo" ? "fr>wo" : from === "wo" && to === "fr" ? "wo>fr" : "auto";
    const glossaryFor = (text: string) => filterByText(terms, text, 40).map((e) => ({ francais: e.francais, wolof: e.wolof }));
    const items = await translateBatch({ texts, direction, glossaryFor });
    const failed = items.filter((item) => !item.ok);
    if (failed.length > 0) {
      const named = failed.slice(0, 3).map((item) => `« ${item.text} »`).join(", ");
      throw new Error(`${failed.length} of ${texts.length} line(s) could not be translated (${named}${failed.length > 3 ? ", …" : ""})`);
    }
    return items.map((item) => (item.ok ? item.translation : ""));
  };
}


/*
 * The formatter stack a node renders with, merged — shared by render_document
 * and page_geometry so the numbers the second reports are the numbers the first
 * lays out with. A copy would be the one that drifts.
 */
type ResolvedGeometry =
  | {
      ok: true;
      draft: Awaited<ReturnType<typeof resolveDraftModel>>;
      model: ReturnType<ReturnType<typeof getActiveAdapter>["model"]>;
      renderedFrom: "draft" | "published";
      spec: Extract<ReturnType<typeof resolveRenderSpec>, { ok: true }>;
    }
  | { ok: false; refusal: Record<string, unknown> };

async function resolveGeometryFor(nodeId: string): Promise<ResolvedGeometry> {
  /*
   * Draft when there is one, published otherwise.
   *
   * It used to REFUSE with "no draft to render from". That is right for
   * preview_generation — a preview of nothing is nothing — and wrong here. This
   * renders a DOCUMENT, and with no draft open the published curriculum is
   * exactly what a document would be made from. Refusing meant the tool could
   * produce nothing at all except while somebody happened to be mid-edit, which
   * is not the state the person who wants a sheet is in.
   *
   * Found by calling it against the live server. Every test missed it because
   * every test stages a draft first.
   */
  const draft = await resolveDraftModel(kgNamespace(activeWorkspace(), getActiveAdapter().grade, getActiveAdapter().subject));
  const model = draft?.model ?? getActiveAdapter().model();
  const renderedFrom = draft ? "draft" : "published";

  const stack = formatterStackFor(model, nodeId);
  if (!stack) {
    return { ok: false, refusal: {
      preview: true,
      error:
        `'${nodeId}' is neither a DocumentSection nor a TeachingLearningMaterial in the ${renderedFrom} graph, so it has no formatter stack to render with. ` +
        `Use find_node to turn a name into an id, or walk_document for a document's section ids.`,
    } };
  }

  // The formatters merge before the tree is even looked at: a stack that cannot
  // resolve is the formatter author's problem, and saying so with the formatter
  // ids beats a page that comes out wrong for reasons nobody can trace.
  const spec = resolveRenderSpec(stack);
  if (!spec.ok) {
    return { ok: false, refusal: {
      preview: true,
      error: "The formatter stack for this node does not resolve to a valid render spec.",
      formatters: spec.from,
      problems: spec.errors,
    } };
  }

  /*
   * NO GEOMETRY IS A REFUSAL, NOT A RENDER.
   *
   * Every field of a render spec is optional, so an EMPTY merge parses as valid:
   * `resolveRenderSpec` returned ok with `spec: {}` and `from: []`, and this went
   * on to lay out an unstyled document and report `formatters: []`. That reads as
   * "no formatters were found" when the truth is "N formatters apply and not one
   * of them declares any geometry" — and it hands back a plausible-looking file,
   * which is the worst outcome: it reads as success. Reported from a real session
   * where an expert rebuilt an entire bilingual layout by hand after trusting it.
   *
   * `from` lists only the formatters that actually contributed a `render` bag, so
   * an empty `from` against a non-empty stack is exactly this case. Refuse, and
   * name the formatters that would have had to carry the geometry.
   */
  if (spec.from.length === 0) {
    const applicable = stack.map((node) => node.id);
    return { ok: false, refusal: {
      preview: true,
      error: applicable.length === 0
        ? `No formatter applies to '${nodeId}' in the ${renderedFrom} graph, so there is no geometry to lay a page out with. Attach one with use_formatter.`
        : `${applicable.length} formatter(s) apply to '${nodeId}', but NONE declares a \`render\` bag, so there is no geometry to lay a page out with — every page size, style and margin would be undefined. This is a gap in the formatters, not in your tree: their prose is authored but their \`render\` geometry is not. Add it with edit_nodes (properties.render) on the formatter(s) below, or render outside the server.`,
      formatters: applicable,
      geometryFrom: spec.from,
    } };
  }

  return { ok: true, draft, model, renderedFrom, spec };
}

// ── page_geometry ────────────────────────────────────────────────────────────

type GeometryArgs = {
  nodeId: string;
  /** Pictures the caller means to place, to have them sized before any render. */
  pictures?: { role: string; aspectRatio: number; float?: boolean }[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/*
 * The fixed numbers of a page, before anything is rendered.
 *
 * Every one of them is deterministic — the line pitch, the width left beside
 * a floated band, how tall a 4.6:1 band stands — and every one was being found
 * by rendering, reading the measurement, and rendering again: three measured
 * renders a sheet, two and a half minutes each. This reads the same merged
 * geometry the renderer lays out with and does the arithmetic once, so the
 * first render is a calculation rather than a guess.
 *
 * It sizes pictures with `imageSizeCm`, the renderer's own function, on
 * purpose: a second copy of the sizing rule would be the one that drifts.
 */
export async function pageGeometry(a: GeometryArgs): Promise<Record<string, unknown>> {
  const adapter = getActiveAdapter();
  const ns = kgNamespace(activeWorkspace(), adapter.grade, adapter.subject);
  const denied = await denyIfNotDraftReader(ns);
  if (denied) return denied;

  const resolved = await resolveGeometryFor(a.nodeId);
  if (!resolved.ok) return resolved.refusal;
  const { spec, renderedFrom, draft } = resolved;
  const render = spec.spec;

  const page = PAGE_CM[render.page?.size ?? "A4"] ?? PAGE_CM.A4;
  const landscape = render.page?.orientation === "landscape";
  const widthCm = landscape ? page.h : page.w;
  const heightCm = landscape ? page.w : page.h;
  const margins = render.page?.marginsCm ?? {};
  const usableWidth = usableWidthCm(render);
  const usableHeight = heightCm - (margins.top ?? 0) - (margins.bottom ?? 0);

  // A line's pitch is known only under an exact leading; "atLeast" and "auto"
  // grow with their content, and a number here would be the estimate this
  // project has been burnt by.
  const leadingPt = render.type?.leadingPt;
  const exact = render.type?.leadingRule === "exact" && leadingPt !== undefined;
  const linePitchCm = exact ? round2(leadingPt / (72 / 2.54)) : null;
  const linesPerPage = linePitchCm ? Math.floor(usableHeight / linePitchCm) : null;

  const gutter = floatGutterCm(render);
  const pictures = (a.pictures ?? []).map((picture) => {
    const { w, h } = imageSizeCm({ media: "", role: picture.role, aspectRatio: picture.aspectRatio, float: picture.float }, render);
    const fullWidth = render.images?.fullWidthAboveAspectRatio !== undefined && picture.aspectRatio > render.images.fullWidthAboveAspectRatio;
    const floats = Boolean(picture.float) && !fullWidth;
    return {
      role: picture.role,
      aspectRatio: picture.aspectRatio,
      float: Boolean(picture.float),
      widthCm: round2(w),
      heightCm: round2(h),
      ...(fullWidth ? { fullWidth: true, note: "wider than images.fullWidthAboveAspectRatio: laid out full width, it does not float" } : {}),
      ...(floats ? {
        wrapWidthCm: round2(usableWidth - w - gutter),
        // How many body lines the picture stands beside: the block it anchors
        // to must run at least this long, or the next float draws over it —
        // or a `clear` block ends the wrap.
        ...(linePitchCm ? { linesBeside: Math.ceil(h / linePitchCm) } : {}),
      } : {}),
    };
  });

  return {
    nodeId: a.nodeId,
    resolvedFrom: renderedFrom,
    draftVersion: draft?.draftVersion ?? null,
    formatters: spec.from,
    page: {
      size: render.page?.size ?? "A4",
      orientation: landscape ? "landscape" : "portrait",
      widthCm, heightCm,
      marginsCm: margins,
      usableWidthCm: round2(usableWidth),
      usableHeightCm: round2(usableHeight),
    },
    type: {
      ...(render.type ?? {}),
      linePitchCm,
      linesPerPage,
      ...(exact ? {} : { note: "line pitch is only fixed under an exact leading rule; under atLeast/auto a line grows with its content" }),
    },
    budget: render.budget ?? {},
    // The block styles as the formatter declares them: which names exist, and
    // each one's line budget. What the tree may say `style:` on.
    styles: render.blocks ?? {},
    images: {
      placement: render.images?.placement ?? "float-right",
      gutterCm: gutter,
      maxWidthCm: render.images?.maxWidthCm ?? null,
      fullWidthAboveAspectRatio: render.images?.fullWidthAboveAspectRatio ?? null,
      maxPerSection: render.images?.maxPerSection ?? null,
      maxHeightCm: render.images?.maxHeightCm ?? {},
      inlineHeightCm: render.images?.inlineHeightCm ?? {},
    },
    pictures,
    language: render.language ?? null,
    pagination: render.pagination ?? null,
    howToUse:
      "Every number here is what render_document lays out with. Compose against them: a floated picture's `linesBeside` is how many body lines its anchor block must run before the next float, or put a {kind:'clear'} block after the block that carries it. Then render ONCE with measure:true and read `overlaps` and `reserveKept` on each file.",
  };
}

export async function renderDocument(a: RenderArgs): Promise<Record<string, unknown>> {
  const adapter = getActiveAdapter();
  const ns = kgNamespace(activeWorkspace(), adapter.grade, adapter.subject);

  const denied = await denyIfNotDraftReader(ns);
  if (denied) return denied;

  const resolved = await resolveGeometryFor(a.nodeId);
  if (!resolved.ok) return resolved.refusal;
  const { draft, model, renderedFrom, spec } = resolved;

  // The page: sent inline, or kept from a previous call and patched. A ref
  // that resolves to nothing, or a patch that breaks the tree, is a refusal.
  const input = await resolveTreeInput(ns, a);
  if ("error" in input) return { preview: true, error: input.error };

  const tree = documentSchema.safeParse(input.tree);
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

  /*
   * A PICTURE THE DOCUMENT DOES NOT CARRY IS A REFUSAL, for the same reason no
   * geometry is.
   *
   * `drawingXml` resolves a picture's relationship id with `?? "rId1"`, so a
   * name matching no media entry does not fail — it embeds THE FIRST PICTURE IN
   * THE DOCUMENT instead. The file comes out looking finished with the wrong
   * image in one slot, and nothing about it invites the second look that would
   * catch it. Refusing costs the caller a corrected name.
   *
   * `missingMediaNames` is the same function lint_content reports on, so a page
   * that passed the lint is never refused here for this.
   */
  const missingMedia = missingMediaNames({ blocks: tree.data.blocks, media: tree.data.media });
  if (missingMedia.length > 0) {
    return {
      preview: true,
      error:
        `The tree places ${missingMedia.length} picture(s) that are not in its own \`media\`: ${missingMedia.map((name) => `'${name}'`).join(", ")}. Nothing was rendered. ` +
        `This is refused rather than rendered because the layout falls back to the document's FIRST picture for a name it cannot resolve — the file would look complete with the wrong image in that slot.`,
      hint: "Add each file to `media` (name + base64 `data`, or a bucket `relPath` the server resolves), or correct the name to one already there. lint_content reports this too, before you render.",
      media: (tree.data.media ?? []).map((m) => m.name),
    };
  }

  /*
   * Materialize each picture into bytes. Two ways in: `data` is base64 in the
   * call; `relPath` names an object already in this namespace's documents/ area,
   * which the server reads — so an illustrated document (megabytes of images)
   * need not inline them into the tool call at all.
   *
   * A relPath that resolves to nothing is a REFUSAL, not a silent skip, for the
   * same reason a missing name is above: the layout would fall back to the first
   * picture and the file would look complete with the wrong image in that slot.
   */
  const storage = getStorageAdapter();
  const media: { name: string; data: Buffer }[] = [];
  const unresolved: string[] = [];
  const unattached: string[] = [];
  // Entries asking for the teacher's copy: drawn once every picture is raster.
  const toMark: { name: string; mark: AnswerMark }[] = [];
  for (const m of tree.data.media ?? []) {
    if (m.data !== undefined) {
      media.push({ name: m.name, data: Buffer.from(m.data, "base64") });
      continue;
    }
    /*
     * A `nodeId` is an ATTACHED picture (attach_image): the path comes off the
     * node's own identifier, read from the same graph this render resolves from,
     * so a composer copies an id from `pictures` and never transcribes a path.
     * A node that is not a picture is refused by name — silently reading some
     * other node's bytes is exactly the wrong-image-in-the-slot failure below.
     */
    let relPath: string | undefined = m.relPath;
    if (m.nodeId !== undefined) {
      const attached = attachedPicturePath(model.rawGraph?.nodes ?? [], m.nodeId);
      if ("refused" in attached) {
        unattached.push(`'${m.name}': ${attached.refused}`);
        continue;
      }
      relPath = attached.relPath;
      if (m.mark === "answer") {
        const mark = answerMarkOf(model.rawGraph?.nodes ?? [], m.nodeId);
        if (!mark) {
          unattached.push(`'${m.name}': asks for the answer mark, but '${m.nodeId}' records no correct cell — set it with attach_image's \`answerCells\` (+ \`answerCellsOf\`) or edit_nodes (metadata.answerMark: {cells: [k], of: n})`);
          continue;
        }
        toMark.push({ name: m.name, mark });
      }
    }
    if (!storage.downloadObject) {
      return { preview: true, error: "This storage backend cannot resolve a media `relPath`. Inline the image as base64 `data` instead." };
    }
    const bytes = await storage.downloadObject(relPath as string);
    if (!bytes) {
      unresolved.push(`'${m.name}' (${relPath})`);
      continue;
    }
    media.push({ name: m.name, data: bytes });
  }
  if (unattached.length > 0) {
    return {
      preview: true,
      namespace: ns,
      error:
        `${unattached.length} media entr${unattached.length === 1 ? "y names a node" : "ies name nodes"} that cannot be read as an attached picture from the ${renderedFrom} graph: ${unattached.join("; ")}. Nothing was rendered. ` +
        `A media \`nodeId\` must be a picture attached with attach_image — walk_document_section lists them under \`pictures\`, with the id to use.`,
    };
  }
  if (unresolved.length > 0) {
    return {
      preview: true,
      namespace: ns,
      error:
        `${unresolved.length} media entr${unresolved.length === 1 ? "y names a bucket path" : "ies name bucket paths"} with no object there: ${unresolved.join(", ")}. Nothing was rendered. ` +
        `A relPath is relative to THIS namespace's documents/ area — check the namespace and the path, or upload the image first (create_media_upload_url), then render.`,
    };
  }
  /*
   * A vector picture becomes a raster one HERE, once its bytes are in hand,
   * whichever way they came in. Word embeds raster only, and the pupil book's
   * pictograms are SVG masters; converting at layout lets them live in the
   * media store as files. One that cannot be converted refuses the render,
   * named — a blank where an answer mark should be is not a degraded page.
   */
  const raster = rasterizeSvgMedia(media);
  if (raster.refused.length > 0) {
    return {
      preview: true,
      namespace: ns,
      error:
        `${raster.refused.length} vector picture(s) could not be rasterized: ` +
        raster.refused.map((r) => `'${r.name}' ${r.reason}`).join("; ") +
        ". Nothing was rendered. An SVG is converted to PNG when the page is laid out; fix the file or upload a PNG of it.",
    };
  }
  /*
   * The teacher's copies: a check drawn on the cell the graph records, in the
   * formatter's colour and corner. Drawn AFTER rasterizing, so a vector band
   * takes the mark too; refused by name when the bytes cannot carry one.
   */
  const marked: string[] = [];
  const markFailed: string[] = [];
  for (const entry of raster.media) {
    const ask = toMark.find((m) => m.name === entry.name);
    if (!ask) continue;
    try {
      entry.data = markAnswerCells(entry.data, ask.mark, spec.spec.images?.answerMark ?? {});
      marked.push(entry.name);
    } catch (error) {
      markFailed.push(`'${entry.name}' ${(error as Error).message}`);
    }
  }
  if (markFailed.length > 0) {
    return {
      preview: true, namespace: ns,
      error: `${markFailed.length} picture(s) could not take the answer mark: ${markFailed.join("; ")}. Nothing was rendered.`,
    };
  }

  let composed: DocumentTree = { blocks: tree.data.blocks, media: raster.media };

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
    try {
      composed = await deriveVariant(
        composed, source.id, target.id, source.lang, target.lang,
        glossaryTranslator(await effectiveTerms()),
      );
    } catch (error) {
      // A page with one untranslated line reads as finished, so nothing is
      // rendered; the caller retries, or carries that line in the tree.
      return { preview: true, error: `Deriving '${a.translateInto}' failed: ${(error as Error).message}. Nothing was rendered.` };
    }
  }

  if (!storage.createPreviewUpload) {
    return { preview: true, error: "The active storage backend does not support preview uploads." };
  }

  // One file per language the formatter declares — CI maths composes one source
  // and produces two documents, black lines in both, each colour in its own.
  const variants = splitByVariant(composed, spec.spec);
  const relPath = a.relPath ?? defaultRelPath(a.nodeId);
  const files: Record<string, unknown>[] = [];

  const maxPages = spec.spec.budget?.maxPages;

  /*
   * Counting happens on the RENDER, which is the project's own rule and was
   * paid for: a count derived from the source once put a document at 2.5
   * pages that rendered at eleven. It is opt-in because laying a file out
   * starts a whole office suite, and it reports `available: false` rather
   * than a guess when the environment has no layout engine.
   *
   * The files are measured SIDE BY SIDE, under a budget. A measured render was
   * taking two minutes a file live — two files in sequence overran the
   * client's three-minute limit and the whole response, file included, was
   * lost. A measurement that overruns the budget now comes back as
   * `available:false` with the reason, and the file still ships.
   */
  const rendered = variants.map((variant) => ({ variant, bytes: renderDocx(variant.tree, spec.spec) }));
  const measurements = a.measure
    ? await Promise.all(rendered.map(({ bytes }) => measureDocx(bytes, { timeoutMs: MEASURE_BUDGET_MS })))
    : rendered.map(() => null);

  for (const [index, { variant, bytes }] of rendered.entries()) {
    const measurement = measurements[index];
    const fits = measurement?.available && maxPages !== undefined
      ? measurement.pages <= maxPages
      : null;
    // The reserve is checked against the last MARK on the last page, picture
    // included — a check made on the last word passed on the server and
    // failed in print, by half a centimetre of band.
    const reserve = spec.spec.budget?.reserveBottomCm;
    const lastPage = measurement?.available ? measurement.perPage.at(-1) : undefined;
    const reserveKept = reserve !== undefined && lastPage?.freeBelowCm != null
      ? lastPage.freeBelowCm >= reserve
      : null;
    const overlaps = measurement?.available
      ? measurement.perPage.flatMap((page) => page.overlaps.map((overlap) => ({ page: page.page, ...overlap })))
      : [];
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
      ...(reserveKept === null ? {} : { reserveKept, reserveBottomCm: reserve, lastPageFreeBelowCm: lastPage?.freeBelowCm }),
      // Lifted out of the per-page detail: a file with marks over marks is not
      // finished, whatever its page count says.
      ...(overlaps.length > 0 ? { overlaps } : {}),
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
      ` from ${renderedFrom}${draft?.draftVersion ? ` ${draft.draftVersion}` : ""}`,
  });

  // Kept for the next call — a lint, a patched re-render — so the tree is not
  // retyped. The tree as VALIDATED, before any derived language: re-rendering
  // the ref with translateInto derives again rather than doubling the lines.
  const parked = await parkTree(ns, tree.data);

  return {
    preview: true,
    label: PREVIEW_LABEL,
    ...(parked ?? { treeRef: null, treeRefNote: `The tree was not kept: over ${Math.round(900_000 / 1000)} KB serialized. Name pictures by nodeId or relPath instead of inline data and it will fit.` }),
    files,
    // The single-file shape stays on the response for a monolingual document,
    // so a caller that only ever produces one is not made to index an array.
    ...(files.length === 1 ? { downloadUrl: files[0].downloadUrl, objectKey: files[0].objectKey } : {}),
    blocks: tree.data.blocks.length,
    images: media.length,
    ...(raster.rasterized.length > 0 ? { rasterizedSvg: raster.rasterized } : {}),
    ...(marked.length > 0 ? { answerMarked: marked } : {}),
    formatters: spec.from,
    translatedInto: a.translateInto ?? null,
    // Which graph this was laid out from, so a sheet is never mistaken for one
    // made from edits that are still unpublished.
    renderedFrom,
    draftVersion: draft?.draftVersion ?? null,
    isolation:
      `Rendered from the ${renderedFrom} graph into the segregated previews/ prefix. It will NOT appear in list_documents or reconcile, must NEVER be recorded via log_generation, and expires at expiresAt.`,
  };
}

export function registerRenderTools(server: McpServer) {
  server.registerTool(
    "render_document",
    {
      title: "Render a composed page into a .docx",
      description:
        "Turn a page YOU composed into a Word file. `nodeId` is the DocumentSection (or TeachingLearningMaterial) being rendered; `document` is the block tree — or `treeRef`, the ref a previous compose_section / lint_content / render_document call handed back, so the tree is never retyped: every response carries a fresh `treeRef` for the tree it used. A correction goes as `patch` (a few ops on block paths — replace / insert-before / insert-after / remove, plus media / remove-media) on top of `treeRef`, not as the whole page again. The server merges that node's formatter stack into one render spec, validates the tree against it, lays out the .docx and returns a short-lived `downloadUrl`. " +
        "YOU decide what is on the page — which banner, in what order, where it turns; the FORMATTER decides what it looks like. So the tree carries NO geometry: no colour, no point size, no centimetre. A block names a `style` and a picture names a `role`, both defined by the formatter; a page break says only `pageBreak:'before'` and the formatter's `pagination.pageBreakCarrier` decides how it is written. The tree shape is in get_capabilities section:'document'; call preview_generation first for the section's curriculum, routine and formatter prose. " +
        "Unknown keys are REFUSED rather than ignored, and nothing is rendered when the tree or the stack is invalid — the response names the path. " +
        "PICTURES go in the tree's `media`, each as {name, nodeId} — a picture ATTACHED to the covered curriculum (attach_image; walk_document_section lists them under `pictures` with the id), which the server resolves to its file; add `mark:'answer'` to get the TEACHER'S COPY, the same picture with a check drawn on the cell(s) its node records as correct (`answerMark` in `pictures`; set with attach_image's `answerCells` or edit_nodes), so the key is never drawn by hand and the page still names the attached picture — OR {name, relPath}, a path to an object already in THIS namespace's documents/ area, OR {name, data} with data base64 (an illustrated document is megabytes the tool call cannot carry, so prefer the first two). Prefer nodeId: the graph then knows which picture the page carries, and lint_content can check the page against what is attached. Exactly one of nodeId/relPath/data per entry; an entry that resolves to nothing is refused, naming it, not rendered with the wrong image. A VECTOR picture (SVG, by any of the three) is rasterized to PNG when the page is laid out, so the pictograms' SVG masters can be named directly; an SVG that sets text with a font is refused (the server has no fonts) — convert the text to outlines first. " +
        "ONE SOURCE, ONE FILE PER LANGUAGE. When the formatter's `language.strategy` is 'per-file', each declared variant gets its own document: lines marked `inAllFiles` print in every one, a line tagged with a variant prints only in that variant's file, and `files[]` comes back with one entry each. Pass `translateInto` (a variant id, e.g. 'wo') to have the server DERIVE that language from the one the tree already carries, translating line by line through the subject's MOHEBS glossary so the wording matches materials already in classrooms — a tree that already has those lines is left alone. Translation spends a metered backend, so it needs a ROLE in the workspace. " +
        "Pass `measure:true` to lay each file out and COUNT ITS PAGES — page counts are measured on the render, never estimated from the source (an estimate once put a document at 2.5 pages that rendered at eleven). Each file then carries `measurement` with the page count, the page size actually produced, where every PICTURE landed (`perPage[].images`), and the whitespace left below the last MARK of each page — picture or word; with `budget.maxPages` declared it also carries `fits`, with `budget.reserveBottomCm` declared `reserveKept` for the last page, and `overlaps` names a band drawn over the band before it or over words (the defect a page count never shows). Measuring starts a whole office suite, so it is off by default, and where the deployment has no layout engine it reports `available:false` rather than a guess. " +
        "A tree block {kind:'clear'} ends a wrap: what follows starts below the lowest floated picture, so a short activity beside a tall band no longer lets the next band draw over it. page_geometry gives the numbers to compose against BEFORE rendering — the first render should be a calculation, not a guess. " +
        "Output goes to the SEGREGATED previews/ prefix: short-lived, invisible to list_documents and reconcile, and never to be recorded via log_generation. Renders from the DRAFT when one is open and from PUBLISHED otherwise — `renderedFrom` says which, so a sheet is never mistaken for one made from unpublished edits. Curators and approvers only.",
      inputSchema: {
        nodeId: z.string(),
        document: z.unknown().optional().describe("The block tree. Or pass `treeRef` instead."),
        treeRef: z.string().optional().describe("A tree a previous compose_section / lint_content / render_document call kept (its `treeRef`), instead of re-sending `document`. Lives 24 h, in this namespace."),
        patch: TREE_PATCH_SCHEMA.optional(),
        relPath: z.string().optional(),
        translateInto: z.string().optional(),
        measure: z.boolean().optional(),
      },
    },
    guarded(async (a: RenderArgs) => asJson(await renderDocument(a))),
  );

  server.registerTool(
    "page_geometry",
    {
      title: "The fixed numbers of a page, before rendering",
      description:
        "What render_document will lay a page out with, for a DocumentSection or a whole document (TLM): page size and margins, the usable width and height, the line pitch and lines per page (under an exact leading), the block styles and their line budgets, the image ceilings per role, and — for the `pictures` you say you will place ({role, aspectRatio, float?}) — each one's printed width and height, the width left for text beside a floated one, and `linesBeside`: how many body lines it stands beside, which is how long its anchor block must run before the next float, or where a {kind:'clear'} block goes. " +
        "Read it once per document and compose by arithmetic; then render ONCE with measure:true rather than measuring, guessing and re-rendering. Every number comes from the same merged formatter stack the renderer uses, sized by the renderer's own function, so they cannot disagree with the file. Draft when one is open, published otherwise; refused, naming the formatters, when none carries geometry. Curators and approvers.",
      inputSchema: {
        nodeId: z.string(),
        pictures: z.array(z.object({
          role: z.string().min(1),
          aspectRatio: z.number().positive(),
          float: z.boolean().optional(),
        }).strict()).max(50).optional(),
      },
    },
    guarded(async (a: GeometryArgs) => asJson(await pageGeometry(a))),
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

const asText = (v: unknown): string => (typeof v === "string" ? v : "");

/*
 * Which field of a node the text on the page came from.
 *
 * A node can hold text in more than one place: a Material in `content`, and
 * everything else in `description` — whose first line is the display name and
 * whose remainder, when there is one, is the body. Reading only `content`
 * meant a correction to a DocumentSection or a Lesson matched nothing and was
 * dropped in silence, which is worse than refusing it.
 *
 * When the document's own text matches one of them exactly, that is the field
 * the expert edited and there is nothing to infer. Otherwise the first
 * candidate wins — content, else the body, else the name line — because that
 * is the order in which a node's text is load-bearing.
 */
function resolveTextField(
  props: Record<string, unknown> | undefined, inDocument: string | undefined, markers: readonly string[],
): { text: string; slot: TextSlot } | null {
  const description = asText(props?.description);
  const candidates: Array<{ text: string; slot: TextSlot }> = [];
  const push = (text: string, field: TextSlot["field"]) => { if (text) candidates.push({ text, slot: { field } }); };

  push(asText(props?.content), "content");
  push(descriptionBody(description), "body");
  push(displayName(description), "title");

  if (candidates.length === 0) return null;
  if (inDocument !== undefined) {
    const untouched = candidates.find((c) => normalise(c.text, markers) === inDocument);
    if (untouched) return untouched;
  }
  return candidates[0];
}

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
  const markers = a.markers ?? ["\u2022"];
  const inDocument = documentText(read, markers);

  const current = new Map<string, string>();
  const slots = new Map<string, TextSlot>();
  for (const nodeId of read.anchors) {
    const node = raw?.nodes.find((n) => n.id === nodeId);
    if (!node) continue;
    const chosen = resolveTextField(node.properties as Record<string, unknown>, inDocument.get(nodeId), markers);
    if (!chosen) continue;
    current.set(nodeId, chosen.text);
    slots.set(nodeId, chosen.slot);
  }

  const proposals = proposeEdits(read, current, { markers });
  const edits = editItems(proposals, slots);
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
