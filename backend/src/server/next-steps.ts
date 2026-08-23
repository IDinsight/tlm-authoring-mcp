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
 * catches (the probe in the design note found exactly that). "Étapes habituelles"
 * is a statement of fact about the workflow; "fais ceci" would not be.
 *
 * Keyed by mutation name so it cannot drift from the tool that produced it: a
 * write whose sequence we have nothing specific to say about falls back to the
 * shared draft loop, which is right for every draft edit.
 */

// After a dry-run, the sequence is always the same and the caller is mid-gate.
const AFTER_PREVIEW = [
  "Résumer le changement à l'utilisateur en français, puis attendre son accord.",
  "Une fois qu'il a accepté : rappeler le même outil avec confirm:true et le confirmationToken.",
];

// After an applied DRAFT edit — the loop every curriculum write shares.
const AFTER_DRAFT_EDIT = [
  "Vérifier les branchements du brouillon : check_draft.",
  "Vérifier la couverture du programme : review_draft.",
  "Voir le rendu avant publication : preview_generation.",
  "Publier quand tout est bon : publish_draft (le brouillon n'est visible par la génération qu'après).",
];

// Sequences that differ from the shared loop, keyed by mutation name.
const AFTER_APPLY: Record<string, string[]> = {
  createDocument: [
    "Découper le document en sections : add_section (une par chapitre ou par partie).",
    "Appliquer un style maison : use_formatter.",
    "Vérifier les branchements : check_draft, puis publier : publish_draft.",
  ],
  addSection: [
    "Ajouter la section suivante : add_section.",
    "Voir le rendu de cette seule section : preview_generation.",
    "Vérifier les branchements : check_draft, puis publier : publish_draft.",
  ],
};

/**
 * The steps that usually follow this write. `stage` is the two-phase phase the
 * response is in; `mutation` is the mutation's name (`addNodes`, `createEdges`,
 * `editNode`, `createDocument`, …).
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
