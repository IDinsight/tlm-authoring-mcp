/*
 * Module: server · tool group: documents & history (bucket)
 *
 * Reconcile, list, signed upload/download URLs, text extraction, and recording
 * what was generated or ingested. A document's identity is the graph node it
 * covers (nodeId); its chapter/week ordinal is resolved from the active graph
 * at query time (the `unit` filter/sort), not stored on the history entry.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { asJson, asText, guarded, requireConfirmation } from "./shared.js";
import { denyUnlessMember, type MemberAction } from "./membership.js";
import { getActiveAdapter } from "../adapters/index.js";
import { activeWorkspace } from "../context/index.js";
import { kgNamespace } from "../kg-store/index.js";
import { getStorageAdapter, extractDocxText, listEntries, recordContent, reconcile } from "../storage/index.js";
import type { HistoryEntry } from "../types.js";
import { WORKSPACE_ROLE_NOTE } from "./tool-notes.js";
import { DETAIL_LEVELS, DEFAULT_DETAIL, takeWithinBudget, trimmedBySizeHint, type DetailLevel } from "../utils/index.js";

// A file is identified by its path, and a node holds as many as it needs. Both
// write tools say so, because the mental model they replaced was the opposite.
const FILE_KEYED_NOTE =
  "ONE ENTRY PER FILE: history is keyed by `relPath`, so a node holds as MANY files as it has — a CI-maths lesson has four (pupil tool FR and WO, teacher guide FR and WO). Recording a second file on a node ADDS it. `nodeId` says which curriculum node the file covers; `documentId` (optional) which document it was produced from, and `variant` (optional) which rendering — those two are what tell apart two files covering the same lesson. Re-recording the SAME relPath updates it. Re-recording it against a DIFFERENT nodeId is refused (it would move the file, not add one) unless you pass `replace: true`.";

// A document belongs to the workspace whose namespace it hangs under, so the
// membership check reads that namespace — the same one history is keyed by.
function activeNamespace(): string {
  const a = getActiveAdapter();
  return kgNamespace(activeWorkspace(), a.grade, a.subject);
}

// Every tool here touches the LIVE bucket or history: signed URLs to produced
// .docx, and writes with no draft and no undo. Reading the published graph
// needs no role; this does. See server/membership.ts.
function denyNonMember(action: MemberAction) {
  return denyUnlessMember(action, activeNamespace());
}

// ── list_documents pagination + filters ──────────────────────────────────────
// listEntries() is sorted (unit-hint asc, then nodeId asc) and stable, so we
// page with an opaque cursor pinned to the last entry's (unit, nodeId) — the
// same limit + cursor contract as read_audit. The cursor carries both keys so
// the ordering survives a missing unit hint (a unit-less entry sorts last, by
// nodeId).
//
// SINGLE SOURCE OF TRUTH: `listDocumentsShape` below is the ONE Zod shape used
// both as the tool's advertised `inputSchema` (so clients see the args and their
// types) AND as the runtime validator (the MCP SDK parses arguments against it
// before the handler runs). There is no second, divergent hand-rolled validator.
const DEFAULT_PAGE = 25;
const MAX_PAGE = 100;

// The advertised + enforced input schema (mirrors read_audit's limit/cursor
// convention). Filter by the scope nodeId (a document's identity) or, for
// convenience, by the chapter/week ordinal (CI maths: chapter number) — the
// ordinal is resolved from the scope node in the active graph, not stored.
export const listDocumentsShape = {
  detail: z.enum(DETAIL_LEVELS).optional().describe("How much of each entry to return: 'names' (default — identity + when it was recorded), 'summary' (adds source and content COUNTS), 'full' (the whole content record — large)."),
  cursor: z.string().optional().describe("Opaque cursor from a prior page's nextCursor. Omit to start at the first document."),
  limit: z.number().int().min(1).max(MAX_PAGE).optional().describe(`Page size, 1..${MAX_PAGE} (default ${DEFAULT_PAGE}).`),
  nodeId: z.string().optional().describe("Filter to every file covering one curriculum node — a CI-maths lesson has four."),
  unit: z.number().int().optional().describe("Filter to one chapter/week ordinal (CI maths: chapter number)."),
  documentId: z.string().optional().describe("Filter to files produced from ONE document (the pupil's tool, the teacher's guide)."),
  variant: z.string().optional().describe("Filter to one rendering — 'FR', 'WO' — as the document's formatter declares them."),
};

// The cursor pins the last row of a page. It carries relPath as well as the
// covered node, because a node now holds SEVERAL files — (unit, nodeId) stopped
// being unique the moment a lesson could have four documents, and a non-unique
// cursor silently skips or repeats rows at a page boundary.
type DocCursor = { unit: number | null; nodeId: string; relPath: string };

/*
 * How much of an entry each detail level returns.
 *
 * The weight is entirely in `content` — a summary, the characters, the concepts,
 * the terminology. On the live history that is about 8.5 KB per entry, which is
 * why thirty of them was 255,216 bytes and refused outright by the response cap.
 * The identity fields are a few hundred bytes.
 *
 * `summary` reports content as COUNTS rather than a truncated copy: a caller can
 * see an entry has a record and how rich it is, and truncated prose would be
 * both misleading and still expensive.
 */
type DocumentRow = Record<string, unknown>;

const contentCounts = (entry: HistoryEntry) => ({
  hasSummary: Boolean(entry.content?.summary),
  characters: entry.content?.characters?.length ?? 0,
  exampleDomains: entry.content?.exampleDomains?.length ?? 0,
  conceptsCovered: entry.content?.conceptsCovered?.length ?? 0,
  terminologyUsed: entry.content?.terminologyUsed?.length ?? 0,
});

function projectDocument(entry: HistoryEntry, detail: DetailLevel): DocumentRow {
  // Enough to CHOOSE: which file, what it covers, which document and rendering
  // it is, and when it was last recorded.
  const names: DocumentRow = {
    relPath: entry.relPath,
    nodeId: entry.nodeId,
    updated: entry.updated,
    ...(entry.documentId !== undefined ? { documentId: entry.documentId } : {}),
    ...(entry.variant !== undefined ? { variant: entry.variant } : {}),
  };
  if (detail === "names") {
    return names;
  }
  if (detail === "summary") {
    return { ...names, source: entry.source, md5: entry.md5, recordedAt: entry.recordedAt, content: contentCounts(entry) };
  }
  return entry as unknown as DocumentRow;   // 'full' — today's payload, unchanged
}

// Well under the 100 KB response cap, leaving room for the envelope. At 'full'
// a page reaches this long before it reaches `limit`, and is trimmed with a
// cursor rather than refused.
const DOCUMENTS_PAGE_MAX_BYTES = 60 * 1024;

// A node with no ordinal (or gone from the graph) sorts after every numbered one.
const unitRank = (u: number | null | undefined): number => (u == null ? Infinity : u);

const encodeCursor = (c: DocCursor): string => Buffer.from(JSON.stringify(c), "utf8").toString("base64");

function decodeCursor(s: string): DocCursor | null {
  try {
    const p = JSON.parse(Buffer.from(s, "base64").toString("utf8")) as unknown;
    if (p && typeof p === "object" && typeof (p as DocCursor).nodeId === "string"
      && typeof (p as DocCursor).relPath === "string"
      && ((p as DocCursor).unit === null || typeof (p as DocCursor).unit === "number")) {
      return p as DocCursor;
    }
    return null;
  } catch {
    return null;
  }
}

// Strictly-after test in the (ordinal asc, nodeId asc, relPath asc) ordering.
// relPath is the final tie-break and the reason the order is total: it is what
// identifies an entry, so no two rows can compare equal.
const isAfterCursor = (ord: number | null, entry: HistoryEntry, c: DocCursor): boolean => {
  const byUnit = unitRank(ord) - unitRank(c.unit);
  if (byUnit !== 0) {
    return byUnit > 0;
  }
  const byNode = entry.nodeId.localeCompare(c.nodeId);
  if (byNode !== 0) {
    return byNode > 0;
  }
  return entry.relPath.localeCompare(c.relPath) > 0;
};

// Pure paging (+ optional nodeId/unit filtering). `ordinalOf` maps each entry's
// scope node to its chapter/week ordinal (null if the node is gone), so the
// ordinal sort/filter/cursor need no stored field. Exported so the paging
// contract can be unit-tested without standing up the storage/adapter stack.
// `total` reflects the FILTERED set being paged; `totalUnfiltered` reports the
// whole history size so a caller can see a filter narrowed the result.
export function pageDocuments(
  all: HistoryEntry[],
  ordinalOf: (nodeId: string) => number | null,
  args: { cursor?: string; limit?: number; nodeId?: string; unit?: number; documentId?: string; variant?: string; detail?: DetailLevel }
): { entries: DocumentRow[]; detail: DetailLevel; count: number; total: number; totalUnfiltered: number; nextCursor: string | null; truncatedBySize?: true; hint?: string } | { error: string } {
  const cursor = args.cursor != null ? decodeCursor(args.cursor) : null;
  if (args.cursor != null && cursor == null) {
    return { error: "Invalid cursor — pass a cursor returned by a prior list_documents page, or omit it to start from the first document." };
  }
  const limit = Math.min(Math.max(1, Math.floor(args.limit ?? DEFAULT_PAGE)), MAX_PAGE);
  // Resolve each entry's ordinal once, then order by (ordinal asc, nodeId asc)
  // — storage lists by nodeId only, so the ordinal ordering is applied here.
  const ordered = all
    .map((e) => ({ e, ord: ordinalOf(e.nodeId) }))
    .sort((a, b) =>
      unitRank(a.ord) - unitRank(b.ord)
      || a.e.nodeId.localeCompare(b.e.nodeId)
      || a.e.relPath.localeCompare(b.e.relPath));
  // Filters first (they define the set being paged), then the cursor slice.
  // `nodeId` now returns EVERY file covering that node, which is the point.
  const filtered = ordered.filter(({ e, ord }) =>
    (args.nodeId == null || e.nodeId === args.nodeId)
    && (args.unit == null || ord === args.unit)
    && (args.documentId == null || e.documentId === args.documentId)
    && (args.variant == null || e.variant === args.variant));
  const rows = cursor ? filtered.filter(({ e, ord }) => isAfterCursor(ord, e, cursor)) : filtered;

  // Project BEFORE trimming, so the byte budget is measured against what is
  // actually sent — trimming the full entries and projecting after would leave a
  // 'names' page far smaller than it needed to be.
  const detail = args.detail ?? DEFAULT_DETAIL;
  const projected = rows.map(({ e, ord }) => ({ ord, e, row: projectDocument(e, detail) }));
  // Measure only the projected row: `ord` and the full entry ride alongside for
  // the cursor and are never sent.
  const { page, trimmedBySize } = takeWithinBudget(projected, limit, DOCUMENTS_PAGE_MAX_BYTES, (row) => row.row);

  const last = page[page.length - 1];
  const nextCursor = projected.length > page.length && last
    ? encodeCursor({ unit: last.ord ?? null, nodeId: last.e.nodeId, relPath: last.e.relPath })
    : null;

  return {
    entries: page.map((x) => x.row),
    detail,
    count: page.length,
    total: filtered.length,
    totalUnfiltered: all.length,
    nextCursor,
    ...(trimmedBySize
      ? { truncatedBySize: true as const, hint: trimmedBySizeHint("Use the default detail:'names', narrow with nodeId/documentId/variant/unit, then page with cursor:<nextCursor>.") }
      : {}),
  };
}

// SUBJECT-SPECIFIC (CI-maths-leaning). The structured content recorded per
// document. Fields follow the CI maths storybook model (characters, exampleDomains,
// amorce/bilan wording); all optional, so subjects that don't use them omit them.
//
// Nothing in the SERVER reads these back — `characters` and `exampleDomains` are
// recorded for the authoring LLM, which reads recent documents via list_documents /
// get_document_text to keep the cast consistent and the object families varied. (That
// used to be a pair of tools, `suggest_fresh_domain` / `domain_usage`; the heuristic
// now lives in the maths guide's prose and reads these same fields.)
const contentSchema = {
  summary: z.string().optional(),
  characters: z
    .array(
      z.object({
        name: z.string(),
        type: z.string().optional().describe("child, adult, teacher, market-seller, animal…"),
        role: z.string().optional().describe("Role in the scene, e.g. pupil, mother, shopkeeper."),
        description: z.string().optional().describe("Any other detail worth keeping consistent."),
      })
    )
    .optional()
    .describe("Every character found ANYWHERE in the document — the opening scene AND the activities/bilan, not only the amorce — each as {name, type, …}."),
  exampleDomains: z.array(z.string()).optional().describe("Object families used, e.g. fruits, legumes."),
  conceptsCovered: z.array(z.string()).optional().describe("OS texts / lesson ids / statementCodes covered."),
  terminologyUsed: z.array(z.string()).optional().describe("Key math terms used."),
};

// ── get_document_text paging ──────────────────────────────────────────────────
// A .docx must be downloaded + parsed whole (mammoth needs the full buffer), but
// the EXTRACTED text can be arbitrarily large — a whole chapter manual is easily
// tens of KB — so we hand it back a window at a time instead of one giant blob.
// Default window 20k chars (~5k tokens), hard ceiling 50k, paged by `offset`:
// the same read-a-range contract list_documents uses, applied to one document's
// body. Read the whole document by paging until nextOffset is null.
export const DOC_TEXT_DEFAULT_MAX_CHARS = 20_000;
export const DOC_TEXT_MAX_CHARS = 50_000;

export type DocumentTextPage = {
  relPath: string;
  offset: number;            // char index this window starts at
  returned: number;          // chars in this window
  total: number;             // total chars in the whole extracted document
  nextOffset: number | null; // offset to pass next, or null when this is the tail
  text: string;              // the window itself
};

const clampInt = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, Math.trunc(value)));

// Slice one window out of the full extracted text. Pure (no I/O) so it unit-tests
// without a live docx; the handler downloads + extracts, then calls this. A stray
// offset past the end yields an empty window with nextOffset null (a clean "no
// more"), never an error.
export function pageDocumentText(relPath: string, full: string, offset?: number, maxChars?: number): DocumentTextPage {
  const total = full.length;
  const start = clampInt(offset ?? 0, 0, total);
  const windowSize = clampInt(maxChars ?? DOC_TEXT_DEFAULT_MAX_CHARS, 1, DOC_TEXT_MAX_CHARS);
  const text = full.slice(start, start + windowSize);
  const end = start + text.length;
  return { relPath, offset: start, returned: text.length, total, nextOffset: end < total ? end : null, text };
}

export function registerDocumentTools(server: McpServer) {
  server.registerTool("reconcile", { title: "Reconcile bucket with history", description: "List the .docx documents in Firebase Storage and diff against history BY relPath: tracked docs (present + unchanged), UNTRACKED docs needing a link ('new' = no history entry, 'changed' = bytes differ from the recorded entry), and entries dropped because their object is gone. It no longer classifies filenames — link each untracked doc to the node it covers with record_document_content(nodeId, relPath, content). Link each untracked doc to the node it covers with record_document_content — several files may cover the same node, so the whole list can be walked. `dropped` lists the relPath of each entry whose object is gone. " + WORKSPACE_ROLE_NOTE + "", inputSchema: {} },
    guarded(async () => (await denyNonMember("readDocuments")) ?? asJson(await reconcile())));

  server.registerTool("list_documents", { title: "List tracked documents", description: "Current history: one entry per FILE, keyed by its relPath, ordered by unit ordinal then covered node then path. `detail` defaults to 'names' (relPath, nodeId, updated, plus documentId/variant when known) — the content record is what made this tool unusable, at ~8.5 KB an entry; 'summary' adds source and content COUNTS; 'full' returns the whole record and is trimmed to a byte budget with a cursor rather than refused. A node holds several files (a CI-maths lesson has four), so filtering by `nodeId` returns all of them; narrow further with `documentId` (which document produced it) or `variant` ('FR'/'WO'). Paginated: pass limit (default 25, max 100) and an opaque cursor. Optional filters: nodeId (one scope node) and unit (a chapter/week ordinal). Returns { entries, count, total, totalUnfiltered, nextCursor }; nextCursor is null on the last page — pass it back to fetch the next page. " + WORKSPACE_ROLE_NOTE + "", inputSchema: listDocumentsShape },
    guarded(async (a: { cursor?: string; limit?: number; nodeId?: string; unit?: number }) => {
      const denied = await denyNonMember("readDocuments"); if (denied) return denied;
      const byId = getActiveAdapter().model().byId;
      return asJson(pageDocuments(await listEntries(), (id) => byId.get(id)?.order ?? null, a));
    }));

  server.registerTool("create_upload_url", { title: "Create document upload URL", description: "Get a short-lived signed URL to upload a generated .docx to the bucket. Upload with an HTTP PUT, Content-Type application/vnd.openxmlformats-officedocument.wordprocessingml.document. relPath is like 'chapitre_05/Manuel - Chapitre 5.docx'. After uploading, call log_generation with the same relPath. REQUIRES CONFIRMATION: called without confirm:true it only returns a needsConfirmation notice — ask the user to approve the upload, then call again with confirm:true. Requires a ROLE in the active workspace (any role): this writes to live storage/history, unlike the open curriculum reads.", inputSchema: { relPath: z.string(), confirm: z.boolean().optional() } },
    guarded(async (a: { relPath: string; confirm?: boolean }) => {
      const denied = await denyNonMember("writeDocuments"); if (denied) return denied;
      const needConfirm = requireConfirmation(a.confirm, `issue an upload URL for '${a.relPath}' — this writes NOW to the live documents bucket (no draft, no undo)`);
      return needConfirm ?? asJson(await getStorageAdapter().createUploadUrl(a.relPath));
    }));

  server.registerTool("create_download_url", { title: "Create document download URL", description: "Get a short-lived signed URL to download an EXISTING .docx from the bucket with an HTTP GET (no auth header needed). relPath is documents-relative, like 'chapitre_05/Manuel - Chapitre 5.docx' — the same path used by create_upload_url and get_document_text. Use this to fetch the original binary file (with its images and formatting intact) so you can edit it and re-upload via create_upload_url. Returns { url, objectKey, expiresAt, exists }; exists is false when there is no such object. " + WORKSPACE_ROLE_NOTE + "", inputSchema: { relPath: z.string() } },
    guarded(async (a: { relPath: string }) =>
      (await denyNonMember("readDocuments")) ?? asJson(await getStorageAdapter().createDownloadUrl(a.relPath))));

  server.registerTool("get_document_text", { title: "Get document text", description: "Extract the plain text of a document in the bucket (by its documents-relative path) so you can read an UNTRACKED document and then record its content. PAGINATED so a long document never overflows the response: one call returns a window of up to `maxChars` characters (default 20000, max 50000) starting at `offset` (default 0), plus a small JSON envelope { offset, returned, total, nextOffset } and the window as a text/plain resource. To read the WHOLE document — you must, characters appear in the opening scene AND in the activities and bilan, not only the amorce — keep calling with offset:<nextOffset> until nextOffset is null. " + WORKSPACE_ROLE_NOTE + "", inputSchema: { relPath: z.string(), offset: z.number().int().optional(), maxChars: z.number().int().optional() } },
    // Two content blocks: a small JSON envelope (offset/total/nextOffset — how to
    // page) and the window itself as a text/plain resource (labelled by its
    // document path, so the reader gets rendered text, not a JSON-escaped blob).
    guarded(async (a: { relPath: string; offset?: number; maxChars?: number }) => {
      const denied = await denyNonMember("readDocuments"); if (denied) return denied;
      const { text, ...meta } = pageDocumentText(a.relPath, await extractDocxText(a.relPath), a.offset, a.maxChars);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(meta, null, 2) },
          ...asText(`tlm://document/${a.relPath}`, text).content,
        ],
      };
    }));

  server.registerTool("record_document_content", { title: "Record parsed document content", description: "After reading an UNTRACKED document's text, store the structured content you extracted into history so it is never re-parsed. The object must already be in the bucket. `nodeId` is the scope node the document covers (the Chapitre/Semaine/Lesson — find it with walk_graph / namespace_stats). " + FILE_KEYED_NOTE + " REQUIRES CONFIRMATION — without confirm:true you get a needsConfirmation notice; ask the user to approve, then call again. " + WORKSPACE_ROLE_NOTE + " This writes LIVE to history: no draft, no undo.", inputSchema: { nodeId: z.string(), relPath: z.string(), content: z.object(contentSchema), documentId: z.string().optional(), variant: z.string().optional(), replace: z.boolean().optional(), confirm: z.boolean().optional() } },
    guarded(async (a: { nodeId: string; relPath: string; content: any; documentId?: string; variant?: string; replace?: boolean; confirm?: boolean }) => {
      const denied = await denyNonMember("writeDocuments"); if (denied) return denied;
      const err = scopeNodeError(a.nodeId); if (err) return asJson({ error: err });
      const needConfirm = requireConfirmation(a.confirm, `record content into history for node ${a.nodeId} — this writes NOW to the live history (no draft, no undo)`);
      return needConfirm ?? asJson(await recordContent("parsed", { nodeId: a.nodeId, relPath: a.relPath, content: a.content, documentId: a.documentId, variant: a.variant, replace: a.replace }));
    }));

  server.registerTool("log_generation", { title: "Log a generated document", description: "Call after uploading a generated .docx via create_upload_url: it reads the object's hash from storage and records what you produced, so it feeds future consistency + variety. `nodeId` is the scope node the document covers (the Chapitre/Semaine/Lesson). " + FILE_KEYED_NOTE + " REQUIRES CONFIRMATION — without confirm:true you get a needsConfirmation notice; ask the user to approve, then call again. " + WORKSPACE_ROLE_NOTE + " This writes LIVE to history: no draft, no undo.", inputSchema: { nodeId: z.string(), relPath: z.string(), content: z.object(contentSchema), documentId: z.string().optional(), variant: z.string().optional(), replace: z.boolean().optional(), confirm: z.boolean().optional() } },
    guarded(async (a: { nodeId: string; relPath: string; content: any; documentId?: string; variant?: string; replace?: boolean; confirm?: boolean }) => {
      const denied = await denyNonMember("writeDocuments"); if (denied) return denied;
      const err = scopeNodeError(a.nodeId); if (err) return asJson({ error: err });
      const needConfirm = requireConfirmation(a.confirm, `log the generated document for node ${a.nodeId} into history — this writes NOW to the live history (no draft, no undo)`);
      return needConfirm ?? asJson(await recordContent("pipeline", { nodeId: a.nodeId, relPath: a.relPath, content: a.content, documentId: a.documentId, variant: a.variant, replace: a.replace }));
    }));
}

// A document's identity is its scope node, so a write must name a real node in
// the active graph. Return an error message for an unknown id (reject rather than
// silently mint an orphan history entry), or null when the node exists.
function scopeNodeError(nodeId: string): string | null {
  if (getActiveAdapter().model().byId.has(nodeId)) return null;
  return `No node '${nodeId}' in the active graph. Pass the id of the scope node this document covers (a Chapitre/Semaine/Lesson) — find it with walk_graph / namespace_stats.`;
}
