/*
 * Module: server · tool group: preview generation (draft-resolved)
 *
 * Closes the editing loop: the #5 dry-run shows the DIFF a staged edit makes to
 * the graph; preview_generation shows the RESULT — the teaching material that
 * same edit would yield — by resolving the curriculum from the DRAFT slot
 * instead of published, and running the SAME generation flow on it.
 *
 * A preview is taken at the size of the thing that changed: one DocumentSection,
 * one document (TLM), or a whole Course. The published readers already resolve
 * all three, so this is routing rather than new machinery — what it adds is the
 * draft slot, the PREVIEW label, the audited preview event, and the segregated
 * output path below.
 *
 * ISOLATION is the whole point. A preview:
 *   • reads the DRAFT (unpublished) — it does NOT mutate the graph;
 *   • NEVER reads or writes published;
 *   • its .docx output goes to a SEGREGATED previews/ prefix (not the canonical
 *     documents/ bucket), via short-lived, clearly-labelled signed URLs, and is
 *     NEVER recorded through log_generation / list_documents / history;
 *   • is role-gated to the same trust tier as diff_draft (curator + approver;
 *     unknown/no-role blocked + audited), because a draft is pre-publish WIP.
 *
 * What is REUSED (not rebuilt): the exact draft slot diff_draft reads (pointer
 * .draftSlot → listNodes/listEdges), the store-bridge deserializeToModel (#3),
 * and the subject adapter's own buildGenerationContext — which now accepts a
 * pre-resolved model so the published read path stays byte-identical.
 *
 * The tool bodies delegate to the exported cores below (previewGeneration /
 * createPreviewUploadUrl) so tests can drive the real logic directly, the same
 * way capabilities.ts exposes buildCapabilitiesReport.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { asJson, guarded } from "./shared.js";
import { timed, timedSync } from "../utils/index.js";
import { getActiveAdapter } from "../adapters/index.js";
import { activeWorkspace } from "../context/index.js";
import { getKgStore, kgNamespace, toAuditActor, nextAuditSeq } from "../kg-store/index.js";
import { toRawEnvelope, courseSubgraph, documentSubgraph, documentSectionSubgraph } from "../curriculum/index.js";
import { getStorageAdapter } from "../storage/index.js";
import { authorize } from "../authz.js";
import { currentActor } from "../actor.js";
import type { CurriculumModel } from "../types.js";

// The single, fixed label every preview surface carries so the material can
// never be mistaken for a published deliverable.
export const PREVIEW_LABEL = "PREVIEW — generated from an unpublished draft, not a published deliverable";

// Resolve the curriculum from the DRAFT slot — the same slot diff_draft reads —
// or null when there is no draft to preview (→ the caller surfaces the clear "no
// draft" notice). The deserialize step is the same store-bridge path activate.ts
// uses for published.
export async function resolveDraftModel(
  ns: string,
): Promise<{ model: CurriculumModel; draftSlot: string; draftVersion: string | null } | null> {
  const store = getKgStore();
  const pointer = await store.readPointer(ns);
  if (!pointer || !pointer.draftSlot) return null;
  const [nodes, edges, meta] = await timed("draftRead.readGraph", () => Promise.all([
    store.listNodes(ns, pointer.draftSlot!),
    store.listEdges(ns, pointer.draftSlot!),
    store.readMeta(ns, pointer.draftSlot!),
  ]));
  return {
    // Same full-graph hydration as activate.ts: rebuild the LC envelope from the
    // draft slot and run the active adapter's parser to derive the spine model.
    model: timedSync("draftRead.parse", () => getActiveAdapter().parse(toRawEnvelope({ nodes, edges }))),
    draftSlot: pointer.draftSlot,
    draftVersion: meta?.contentHash ?? null,
  };
}

// Shared role gate for the preview surface. Same tier as diff_draft's readDraft:
// curator + approver may preview; unknown/no-role is blocked and audited (never
// leaks draft content). Returns the unauthorized payload when denied, or null
// when allowed. Not a mutation → no token, no two-phase confirm.
async function denyIfNotDraftReader(ns: string): Promise<Record<string, unknown> | null> {
  const actor = currentActor();
  const authz = authorize(actor, "readDraft", ns);
  if (authz.ok) return null;
  await getKgStore().appendAudit({
    id: randomUUID(),
    ts: new Date().toISOString(), seq: nextAuditSeq(),
    actor: toAuditActor(actor),
    namespace: ns,
    eventType: "blocked",
    reason: `unauthorized: ${authz.reason}`,
  });
  return { phase: "unauthorized", preview: true, action: "readDraft", reason: authz.reason };
}

// ── Core: preview_generation ─────────────────────────────────────────────────
// The draft-resolved read of ONE piece of work, tagged as a preview. Reads only;
// no graph write. Exported so tests drive the real logic.

// What a preview can be taken of, in the order the resolvers are tried. Each
// resolver returns null unless the id really is a node of that label, so trying
// them in turn IS the dispatch — no label vocabulary is duplicated here.
//
// Three scopes, not one, because a preview is only useful at the size of the
// thing you just edited (self-serve-authoring.md, phase 4): changing one routine
// step used to mean regenerating a whole chapter to see the effect.
// `previewOf` rather than `scope`: walk_document already returns a `scope` of its
// own (how it resolved the curriculum — sections / course / none), and the
// resolver's payload is spread into this response verbatim.
const PREVIEW_SCOPES = [
  { previewOf: "section", of: "a DocumentSection — one slot of a document", resolve: documentSectionSubgraph },
  { previewOf: "document", of: "a TeachingLearningMaterial — a whole document", resolve: documentSubgraph },
  { previewOf: "course", of: "a Course — the curriculum subtree", resolve: courseSubgraph },
] as const;

export async function previewGeneration(nodeId: string): Promise<Record<string, unknown>> {
  const adapter = getActiveAdapter();
  const ns = kgNamespace(activeWorkspace(), adapter.grade, adapter.subject);

  const denied = await denyIfNotDraftReader(ns);
  if (denied) return denied;

  const resolved = await resolveDraftModel(ns);
  if (!resolved) {
    return {
      preview: true,
      noDraft: true,
      message:
        `No draft exists for '${ns}' to preview. A preview reflects UNPUBLISHED draft edits, so with no draft there is nothing to preview. ` +
        `Stage an edit first (add_nodes / edit_nodes / add_section / …), then call preview_generation again.`,
    };
  }

  // Read the SAME subtree the published generation path exposes — but from the
  // draft-resolved model, so the curator sees what a staged edit would generate
  // from. The standards spine (get_standards) resolves against published as usual.
  const matched = PREVIEW_SCOPES
    .map((candidate) => ({ ...candidate, sub: candidate.resolve(resolved.model, nodeId) }))
    .find((candidate) => candidate.sub !== null);

  if (!matched) {
    return {
      preview: true,
      error:
        `'${nodeId}' is not a previewable node in the draft. A preview is taken of ${PREVIEW_SCOPES.map((s) => s.of).join(", or ")}. ` +
        `Use find_node to turn a name into an id, walk_document for a document's section ids, or namespace_stats for the roots.`,
    };
  }

  // Audit a PREVIEW event — distinct from apply/publish/generation, and never
  // recorded via log_generation. It documents who read unpublished draft content
  // to preview it, without masquerading as a real deliverable.
  await getKgStore().appendAudit({
    id: randomUUID(),
    ts: new Date().toISOString(), seq: nextAuditSeq(),
    actor: toAuditActor(currentActor()),
    namespace: ns,
    eventType: "preview",
    reason: `preview generation for ${matched.previewOf} '${nodeId}' from draft${resolved.draftVersion ? ` ${resolved.draftVersion}` : ""}`,
  });

  return {
    preview: true,
    previewOf: matched.previewOf,
    label: PREVIEW_LABEL,
    isolation:
      "This was resolved from the UNPUBLISHED draft. Generate the .docx from it, then surface the result via create_preview_upload_url. Do NOT call log_generation or create_upload_url with a preview — those write to the canonical documents bucket and history and would break the isolation.",
    draftVersion: resolved.draftVersion,
    ...matched.sub,
  };
}

// ── Core: create_preview_upload_url ──────────────────────────────────────────
// The preview output path. Mints a short-lived write+read URL pair for a
// throwaway .docx under the SIBLING previews/ prefix — never the canonical
// documents/ keyspace, never logged to history. No confirmation: it is not a
// canonical write, it auto-expires, and it is part of the read-like preview
// flow. Role-gated to the same tier as previewGeneration.
export async function createPreviewUploadUrl(relPath: string): Promise<Record<string, unknown>> {
  const adapter = getActiveAdapter();
  const ns = kgNamespace(activeWorkspace(), adapter.grade, adapter.subject);

  const denied = await denyIfNotDraftReader(ns);
  if (denied) return denied;

  const storage = getStorageAdapter();
  if (!storage.createPreviewUpload) {
    return { preview: true, error: "The active storage backend does not support preview uploads." };
  }
  const signed = await storage.createPreviewUpload(relPath);
  return {
    preview: true,
    label: PREVIEW_LABEL,
    ...signed,
    note:
      "PUT the generated .docx to uploadUrl, then hand the human downloadUrl. This object is under previews/ (segregated from the canonical documents bucket) — it will NOT appear in list_documents/reconcile and must NEVER be recorded via log_generation. It expires at expiresAt.",
  };
}

export function registerPreviewTools(server: McpServer) {
  server.registerTool(
    "preview_generation",
    {
      title: "Preview generation from the draft",
      description:
        "Return, resolved from the UNPUBLISHED DRAFT (not published), everything generation needs to produce ONE piece of material — so you can generate a PREVIEW of what a staged edit would yield, before publishing. This closes the editing loop: dry-run shows the graph DIFF, preview shows the resulting MATERIAL. `nodeId` may be a DocumentSection (one slot of a document — what walk_document_section returns), a TeachingLearningMaterial (a whole document — what walk_document returns), or a Course (the curriculum subtree — what walk_graph returns); the response's `previewOf` says which was matched. Preview the SMALLEST piece you changed: after editing one section, preview that section rather than its whole document. Get ids from find_node (a name → ids), walk_document (a document's `sections` spine), or namespace_stats (the roots). Read-only on the draft (no graph change). Curators and approvers only. If no draft exists, returns a clear 'no draft to preview' notice. IMPORTANT: what comes back is a PREVIEW — generate the .docx from it, then surface it via create_preview_upload_url (segregated, short-lived, non-canonical). NEVER log_generation or create_upload_url a preview: those write to the canonical bucket/history and would defeat the isolation.",
      inputSchema: {
        nodeId: z.string().optional(),
        // `course` is the argument this tool took when a preview could only be a
        // whole Course. Still accepted so an in-flight caller isn't broken mid-deploy.
        course: z.string().optional(),
      },
    },
    guarded(async (a: { nodeId?: string; course?: string }) => {
      const nodeId = a.nodeId ?? a.course;
      if (!nodeId) {
        return asJson({ preview: true, error: "preview_generation needs a 'nodeId' — a DocumentSection, a TeachingLearningMaterial, or a Course. find_node turns a name into an id." });
      }
      return asJson(await previewGeneration(nodeId));
    }),
  );

  server.registerTool(
    "create_preview_upload_url",
    {
      title: "Create preview upload URL",
      description:
        "Get short-lived signed URLs to upload and read a PREVIEW .docx generated from a draft (via preview_generation). Returns { uploadUrl, downloadUrl, objectKey, expiresAt, label }. Upload the .docx to uploadUrl with an HTTP PUT (Content-Type application/vnd.openxmlformats-officedocument.wordprocessingml.document), then hand the human downloadUrl to open it. relPath is like 'chapitre_05/Manuel - Chapitre 5.docx'. The object lives under a SEGREGATED previews/ prefix: it is NOT in the canonical documents bucket, NEVER appears in list_documents or reconcile, and is NEVER logged via log_generation. It expires quickly. Curators and approvers only. Do NOT call log_generation for a preview.",
      inputSchema: { relPath: z.string() },
    },
    guarded(async (a: { relPath: string }) => asJson(await createPreviewUploadUrl(a.relPath))),
  );
}
