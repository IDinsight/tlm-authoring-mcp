/*
 * Module: server · per-call context override
 *
 * Lets a read tool name the (workspace, grade, subject) it wants ON THE CALL,
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
import { runInSession, newSessionState } from "../context/index.js";
import { activateContext } from "../activate.js";

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
          `Cannot read against workspace '${context.workspace}' / grade '${context.grade}' / subject '${context.subject}': ` +
          `${activation.error} Call get_context (or list_workspaces) for the namespaces that exist.`,
      };
    }
    return fn();
  });
}
