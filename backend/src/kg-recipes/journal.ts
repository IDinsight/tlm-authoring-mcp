/*
 * Recipe: append_journal
 *
 * A document and each of its sections keep a decision journal — the dated
 * history behind their rules (`metadata.journal`, one text field, stripped
 * from every generation read; see curriculum/documents.ts). Before this verb
 * "add an entry" meant: read the whole field, add a line, write the whole
 * field back through edit_nodes. Two sessions doing that on the same
 * document overwrite each other, and nothing errors.
 *
 * Why a task verb (self-serve-authoring.md, the D3 test): the invariant is
 * that an entry is ADDED to what the journal holds at the moment of writing.
 * This recipe reads the journal off the base graph inside apply(), so the
 * text it appends to is always the draft's current text — on the dry-run and
 * again on the confirm — and the two-phase framework refuses a confirm whose
 * base has moved. A primitive edit cannot promise either half.
 *
 * The entry's shape is fixed here, once: a heading line carrying the title,
 * the date and the author, then the text. A journal opened by this verb
 * starts with the same header line the migrated journals carry.
 */

import { readAtPath, writeAtPath, type GraphMutation, type MutationNode } from "../kg-store/index.js";
import { RecipeCommon, nodeById } from "./shared.js";

/** The raw path of the journal, relative to a stored node's `properties`. */
export const JOURNAL_PATH = "raw.metadata.journal";

/** The node kinds that keep a journal: a document, and a section of one. */
export const JOURNALED_LABELS = ["TeachingLearningMaterial", "DocumentSection"];

const labelsOf = (node: MutationNode | undefined): string[] => node?.labels ?? [];
const keepsJournal = (node: MutationNode | undefined): boolean => labelsOf(node).some((label) => JOURNALED_LABELS.includes(label));

const titleOf = (node: MutationNode): string => {
  const description = readAtPath(node.properties, "raw.description");
  return typeof description === "string" ? description.split("\n")[0].trim() : node.id;
};

/** The heading line an entry opens with — what a reader scans the journal by. */
export function journalHeading(args: { title?: string; date: string; author?: string }): string {
  const parts = [args.title?.trim() || "NOTE", args.date];
  if (args.author) parts.push(args.author);
  return `=== ${parts.join(" — ")} ===`;
}

export type AppendJournalArgs = RecipeCommon & {
  nodeId: string;    // the document or section (already resolved from a name)
  entry: string;     // the decision, in the author's words
  title?: string;    // a short heading for the entry
  date: string;      // stamped by the tool layer (YYYY-MM-DD)
  author?: string;   // the signed-in author's label, when known
};

export const appendJournal: GraphMutation<AppendJournalArgs> = {
  name: "appendJournal",
  describe: (args) => `append a journal entry to '${args.nodeId}'${args.title ? ` (« ${args.title} »)` : ""}`,

  validate: (base, _after, args) => {
    const errors: string[] = [];
    if (typeof args.entry !== "string" || args.entry.trim().length === 0) {
      errors.push("append_journal: 'entry' is required — the decision, in words. An empty entry records nothing.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date ?? "")) {
      errors.push("append_journal: 'date' must be YYYY-MM-DD (the tool layer stamps it).");
    }
    const node = nodeById(base, args.nodeId);
    if (!node) {
      errors.push(`append_journal: '${args.nodeId}' does not exist in the draft.`);
    } else if (!keepsJournal(node)) {
      errors.push(`append_journal: '${args.nodeId}' is a ${labelsOf(node).join(", ") || "node"}, and journals live on a document or on a section of one. A decision about a lesson's words is recorded on the section that places them, or on the document whose rules it concerns.`);
    }
    return { errors, warnings: [] };
  },

  apply: (base, args) => {
    const node = nodeById(base, args.nodeId);
    if (!node || !keepsJournal(node)) return base;

    // Read off the BASE, here, not off anything the caller held: that is the
    // whole reason the verb exists.
    const current = readAtPath(node.properties, JOURNAL_PATH);
    const existing = typeof current === "string" ? current.trimEnd() : "";
    const opening = existing === "" ? `# Journal — ${titleOf(node)}` : existing;
    const block = `${journalHeading(args)}\n${args.entry.trim()}`;
    const journal = `${opening}\n\n${block}\n`;

    const properties = writeAtPath(node.properties as Record<string, unknown>, JOURNAL_PATH, journal);
    return {
      ...base,
      nodes: base.nodes.map((candidate) => (candidate.id === node.id ? { ...candidate, properties } : candidate)),
    };
  },
};
