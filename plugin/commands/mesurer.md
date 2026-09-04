---
description: Mesurer un document produit — pages, débordement, est-ce que ça tient
argument-hint: [le document ou la fiche à mesurer]
---

Measure: $ARGUMENTS

Use the `mesureur` subagent and report its numbers. I want measurements, not an assessment: pages,
the page size actually observed in the output, lines used per section, and any image whose rendered
height differs from its declared height.

If it overflows, render again with no images and measure that too — the cause is usually text.

If it cannot be rendered, tell me that. Do not estimate.
