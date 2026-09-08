---
description: Mesurer un document produit — pages, débordement, est-ce que ça tient
argument-hint: [le document à mesurer]
---

Measure: $ARGUMENTS

**Read the budget first, then delegate.** The thresholds belong to the document, not to you and not
to the agent: they live in its formatter. Read them with `walk_document_section` — `render.budget`
(`maxPages`, `reserveBottomCm`, `linesPerPage`, `maxCharsPerLine`, `maxCharsBesideImage`) and
`render.page` for the expected geometry — and pass them in the call. A curator changes them in the
formatter without a deploy, and the next measurement has to follow.

Then use the `mesureur` subagent and report its numbers. I want measurements, not an assessment:
pages, the page size actually observed in the output, lines used per section, and any image whose
rendered height differs from its declared height. Do not open the rendered pages yourself — the
numbers come back from the agent, the pixels stay with it.

If nothing on the path carries a budget, say so and pass none: you will get the numbers without a
verdict on whether it fits. Do not supply a threshold of your own, and do not carry one over from an
earlier measurement.

If it overflows, ask for a second measurement of the same document rendered with no images at all —
the cause is usually text.

If it cannot be rendered, tell me that. Do not estimate.
