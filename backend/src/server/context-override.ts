/*
 * Module: server · per-call context override
 *
 * Lets a tool name the (workspace, grade, subject) it wants ON THE CALL,
 * instead of depending on whatever `set_context` last selected.
 *
 * WHY. The active context lives in the SESSION bag, and a session is one MCP
 * CONNECTION — not one caller. Everything sharing that connection therefore
 * shares one active context, and a `set_context` anywhere moves it for
 * everybody. Reported from a real authoring session: subagents fanning out over
 * a week's sessions each called `set_context`, and the parent's next two
 * `walk_graph` calls failed with "Start node not found" on ids that had resolved
 * seconds earlier — the ids were fine, the graph underneath had moved.
 *
 * WHY NOT KEY THE BAG BY CALLER. There is nothing to key it on. A subagent and
 * its parent arrive on the same connection with the same `mcp-session-id` AND
 * the same verified actor, so no identifier distinguishes them; MCP has no
 * sub-caller identity. Making the CALLER stateless is the only fix available.
 *
 * HOW. A call carrying `context` runs inside a FRESH session state with that
 * context activated, so its adapter and preloaded model are its own and cannot
 * disturb — or be disturbed by — the ambient one. A call omitting `context`
 * behaves exactly as before. Being the one place this happens is the point: the
 * per-tool cost is a schema field, not plumbing.
 *
 * COST. An override activates the context, which hydrates the model. Repeat
 * calls on the same namespace hit the per-version model cache, so a fan-out over
 * one week pays that once rather than per call.
 */
import { z } from "zod";
import { runInSession, newSessionState } from "../context/index.js";
import { activateContext } from "../activate.js";
import { asJson, type ToolResult } from "../utils/index.js";

/** The (workspace, grade, subject) a single call wants to read against. */
export type ContextOverride = { workspace: string; grade: string; subject: string };

/** What a tool accepts to name its own context; absent ⇒ use the session's. */
export type WithContext = { context?: ContextOverride };

/**
 * Run `fn` against `context` when one is given, otherwise against the session's
 * active context.
 *
 * An override that cannot be activated returns a structured refusal rather than
 * throwing, because "that namespace does not exist" is a caller mistake with an
 * obvious next step, not a server fault — and `guarded` would otherwise report
 * it as an internal error.
 *
 * AUTHORIZATION. The caller's identity is NOT part of the session state — it
 * lives in its own AsyncLocalStorage (actor.ts) — so the verified actor and
 * their memberships pass straight through an override untouched. An override
 * therefore changes WHICH namespace a tool acts on and never WHO is acting.
 *
 * That makes one mistake possible, and it is the dangerous one: a tool that
 * checks membership OUTSIDE this wrapper authorizes against the session's
 * namespace and then acts on the named one. Every gate — denyUnlessMember and
 * friends — must run INSIDE `fn`, where activeNamespace() resolves to the
 * override. See documents.ts, where the gate is the first line of each handler
 * body for exactly this reason.
 */
export async function withContextOverride<T>(
  context: ContextOverride | undefined,
  fn: () => Promise<T>,
): Promise<T | { error: string }> {
  if (!context) {
    return fn();
  }

  // A fresh state, never the caller's: activating into the ambient bag is the
  // very cross-talk this exists to prevent.
  return runInSession(newSessionState(), async () => {
    const activation = await activateContext(context.workspace, context.grade, context.subject);
    if (!activation.ok) {
      return {
        error:
          `Cannot act on workspace '${context.workspace}' / grade '${context.grade}' / subject '${context.subject}': ` +
          `${activation.error} Call get_context (or list_workspaces) for the namespaces that exist.`,
      };
    }
    return fn();
  });
}

/*
 * The ONE advertised shape for the `context` argument.
 *
 * It was copy-pasted inline into six tool schemas, which is how two of them
 * would eventually come to accept slightly different fields. A tool opts in by
 * spreading `contextField` into its inputSchema, so there is nothing per-tool to
 * get wrong and no second definition to drift.
 */
export const contextField = {
  context: z
    .object({ workspace: z.string(), grade: z.string(), subject: z.string() })
    .optional()
    .describe(
      "Run THIS call against a named (workspace, grade, subject) instead of whatever set_context last selected. " +
      "Pass it whenever you cannot be certain the session's context is still yours — a session is one CONNECTION, " +
      "so a subagent's set_context moves it for everybody. On a write, this also decides which namespace the " +
      "membership check is made against, so naming a workspace you have no role in is refused rather than misrouted.",
    ),
};

/*
 * The same override, for a handler that builds its own ToolResult.
 *
 * `withContextOverride` hands back a bare `{ error }` when a namespace cannot be
 * activated, which suits the graph readers — they return plain payloads and one
 * `asJson` at the tool boundary wraps whichever came back. The document and
 * translation tools are shaped the other way round: their handlers already
 * return ToolResults (a membership refusal is one), so they need the refusal
 * wrapped for them rather than a union to unpick at every call site.
 */
export async function withContextOverrideResult(
  context: ContextOverride | undefined,
  fn: () => Promise<ToolResult>,
): Promise<ToolResult> {
  const result = await withContextOverride(context, fn);
  return "error" in result && typeof result.error === "string" ? asJson(result) : (result as ToolResult);
}
