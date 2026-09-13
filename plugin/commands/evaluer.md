---
description: Évaluer un document ou le brouillon en cours — câblage, couverture, cohérence, grilles, rendu — en une seule relecture
argument-hint: [le document, ou rien pour le brouillon en cours]
---

Evaluate: $ARGUMENTS

Follow the `evaluer` skill: `check_draft` for wiring, `review_draft` for coverage against the
subject guide, `lint_content` for contradictions (and the composed page if I give you one),
`evaluate_document` for the grids attached to the document, then one look at the render by the
`relecteur` subagent.

Merge everything into **one** review, in French, in my vocabulary — not one section per tool. Give
me the shape of it first (how many findings, how serious), then the detail, each with what to do
about it. Never raise a finding you have not seen in the render yourself.

Do not publish or transmit anything from here.
