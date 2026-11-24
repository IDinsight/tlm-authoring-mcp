/*
 * Module: server · what a tool does to the world, said to the client
 *
 * MCP lets a tool declare `readOnlyHint`. Claude works without it; ChatGPT, by
 * OpenAI's documentation, treats a tool that does not declare it as a write —
 * a confirmation dialog on start_here and find_node, and nothing callable on a
 * plan that may only read. So every tool states one of the three below where it
 * is registered.
 *
 * The line between a read and a write is what a USER can see change, not
 * whether the handler touches the store:
 *
 *   still a read   an audit line (read_audit records who read it), this
 *                  session's own context (set_context), and a page kept a day
 *                  for the caller's next call (compose_section, lint_content);
 *   a write        everything else — a staged draft edit, a file or a signed
 *                  upload URL in the bucket (previews/ included), a recorded
 *                  file, a member, a publish.
 *
 * server/__tests__/tool-effects.test.ts holds the reviewed list of read-only
 * tools, so marking one read-only is deliberately a change in two places.
 */
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/** Changes nothing a user can see, so a client may call it without asking. */
export const READS_ONLY = { readOnlyHint: true } as const satisfies ToolAnnotations;

/**
 * Changes something — most often a staged draft edit, which undo_last or
 * discard_draft takes back. `destructiveHint` is left unsaid: MCP then assumes
 * the tool MAY be destructive, which is the cautious reading for a publish or
 * an upload that overwrites a file.
 */
export const WRITES = { readOnlyHint: false } as const satisfies ToolAnnotations;

/**
 * Can delete something no draft holds and undo_last cannot bring back: a
 * catalog entry (delete_nodes with `catalog`), a whole draft, a membership.
 */
export const DELETES_FOR_GOOD = { readOnlyHint: false, destructiveHint: true } as const satisfies ToolAnnotations;
