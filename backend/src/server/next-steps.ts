/*
 * Module: server · "what usually comes next" after a write
 *
 * Rung 2 of the in-product guidance (docs/design-notes/self-serve-authoring.md):
 * every write already returns a diff envelope; a short, literal list of the steps
 * that normally follow steers the conversation without the expert ever learning a
 * tool name. It is the cheapest possible replacement for reading the guide in
 * another window.
 *
 * Written as a DESCRIPTION of the usual sequence, never as orders — server text
 * that reads as commands to the assistant is what the client's injection guard
 * catches (the probe in the design note found exactly that). "What usually comes
 * next" is a statement of fact about the workflow; "do this" would not be.
 *
 * English, like every other server-authored string here: one deployment serves
 * six workspaces in two working languages, so the model relays these in the
 * expert's own (the subject guide names it).
 *
 * Keyed by mutation name so it cannot drift from the tool that produced it: a
 * write whose sequence we have nothing specific to say about falls back to the
 * shared draft loop, which is right for every draft edit.
 */

// After a dry-run, the sequence is always the same and the caller is mid-gate.
const AFTER_PREVIEW = [
  "Summarise the change to the user in their own language, then wait for their agreement.",
  "Once they have agreed: call the same tool again with confirm:true and the confirmationToken.",
];

// After an applied DRAFT edit — the loop every curriculum write shares.
const AFTER_DRAFT_EDIT = [
  "Check the draft's wiring: check_draft.",
  "Check curriculum coverage: review_draft.",
  "See what it would produce before publishing: preview_generation.",
  "If this edit was not what was wanted: undo_last takes back just this one and keeps the rest.",
  "Publish once it is right: publish_draft (generation only sees the draft after that).",
];

// Sequences that differ from the shared loop, keyed by mutation name.
const AFTER_APPLY: Record<string, string[]> = {
  createDocument: [
    "Split the document into sections: add_section (one per chapter or per part).",
    "Apply a house style: use_formatter.",
    "Check the wiring: check_draft, then publish: publish_draft.",
  ],
  addSection: [
    "Add the next section: add_section.",
    "See what this one section would produce: preview_generation on the section's id.",
    "Check the wiring: check_draft, then publish: publish_draft.",
  ],
  // An undo is itself a draft edit, so the shared loop would tell the curator to
  // undo their undo. What follows one is the ordinary editing loop instead.
  undoLast: [
    "The other staged edits are untouched — diff_draft shows what is left.",
    "Take back the edit before it as well: undo_last again (it peels back, one edit per call).",
    "Publish what remains once it is right: publish_draft.",
  ],
};

/**
 * The steps that usually follow this write. `stage` is the two-phase phase the
 * response is in; `mutation` is the mutation's name (`addNodes`, `createEdges`,
 * `editNodes`, `createDocument`, …).
 */
export function nextSteps(mutation: string, stage: "preview" | "apply"): string[] {
  if (stage === "preview") return AFTER_PREVIEW;
  return AFTER_APPLY[mutation] ?? AFTER_DRAFT_EDIT;
}

/**
 * Attach `nextSteps` to a shaped write response, reading the phase off the
 * response itself so a caller cannot label a preview as an apply. Untouched for
 * anything that is not a preview or a successful apply — a blocked or
 * unauthorized result has no "next step" but fixing what it reports.
 */
export function withNextSteps(response: Record<string, unknown>, mutation: string): Record<string, unknown> {
  const phase = response.phase;
  if (phase === "preview") return { ...response, nextSteps: nextSteps(mutation, "preview") };
  if (phase === "apply" && response.ok === true) return { ...response, nextSteps: nextSteps(mutation, "apply") };
  return response;
}
