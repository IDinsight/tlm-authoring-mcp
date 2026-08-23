/*
 * Module: server · tool group: document task verbs (create_document, add_section)
 *
 * The expert says "I want a revision sheet for chapter 5". Until now the surface
 * answered "add a node, then create an edge" — and when the edge was forgotten
 * nothing errored: generation just read an empty document. These two verbs make
 * the pair atomic (docs/design-notes/self-serve-authoring.md, phase 3 + D3).
 *
 * They are NOT the retired typed adds coming back. Those were thin facades over
 * one addNode call with no invariant of their own. Each of these enforces a
 * MULTI-ELEMENT invariant a primitive call can silently violate — a document
 * without its `covers` edge, a section missing one of its two axes.
 *
 * Both take NAMES, not ids (D9): "Chapitre 5" resolves server-side, and an
 * ambiguous name comes back as CANDIDATES so the model asks which one rather
 * than guessing — because guessing writes the document against the wrong chapter
 * and says nothing.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { asJson, guarded } from "./shared.js";
import { getActiveAdapter } from "../adapters/index.js";
import { activeWorkspace } from "../context/index.js";
import { kgNamespace, mintNodeId } from "../kg-store/index.js";
import { createDocument, addSection } from "../kg-recipes/index.js";
import { resolveRef, type FoundNode } from "../curriculum/index.js";
import { readActiveGraphWithSlot } from "./catalog.js";
import { runBatchMutation, type ReturnMode } from "./batch.js";
import { idempotencyPayloadHash } from "./idempotency.js";

function activeNamespace(): string {
  const adapter = getActiveAdapter();
  return kgNamespace(activeWorkspace(), adapter.grade, adapter.subject);
}

// Curriculum labels a document or a section may cover — used to narrow a name
// match, so "Chapitre 5" cannot resolve to a same-named document.
const CURRICULUM_LABELS = ["Course", "LessonGrouping", "Lesson", "StandardsFrameworkItem"];

// A "did you mean" answer: no state change, no token, and the candidates the
// model reads back to the user.
function needsChoice(what: string, typed: string, candidates: FoundNode[]): Record<string, unknown> {
  return {
    needsChoice: true,
    message:
      `Several elements match « ${typed} » (${what}). Ask the user which one, in their own language: each candidate's \`path\` says which course or document it sits in, and its \`labels\` say how they differ (a chapter and the lesson inside it often carry the same name). ` +
      `Then call this tool again passing the chosen candidate's \`id\` — the name alone cannot separate them. Do not choose on the user's behalf.`,
    candidates,
  };
}

function notFound(what: string, typed: string): Record<string, unknown> {
  return {
    error: `Nothing matches « ${typed} » (${what}). Try find_node with fewer words to see what exists, or ask the user to be more specific.`,
  };
}

// Resolve one name (or id) against the draft-preferred graph — the same slot the
// write will land on, so a chapter created earlier in this draft is nameable.
async function resolveOne(
  namespace: string,
  typed: string,
  labels: string[] | undefined,
  what: string,
): Promise<{ id: string } | { answer: Record<string, unknown> }> {
  const { graph } = await readActiveGraphWithSlot(namespace);
  const resolved = resolveRef(graph, typed, { labels });
  if (resolved.ok) return { id: resolved.id };
  return { answer: resolved.reason === "none" ? notFound(what, typed) : needsChoice(what, typed, resolved.candidates) };
}

// ── create_document ──────────────────────────────────────────────────────────

type CreateDocumentToolArgs = {
  name?: string;
  covers?: string;
  properties?: Record<string, unknown>;
  returnMode?: ReturnMode;
  idempotencyKey?: string;
  confirm?: boolean;
  confirmationToken?: string;
  mintedNodeId?: string;
};

// Exported so tests drive the real logic (like runAddNodes).
export async function runCreateDocument(a: CreateDocumentToolArgs): Promise<Record<string, unknown>> {
  const namespace = activeNamespace();

  // Token-only confirm: the dry-run parked everything, so nothing is re-resolved
  // (re-resolving a name on confirm could silently pick a different node).
  if (a.confirm && !a.name) {
    return runBatchMutation({
      namespace, mutation: createDocument,
      args: { namespace, newNodeId: "", name: "", coversId: "" },
      confirm: true, token: a.confirmationToken,
      returnMode: a.returnMode ?? "summary",
      idempotencyKey: a.idempotencyKey,
      payloadHash: "", extra: {}, storePayload: true,
    });
  }

  if (!a.name) return { error: "`name` is required: give the document the name the user would call it." };
  if (!a.covers) return { error: "`covers` is required: say which curriculum content this document must produce (the name of the course, chapter or week)." };

  const target = await resolveOne(namespace, a.covers, CURRICULUM_LABELS, "le contenu à couvrir");
  if ("answer" in target) return target.answer;

  const newNodeId = a.confirm ? (a.mintedNodeId ?? "") : mintNodeId();
  const args = { namespace, newNodeId, name: a.name, coversId: target.id, properties: a.properties };

  return runBatchMutation({
    namespace, mutation: createDocument, args,
    confirm: a.confirm, token: a.confirmationToken,
    returnMode: a.returnMode ?? "summary",
    idempotencyKey: a.idempotencyKey,
    payloadHash: idempotencyPayloadHash(args),
    extra: { mintedNodeIds: [newNodeId] },
    storePayload: true,
  });
}

// ── add_section ──────────────────────────────────────────────────────────────

type AddSectionToolArgs = {
  document?: string;
  name?: string;
  position?: number;
  covers?: string;
  properties?: Record<string, unknown>;
  returnMode?: ReturnMode;
  idempotencyKey?: string;
  confirm?: boolean;
  confirmationToken?: string;
  mintedNodeId?: string;
};

export async function runAddSection(a: AddSectionToolArgs): Promise<Record<string, unknown>> {
  const namespace = activeNamespace();

  if (a.confirm && !a.name) {
    return runBatchMutation({
      namespace, mutation: addSection,
      args: { namespace, newNodeId: "", documentId: "", name: "" },
      confirm: true, token: a.confirmationToken,
      returnMode: a.returnMode ?? "summary",
      idempotencyKey: a.idempotencyKey,
      payloadHash: "", extra: {}, storePayload: true,
    });
  }

  if (!a.document) return { error: "`document` is required: the name of the document this section belongs to." };
  if (!a.name) return { error: "`name` is required: the section's title." };

  const document = await resolveOne(namespace, a.document, ["TeachingLearningMaterial"], "le document");
  if ("answer" in document) return document.answer;

  let coversId: string | undefined;
  if (a.covers) {
    const target = await resolveOne(namespace, a.covers, CURRICULUM_LABELS, "le contenu à couvrir");
    if ("answer" in target) return target.answer;
    coversId = target.id;
  }

  const newNodeId = a.confirm ? (a.mintedNodeId ?? "") : mintNodeId();
  const args = { namespace, newNodeId, documentId: document.id, name: a.name, position: a.position, coversId, properties: a.properties };

  return runBatchMutation({
    namespace, mutation: addSection, args,
    confirm: a.confirm, token: a.confirmationToken,
    returnMode: a.returnMode ?? "summary",
    idempotencyKey: a.idempotencyKey,
    payloadHash: idempotencyPayloadHash(args),
    extra: { mintedNodeIds: [newNodeId] },
    storePayload: true,
  });
}

export function registerDocumentAuthoringTools(server: McpServer) {
  server.registerTool(
    "create_document",
    {
      title: "Create a document and attach it to the curriculum",
      description:
        "Create a DOCUMENT (a manual, a teacher's guide, a revision sheet) AND attach it to the curriculum it renders — in ONE atomic step. Use this instead of add_nodes + create_edges for a new document: a TeachingLearningMaterial without its `covers` edge is a valid graph write and a BROKEN document (generation reads it as empty and nothing errors). " +
        "`name` is what the user calls it. `covers` is the content it must produce, given BY NAME — « chapter 5 », « Guide de l'enseignant », « week 3 » (whatever the user calls it, in their language): the server resolves it, so never ask the user for an id. When several nodes share that name (a chapter and the lesson inside it commonly do) it returns `needsChoice` + `candidates`, each with its `labels` and containment `path`: ask the user which, then re-call passing that candidate's `id` as `covers` — an id always resolves to itself. Never pick for them. `properties` optionally carries audience / mediumType / 'metadata.assemblyGuide' (the document's own build instructions). " +
        "REQUIRES CONFIRMATION: the dry-run returns a summary + confirmationToken + the new document's id in `mintedNodeIds`; confirm with confirm:true + the token (re-send `name`, `covers` and `mintedNodeId` unless the response reported `payloadStored:true`). DRAFT edit — publish_draft to make it live. Next: add_section to give it a spine, use_formatter to give it a style.",
      inputSchema: {
        name: z.string().optional(),
        covers: z.string().optional(),
        properties: z.record(z.string(), z.unknown()).optional(),
        returnMode: z.enum(["summary", "full"]).optional(),
        idempotencyKey: z.string().optional(),
        confirm: z.boolean().optional(),
        confirmationToken: z.string().optional(),
        mintedNodeId: z.string().optional(),
      },
    },
    guarded(async (a: CreateDocumentToolArgs) => asJson(await runCreateDocument(a))),
  );

  server.registerTool(
    "add_section",
    {
      title: "Add a section to a document",
      description:
        "Add a SECTION to a document AND bind it to the curriculum that section renders — in ONE atomic step. A section needs two links on two different axes (it belongs to the document, and it covers a piece of curriculum); wiring them separately lets either go missing silently. " +
        "`document` and `covers` are given BY NAME (« Guide de l'enseignant », « chapter 5 » — in the user's own words); the server resolves them and returns `needsChoice` + `candidates` when a name is ambiguous — ask the user which, then re-call with that candidate's `id`. Don't guess. `position` orders the section within the document (defaults to appending). OMIT `covers` only for FRONT MATTER — a cover page, a table of contents, an introduction that renders no curriculum. " +
        "REQUIRES CONFIRMATION: the dry-run returns a summary + confirmationToken + the section's id in `mintedNodeIds`; confirm with confirm:true + the token (re-send the same fields + `mintedNodeId` unless `payloadStored:true`). DRAFT edit — publish_draft to make it live. Generation reads one section at a time via walk_document_section, so a document's sections are the real unit of work.",
      inputSchema: {
        document: z.string().optional(),
        name: z.string().optional(),
        position: z.number().optional(),
        covers: z.string().optional(),
        properties: z.record(z.string(), z.unknown()).optional(),
        returnMode: z.enum(["summary", "full"]).optional(),
        idempotencyKey: z.string().optional(),
        confirm: z.boolean().optional(),
        confirmationToken: z.string().optional(),
        mintedNodeId: z.string().optional(),
      },
    },
    guarded(async (a: AddSectionToolArgs) => asJson(await runAddSection(a))),
  );
}
