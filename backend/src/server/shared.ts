/*
 * Module: server · internal helpers
 *
 * Tool helpers that depend on app-layer state (the active adapter / context),
 * so they live inside the server module rather than in utils (which stays a
 * leaf). The pure asJson primitive comes from the utils barrel and is
 * re-exported here so each tool group imports all its helpers from one place
 * ("./shared.js").
 */
import { asJson, asMarkdown, asText, buildConfirmEnvelope, classifyError, toolError, isDebug, type ToolResult } from "../utils/index.js";
import { ContextNotSetError } from "../context/index.js";

export { asJson, asMarkdown, asText, toolError, type ToolResult };

const LOG = "[senegal-mohebs-tlm]";

// Wrap a tool handler so that:
//   • no grade/subject active → a friendly `needsContext` prompt (not an error);
//   • any other throw → a STRUCTURED, typed `{ error: { code, message } }`
//     envelope with `isError` set, instead of the SDK's bare `error.message`.
// The typed code (STORE_UNAVAILABLE vs INTERNAL_ERROR vs …) is what lets a
// caller tell a datastore outage apart from a logic bug — the distinction that
// was impossible when every failure read "Tool execution failed". The real
// message is always included; a stack is added only in debug mode (TLM_DEBUG=1).
// (Argument-validation failures are caught by the SDK BEFORE the handler runs,
// so they surface as the SDK's own "Input validation error: …" — already
// distinct from the handler-side codes below.)
// Every source- or bucket-dependent tool is registered through this.
export const guarded = <A>(fn: (a: A) => ToolResult | Promise<ToolResult>) => async (a: A): Promise<ToolResult> => {
  try {
    return await fn(a);
  } catch (e) {
    if (e instanceof ContextNotSetError) {
      return asJson({
        needsContext: true,
        message: "No grade/subject is selected yet. Ask the user which grade and subject to work on, then call set_context. Available options are listed below.",
        available: e.available,
      });
    }
    const { code, message } = classifyError(e);
    // One structured stderr line so an operator can correlate the client-facing
    // typed error with the server log (and see the stack there even in prod).
    console.error(`${LOG} tool handler error [${code}]:`, e instanceof Error ? (e.stack ?? e.message) : String(e));
    const detail = isDebug() && e instanceof Error ? { stack: e.stack } : undefined;
    return toolError(code, message, detail);
  }
};

// The sentence get_capabilities reports as rules.confirmation. It lives HERE, in
// the module that guarantees it, so the tool text cannot drift from the gate's
// actual behavior the way it did while it claimed "this client does not support
// elicitation" — a client-side fact that stopped being true.
export const CONFIRMATION_RULE =
  "This server never opens a confirmation dialog of its own: it issues no MCP elicitation, whatever the client advertises. The only channel to the user runs through you.";

// Human confirmation for the live document/history writes — create_upload_url,
// log_generation, record_document_content. Returns a ToolResult (→ caller does NO
// side effect) when the caller has not approved, or null (→ proceed) when it passed
// confirm:true.
//
// Deliberately AGENT-MEDIATED, with no elicitation branch. There used to be one, and
// it was the bug: it awaited elicitInput() with no timeout and only read `confirm`
// afterwards, so the day a client began advertising the capability, every
// create_upload_url call hung until the caller's 60s timeout — and confirm:true could
// not short-circuit it. Write safety here rests on identity (roles from a signed
// token), reversibility, and the audit trail, never on a dialog. Restoring a dialog is
// deliberate work, not a flag flip: it needs a bounded timeout AND the tool handler's
// relatedRequestId, or the request is dropped in silence whenever no standalone SSE
// stream is open. See docs/design-notes/self-serve-authoring.md, risk 2.
export function requireConfirmation(confirm: boolean | undefined, action: string): ToolResult | null {
  return confirm ? null : asJson(buildConfirmEnvelope(action));
}
