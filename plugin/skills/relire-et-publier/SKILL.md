---
name: relire-et-publier
description: Relire un brouillon et le transmettre — vérification du câblage, couverture au regard du guide de la matière, grilles d'évaluation, puis demande de relecture ou publication. À utiliser quand on dit « relire », « vérifier avant publication », « est-ce que c'est prêt », « publier », « faire relire », ou quand on demande ce qu'il reste à faire avant qu'un brouillon parte en production.
---

# Review, then hand over

## The sequence

1. **`check_draft`** — mechanical wiring. A document covering nothing, a section outside any
   document, a routine nothing uses, an element connected to nothing. These fail silently otherwise.
2. **`review_draft`** — coverage. It returns the subject guide's expectations plus a structural
   snapshot, and **you** reason over one against the other. It renders no verdict; that is your work.
   Pass `includeGuide:false` if you already read the guide this session.
3. **`evaluate_document`** — the evaluation grids attached to the document. It bundles the rubrics
   and the document; you score it against them. A document may carry several grids, and all of them
   apply.
4. **`lint_content`** — cohérence. Il signale les énoncés qui se contredisent entre eux : une
   routine dont le total annoncé ne fait pas la somme de ses étapes, une grille pondérée qui
   n'atteint pas 100 %, un identifiant cité dans la prose qui ne mène à rien, un formatter dont les
   valeurs déclarées démentent sa propre prose. Il lit le sujet actif **et** les deux bibliothèques
   de catalogue. Une alerte délibérée se tait sur le nœud avec `metadata.lintIgnore: ["id-de-règle"]`
   — pas de déploiement nécessaire. Lisez `rulesPending` plutôt que de supposer que tout est vérifié.
5. **`request_review`** (curator) ou **`publish_draft`** (approver).

## Present it as one review, not four tool results

The expert does not care which check produced which finding. Merge them into a single account, in
French, in their vocabulary: what is wrong, where, what to do about it. A wiring problem and a
coverage gap sit side by side in that list.

Give them the shape of it first — how many findings, how serious — before the detail.

## Findings are not blockers

None of these checks blocks a publish, by design. Your job is to make sure the person deciding has
seen them, not to decide for them. If they choose to publish with findings open, that is their call;
record it and proceed.

## Ending as a curator

`request_review` marks the draft ready and **notifies nobody** — the approver sees it on their next
`start_here`. So the note you attach is the whole handover. Write it as a summary of what changed
and what is still open, not "ready for review".

`withdraw:true` takes it back.

## Ending as an approver

`publish_draft` makes the whole draft live. Before confirming:

- read the dry-run's `checks` and `warnings` out to the person,
- make sure the consent is for **this** publish, given now, not something agreed earlier,
- say plainly that it is not reversible.

If a single staged edit is the problem rather than the whole draft, `undo_last` takes back the most
recent one and leaves the rest standing. It refuses, naming the node, when a later edit touched the
same thing — that is a signal to look, not to force.
