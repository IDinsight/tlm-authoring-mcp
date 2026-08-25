/*
 * Module: server · shared description fragments
 *
 * The same four paragraphs — parked payloads, idempotency keys, returnMode, the
 * workspace-role gate — were pasted into 3-5 tool descriptions each. Because the
 * manifest ships every description in full on every turn, the duplication cost
 * ~1,300 tokens of context per turn, so these are deliberately TERSER than the
 * prose they replace: each keeps the instruction a caller must act on and defers
 * the detail to get_capabilities, which is a read away.
 *
 * Sharing the constants also stops the five copies drifting apart, which they
 * already had (three different phrasings of the same confirm rule).
 */

/** Large two-phase payloads are parked server-side; the confirm carries only the token. */
export const PARKED_PAYLOAD_NOTE =
  "If the dry-run reports `payloadStored:true`, confirm with ONLY confirm:true + the token — do not re-send the payload; otherwise re-send the same arguments with confirm:true and the token.";

/** Opt-in replay safety on a retried confirm. */
export const IDEMPOTENCY_NOTE =
  "`idempotencyKey` (optional UUID): makes a RETRIED confirm a safe replay (`replayed:true`) instead of a REPLAY error; same key + different payload is rejected. Namespace-scoped, 24h. Omit for strict single-use.";

/** How much of the diff a write tool returns. */
export const RETURN_MODE_NOTE =
  "`returnMode`: 'summary' (default) returns `counts`; 'full' also attaches the whole diff.";

/** Catalog writes are not staged — they apply and publish together. */
export const CATALOG_PUBLISH_NOTE =
  "Confirming a catalog write PUBLISHES the library in one step (catalogs are not enterable, so no publish_draft), and `catalog` must be RE-SENT on the confirm.";

/** The documents/history/translate gate — distinct from the open curriculum reads. */
export const WORKSPACE_ROLE_NOTE =
  "Requires a ROLE in the active workspace: published curriculum is open to everyone, a workspace's generated documents are not.";
