/*
 * What a document was made from, and whether that has moved since.
 *
 * A produced sheet is a photograph of the curriculum at a moment. The
 * curriculum then carries on without it, and nothing says so — which is how the
 * bucket ends up holding a sheet that quotes wording nobody uses any more, with
 * no way to tell it apart from one that is current.
 *
 * The obvious fix is a graph version stamped on each document, and it is
 * useless: any edit anywhere bumps it, so every document goes stale at once and
 * the flag stops meaning anything. Staleness has to be PER DOCUMENT, against the
 * nodes that document actually drew from.
 *
 * Which the anchors already say. A rendered sheet records the node behind each
 * block, so the sources of a document are exactly its anchors, and it is stale
 * when any of their content has changed since. One lesson edited marks the four
 * files covering that lesson, and nothing else.
 *
 * THE ONE RULE: a document with no recorded sources is UNKNOWN, never fresh.
 * Everything produced before this existed has none, and reporting those as
 * up-to-date would be the single most misleading thing this could do.
 */
import { createHash } from "node:crypto";

/** One node a document drew from, and its content when the document was made. */
export type DocumentSource = { nodeId: string; hash: string };

/*
 * Hash the WORDS, not the bytes.
 *
 * Whitespace differences are not content changes — a re-import that reflows a
 * paragraph would otherwise mark every document that quotes it, and a flag that
 * cries wolf gets ignored exactly when it matters.
 */
export function hashContent(text: string): string {
  return createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);
}

/** Snapshot the nodes a document drew from, at the moment it was produced. */
export function sourcesFrom(anchors: readonly string[], current: Map<string, string>): DocumentSource[] {
  return anchors
    .filter((nodeId) => current.has(nodeId))
    .map((nodeId) => ({ nodeId, hash: hashContent(current.get(nodeId)!) }))
    .sort((a, b) => a.nodeId.localeCompare(b.nodeId));
}

export type Staleness =
  | { state: "unknown"; reason: string }
  | { state: "current"; checked: number }
  | { state: "stale"; changed: string[]; removed: string[]; checked: number };

/**
 * Compare what a document was made from against what the graph says now.
 *
 * `removed` is kept apart from `changed` because they need different answers: a
 * document quoting reworded text can be regenerated, one quoting a node that no
 * longer exists needs a person to decide what it should say instead.
 */
export function staleness(
  sources: readonly DocumentSource[] | undefined, current: Map<string, string>,
): Staleness {
  if (!sources || sources.length === 0) {
    return {
      state: "unknown",
      reason:
        "This document does not record which curriculum nodes it was made from, so whether it is out of date cannot be established — it predates that being recorded, or it was not produced through render_document. Regenerating it is what makes the question answerable.",
    };
  }

  const changed: string[] = [];
  const removed: string[] = [];
  for (const source of sources) {
    const now = current.get(source.nodeId);
    if (now === undefined) { removed.push(source.nodeId); continue; }
    if (hashContent(now) !== source.hash) changed.push(source.nodeId);
  }

  return changed.length || removed.length
    ? { state: "stale", changed, removed, checked: sources.length }
    : { state: "current", checked: sources.length };
}
