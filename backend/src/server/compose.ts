/*
 * Tool: compose_section — a page from the graph and its layout templates.
 *
 * The read-only counterpart of render_document's input: it returns the block
 * tree render_document takes, filled from the graph by the templates on the
 * section's formatter stack (curriculum/compose.ts). No model composes what a
 * template covers, so the page is the same on every call; what no template
 * covers is reported as `unfilled`, with its guide, for the model to compose.
 *
 * Reads the draft when one is open and published otherwise, like
 * render_document, so a section composed here is what a render would lay out.
 * Curators and approvers only: it reads picture files from the documents area
 * for their shape.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parkTree } from "./tree-park.js";
import { z } from "zod";
import { asJson, guarded } from "./shared.js";
import { getActiveAdapter } from "../adapters/index.js";
import { activeWorkspace } from "../context/index.js";
import { kgNamespace } from "../kg-store/index.js";
import { resolveLayout } from "../kg-recipes/index.js";
import { composeSection, formatterStackFor, resolveRef, type MediaRef, type FoundNode } from "../curriculum/index.js";
import { imageAspectRatio, resolveRenderSpec } from "../render/index.js";
import { getStorageAdapter } from "../storage/index.js";
import { readActiveGraphWithSlot } from "./catalog.js";
import { withContextOverride, contextField, type WithContext } from "./context-override.js";
import { resolveDraftModel, denyIfNotDraftReader } from "./preview.js";

const SECTION_LABELS = ["DocumentSection"];

type ComposeArgs = WithContext & {
  section?: string;   // the section, by name (or id)
};

function activeNamespace(): string {
  const adapter = getActiveAdapter();
  return kgNamespace(activeWorkspace(), adapter.grade, adapter.subject);
}

// The renderer names an attached picture by node id and a fixed asset by
// path; both resolve to bytes in the namespace's documents area.
async function relPathOf(ref: MediaRef, nodes: Array<{ id: string; properties?: Record<string, unknown> }>): Promise<string | null> {
  if ("relPath" in ref) return ref.relPath;
  const node = nodes.find((n) => n.id === ref.nodeId);
  const identifier = (node?.properties?.raw as Record<string, unknown> | undefined)?.identifier ?? node?.properties?.identifier;
  if (typeof identifier !== "string") return null;
  const marker = "/documents/";
  const at = identifier.indexOf(marker);
  return at < 0 ? null : identifier.slice(at + marker.length);
}

async function composeResolved(a: ComposeArgs): Promise<Record<string, unknown>> {
  const ns = activeNamespace();
  const denied = await denyIfNotDraftReader(ns);
  if (denied) return denied;
  if (!a.section) return { error: "`section` is required: the name of the section to compose (find_node turns a name into one; walk_document lists a document's sections)." };

  const { graph } = await readActiveGraphWithSlot(ns);
  const resolved = resolveRef(graph, a.section, { labels: SECTION_LABELS });
  if (!resolved.ok) {
    return resolved.reason === "none"
      ? { error: `Nothing matches « ${a.section} » among the document sections. Try find_node with fewer words, or walk_document for a document's sections.` }
      : { needsChoice: true, message: `Several sections match « ${a.section} »: ask which, quoting each candidate's path, then call again with that candidate's id.`, candidates: resolved.candidates as FoundNode[] };
  }

  const draft = await resolveDraftModel(ns);
  const model = draft?.model ?? getActiveAdapter().model();
  const composedFrom = draft ? "draft" : "published";

  const stack = formatterStackFor(model, resolved.id);
  if (!stack) return { error: `'${resolved.id}' has no formatter stack in the ${composedFrom} graph.` };
  const layout = resolveLayout(stack);
  if (!layout.ok) {
    return { error: `The layout templates on this section's formatter stack are invalid, so nothing was composed: ${layout.errors.join("; ")}`, from: layout.from };
  }

  const storage = getStorageAdapter();
  const ratioCache = new Map<string, number | null>();
  const ratioOf = async (ref: MediaRef): Promise<number | null> => {
    const relPath = await relPathOf(ref, model.rawGraph?.nodes ?? []);
    if (!relPath || !storage.downloadObject) return null;
    if (!ratioCache.has(relPath)) {
      const bytes = await storage.downloadObject(relPath);
      ratioCache.set(relPath, bytes ? imageAspectRatio(bytes) : null);
    }
    return ratioCache.get(relPath) ?? null;
  };

  // The one geometry value a compiled guide needs — whether a band floats —
  // read from the same merged render bag the renderer will lay the page out with.
  const render = resolveRenderSpec(stack);
  const floatUnlessRatioAbove = render.ok ? render.spec.images?.fullWidthAboveAspectRatio : undefined;
  const result = await composeSection(model, resolved.id, layout.templates, ratioOf, {
    ...(layout.guide ? { grammar: layout.guide } : {}),
    ...(floatUnlessRatioAbove !== undefined ? { floatUnlessRatioAbove } : {}),
  });
  if (!result) return { error: `'${resolved.id}' is not a DocumentSection in the ${composedFrom} graph.` };

  const filledEverything = result.unfilled.length === 0 && result.problems.length === 0;
  const document = { blocks: result.blocks, media: result.media };
  // Kept server-side so the lint and the render that follow name it by ref
  // (and patch in the unfilled sections) rather than retyping 20 KB of page.
  const parked = await parkTree(ns, document);
  return {
    namespace: ns,
    composedFrom,
    sectionId: resolved.id,
    templatesFrom: layout.from,
    document,
    ...(parked ?? { treeRef: null }),
    used: result.used,
    unfilled: result.unfilled,
    // Per section the grammar compiled: lines printed and kept in the guide,
    // pictures placed, and what could not be resolved (also under `problems`).
    ...(result.compiled.length > 0 ? { compiled: result.compiled } : {}),
    problems: result.problems,
    complete: filledEverything,
    note: layout.templates.length === 0
      ? "No formatter on this section's stack declares `layout` templates, so nothing was composed: the whole section is reported as unfilled. Author templates on the formatter (properties.layout) to compose this document without a model."
      : filledEverything
        ? (result.compiled.length > 0
          ? "Every section matched a template, and the guide compiler wrote the sections the templates handed it (see `compiled`: lines printed, lines kept in the guide, pictures placed). `document` is ready for lint_content and render_document as it stands — name it by `treeRef` rather than re-sending it; read the page, do not recompose it."
          : "Every section matched a template: `document` is ready for lint_content and render_document as it stands — name it by `treeRef` rather than re-sending it.")
        : "`document` holds what the templates filled; compose the `unfilled` sections from their guide and insert them at their place — as a `patch` on `treeRef` (insert-before / insert-after at their block path), so the filled part is not retyped — then lint_content and render_document by ref. `problems` name what a template asked for and the graph lacks — fix the graph (attach_image, edit_nodes), never the page.",
  };
}

export async function runComposeSection(a: ComposeArgs): Promise<Record<string, unknown>> {
  return withContextOverride(a.context, () => composeResolved(a)) as Promise<Record<string, unknown>>;
}

export function registerComposeTools(server: McpServer) {
  server.registerTool(
    "compose_section",
    {
      title: "Compose a section's page from the graph, by its layout templates",
      description:
        "Build the block tree render_document takes for ONE section — from the graph, with no model — using the `layout` templates its formatter stack declares. `section` is the section BY NAME (find_node resolves it; several matches return `needsChoice` + candidates). " +
        "A template is a block tree with placeholders; the composer fills them from what the section covers (its title, name, content lines, ordinal names, its grouping) and from the pictures attached to it (by name pattern) or fixed assets (one per rank, for a marker that follows the section's position). Same graph, same page, every call — and a directive or a picture cannot be transcribed wrong, because they are copied, not composed. " +
        "The response is `document` (blocks + media, media as {name, nodeId} or {name, relPath}), ready for lint_content and render_document; `unfilled` lists the sections no template matched, each with its guide — those are YOURS to compose and insert at their place; `problems` lists what a template asked for and the graph lacks (fix the graph, never the page). `complete:true` means nothing is left to compose. A stack with no `layout` composes nothing and says so. " +
        "Reads the DRAFT when one is open, PUBLISHED otherwise (`composedFrom`). Curators and approvers only.",
      inputSchema: {
        section: z.string().optional(),
        ...contextField,
      },
    },
    guarded(async (a: ComposeArgs) => asJson(await runComposeSection(a))),
  );
}
