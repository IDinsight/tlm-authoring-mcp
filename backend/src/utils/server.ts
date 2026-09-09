/*
 * Module: utils · server (leaf)
 *
 * The pure MCP-response helper and its result type. No project imports, so it's
 * leaf-safe and re-exported from utils/index.ts. App-coupled tool helpers that
 * need the active profile/context (guarded) do NOT belong here
 * — they live in server/shared.ts inside the server module.
 */

// A tool result is one or more content blocks, optionally flagged `isError` (the
// typed error path below uses it). Most tools return a single `text` block (JSON,
// via asJson); prose tools return a `resource` block so the payload carries a
// mimeType (see asMarkdown/asText). Declared explicitly — not `ReturnType<typeof
// asJson>` — so every helper below is assignable to the same handler type.
type TextBlock = { type: "text"; text: string };
type ResourceBlock = { type: "resource"; resource: { uri: string; mimeType?: string; text: string } };
export type ToolResult = { content: (TextBlock | ResourceBlock)[]; isError?: boolean };

// ─── Universal response-size backstop ─────────────────────────────────────────
// EVERY tool response is serialized through the helpers below, so a single cap
// here guarantees NO tool — current or future — can hand the client a payload big
// enough to blow its token budget. This is the last line of defence, not the
// primary UX: well-behaved tools (walk_graph, get_document_text, list_documents,
// …) paginate so they never approach it; the cap catches the unbounded read, the
// misuse (limit:500 + includeEdges), and the tool nobody remembered to bound.
//
// The ceiling only defends anything if it sits BELOW the CLIENT's own tool-output
// limit. It did not: Claude Code refuses a tool result over 25k tokens, and at
// 100 KB this cap sat above that wall — a 72.8 KB walk_document_section page
// passed every budget here and was thrown away on arrival, which is the worst
// outcome (the caller pays for the read and gets nothing).
//
// Bytes → tokens is where the old number went wrong: ~3.8 bytes/token holds for
// English, but these payloads are accented French prose inside JSON, nearer 2.8.
// 60 KB is ~21k tokens at that rate, leaving headroom under 25k for the envelope
// and still well above the largest legitimate response (get_capabilities, 38.5 KB
// measured on the ci/maths fixture). Tunable for ops via TLM_MAX_RESPONSE_BYTES.
const DEFAULT_MAX_RESPONSE_BYTES = 60 * 1024; // ~60 KB ≈ ~21k tokens of French JSON

// THE serialization every tool response uses. Compact, not pretty-printed:
// indentation cost 21-34% of a payload's bytes (measured on a walk_graph page
// and namespace_stats) and no consumer reads the raw text — every caller
// JSON.parses it. Readers that trim to a byte budget MUST measure through
// responseBytes below, or their budget silently disagrees with what is sent.
export const serializeResponse = (data: unknown): string => JSON.stringify(data);

/** Byte size of `data` exactly as a tool response would carry it. */
export const responseBytes = (data: unknown): number =>
  Buffer.byteLength(serializeResponse(data), "utf8");
/**
 * The live response cap. Exported so get_capabilities mirrors the number this
 * module enforces rather than keeping a second copy of it in sync by hand.
 */
export const maxResponseBytes = (): number => {
  const override = Number(process.env.TLM_MAX_RESPONSE_BYTES);
  return Number.isFinite(override) && override > 0 ? override : DEFAULT_MAX_RESPONSE_BYTES;
};

/**
 * The byte budget a PAGED read should trim itself to: three quarters of the cap,
 * leaving room for the response envelope the tool wraps the page in.
 *
 * Derived, not written down again. Four readers each carried their own constant
 * "well under the 100 KB cap"; when the cap moved they would all have kept their
 * old number, and two of them (list_documents, list_catalog) sat at 60 KB — which
 * would have made every full page overflow the very cap they were sized against.
 */
export const pageBudgetBytes = (): number => Math.floor(maxResponseBytes() * 0.75);

// A compact, one-level description of what overflowed — top-level keys with each
// value's kind and size (array length, string length, object key count) — so the
// caller sees WHY (e.g. `roots: array(650)`) and can narrow, without us echoing
// any of the oversized payload back.
function shapeOf(data: unknown): unknown {
  const describe = (v: unknown): string =>
    Array.isArray(v) ? `array(${v.length})`
      : typeof v === "string" ? `string(${v.length} chars)`
      : v && typeof v === "object" ? `object(${Object.keys(v).length} keys)`
      : v === null ? "null" : typeof v;
  if (Array.isArray(data)) return `array(${data.length})`;
  if (data && typeof data === "object") {
    return Object.fromEntries(Object.entries(data as Record<string, unknown>).map(([k, v]) => [k, describe(v)]));
  }
  return describe(data);
}

// What to tell a caller whose payload blew the cap, when the tool has no way to
// narrow the request. The generic line lists every escape hatch the server offers
// SOMEWHERE — limit, cursor, nodeTypes — which is good advice for walk_graph and
// unactionable for a tool like walk_document that takes neither. A tool that knows
// a better remedy passes its own through `asJson`.
const GENERIC_OVERSIZE_HINT =
  "Narrow the request: add/lower a limit, page with a cursor, apply filters (nodeTypes/edgeTypes), request a smaller slice, or use a summary returnMode. Raise TLM_MAX_RESPONSE_BYTES only if a larger response is genuinely required.";

// The small replacement returned when a payload would exceed the cap. isError so
// the caller knows it got no usable data, plus the byte math + shape + how to fix.
function oversizeEnvelope(bytes: number, data: unknown, remedy?: string): ToolResult {
  const cap = maxResponseBytes();
  const body = {
    error: {
      code: "RESPONSE_TOO_LARGE" as const,
      message: `This tool's response (${bytes} bytes) exceeds the ${cap}-byte response cap and was withheld to protect your token budget.`,
      bytes,
      cap,
    },
    shape: shapeOf(data),
    hint: remedy ?? GENERIC_OVERSIZE_HINT,
  };
  return { content: [{ type: "text", text: serializeResponse(body) }], isError: true };
}

/**
 * Wrap any value in the MCP text-content envelope tools must return — capped by
 * the universal backstop above.
 *
 * `oversizeRemedy` is the way OUT of the cap for this particular tool, used in
 * place of the generic hint when the payload is withheld. Pass it wherever the
 * generic advice would send the caller nowhere.
 */
export const asJson = (data: unknown, oversizeRemedy?: string): ToolResult => {
  const text = serializeResponse(data);
  const bytes = Buffer.byteLength(text, "utf8");
  return bytes <= maxResponseBytes() ? { content: [{ type: "text", text }] } : oversizeEnvelope(bytes, data, oversizeRemedy);
};

// Return a textual payload tagged with a MIME type so the client knows how to
// present it. A plain `text` block carries no media type, so document / markdown
// output would otherwise reach the reader as an escaped JSON string; an EMBEDDED
// RESOURCE is the MCP content block that does carry a mimeType. `uri` just labels
// the resource's origin (a document path, a guide id) — it need not resolve. Also
// capped by the backstop (a paginated caller stays well under it).
export const asResource = (uri: string, mimeType: string, text: string): ToolResult => {
  const bytes = Buffer.byteLength(text, "utf8");
  return bytes <= maxResponseBytes()
    ? { content: [{ type: "resource" as const, resource: { uri, mimeType, text } }] }
    : oversizeEnvelope(bytes, { uri, mimeType, text });
};
// Markdown/plain-text a reader should see rendered, not as escaped JSON.
export const asMarkdown = (uri: string, text: string): ToolResult => asResource(uri, "text/markdown", text);
export const asText = (uri: string, text: string): ToolResult => asResource(uri, "text/plain", text);

// ─── Structured, typed tool errors ───────────────────────────────────────────
// The MCP SDK turns any throw inside a handler into a bare `error.message` tool
// error with no structure — which is why a store outage, a bad argument, and a
// stale token all looked identical ("Tool execution failed") in live testing.
// These helpers replace that with a stable `{ error: { code, message } }`
// envelope (isError set) so callers can branch on `code`. Lives in utils/
// (leaf) so any layer can throw a CodedError without importing the server.
export type ToolErrorCode =
  | "VALIDATION_ERROR"   // bad arguments (the SDK also emits its own before the handler runs)
  | "STORE_UNAVAILABLE"  // Firestore / Cloud Storage / network / credentials — the datastore path
  | "STALE_TOKEN"        // two-phase confirm: state moved since preview (re-review)
  | "TOKEN_EXPIRED"      // two-phase confirm: token past its TTL (re-run the dry-run)
  | "NOT_FOUND"          // a named resource does not exist
  | "INTERNAL_ERROR";    // anything not otherwise classified

// A throwable carrying a stable code, so any layer can signal a typed failure
// that `guarded` surfaces verbatim instead of re-classifying by message.
export class CodedError extends Error {
  readonly code: ToolErrorCode;
  readonly detail?: unknown;
  constructor(code: ToolErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = "CodedError";
    this.code = code;
    this.detail = detail;
  }
}

/*
 * Refuse a caller-supplied relative path that tries to climb out of its prefix.
 *
 * Every object key is `<namespace prefix>/ + relPath`, glued together with no
 * validation. On Cloud Storage a `..` does NOT traverse — object names are flat
 * strings there, so `documents/../x` is a literal key that resolves to nothing —
 * so this is defensive hardening, not a live hole: it matters for any path-based
 * backend, and a clear refusal beats a key that silently points nowhere. Called
 * at the one chokepoint every relPath passes through (docKey / previewKey).
 */
export function assertSafeRelPath(relPath: string): void {
  const unsafe =
    relPath.length === 0 ||
    relPath.startsWith("/") ||
    relPath.split("/").some((segment) => segment === "..");
  if (unsafe) {
    throw new CodedError(
      "VALIDATION_ERROR",
      `Invalid relPath '${relPath}': it must be a relative path inside the namespace, with no '..' segments and no leading '/'.`,
    );
  }
}

// Debug mode surfaces stacks in the error envelope. Off by default so prod
// clients never see internals; flip TLM_DEBUG=1 (or NODE_ENV=development) when
// diagnosing.
export const isDebug = (): boolean => process.env.TLM_DEBUG === "1" || process.env.NODE_ENV === "development";

// Best-effort classification of an unknown thrown value into a stable code.
// CodedError wins outright; otherwise we recognise the store/transport failure
// shapes the firebase-admin / google-cloud libs throw (error codes + common
// phrases) so a datastore outage is distinguishable from a logic bug — the
// exact distinction that was impossible with the old generic string.
export function classifyError(e: unknown): { code: ToolErrorCode; message: string } {
  if (e instanceof CodedError) return { code: e.code, message: e.message };
  const message = e instanceof Error ? e.message : String(e);
  if (/\b(ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN)\b|socket hang up|network error|Could not (load|refresh) default credentials|credential|GaxiosError|firebase|storage bucket|\bbucket\b|Quota exceeded|rate limit|DEADLINE_EXCEEDED|UNAVAILABLE/i.test(message)) {
    return { code: "STORE_UNAVAILABLE", message };
  }
  return { code: "INTERNAL_ERROR", message };
}

// Build the MCP error envelope: structured `{ error: { code, message, detail? } }`
// with `isError` set. `detail` is included only when passed (guarded adds a
// stack here in debug mode).
export function toolError(code: ToolErrorCode, message: string, detail?: unknown): ToolResult {
  const error: Record<string, unknown> = { code, message };
  if (detail !== undefined) error.detail = detail;
  return {
    content: [{ type: "text", text: serializeResponse({ error }) }],
    isError: true,
  };
}

// ─── Shared confirmation envelope ────────────────────────────────────────────
// Two different lifecycles across the server use this envelope with
// intentionally different stakes:
//   1. GRAPH mutations (kg-store/mutations.ts) — STAGE a draft edit; publish
//      is a separate step. The framework layers `diff` + `confirmationToken`
//      on top of the fields defined here.
//   2. DOCUMENT operations (server/documents.ts) — LIVE writes to the bucket
//      / history. No draft, no diff, no publish behind them; the confirm is
//      the ONLY gate.
// The `action` field is the caller-supplied stakes-accurate phrasing; the
// `message` wraps it with the "call again with confirm: true" instruction.
// Lives in utils/ (leaf) so any module can build one without importing the
// server layer.
export type ConfirmationEnvelope = {
  needsConfirmation: true;
  action: string;
  message: string;
};
export const buildConfirmEnvelope = (action: string): ConfirmationEnvelope => ({
  needsConfirmation: true,
  action,
  message: `Do NOT proceed yet. Ask the user to confirm — about to ${action}. Once they explicitly agree, call this tool again with confirm: true.`,
});
