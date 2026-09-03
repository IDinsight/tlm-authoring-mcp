---
name: produire-et-mesurer
description: Produce a sheet and check that it fits — render, count the pages, tighten, and never arbitrate on an estimate. Use when asked to generate, produce, preview or measure a document, or when someone says "produire la fiche", "est-ce que ça tient", "combien de pages", "ça déborde".
---

# Produce, then measure

The rule this whole skill exists to enforce: **render it and count.** Not estimate, not reason about
whether it will fit — produce the artifact and measure the artifact.

## Get the generation inputs

- **`walk_document_section`** for one slot of a document. This is the unit a sheet is produced from,
  and it is the one to prefer. It hands you the section, the curriculum it covers, the routine that
  applies, and every formatter on its path.
- **`walk_document`** for a whole document — but a large document will not fit in one response, and
  it will tell you so and point you back at the per-section read. Believe it; do not retry.
- **`preview_generation`** when the material should reflect an unpublished draft. Preview the
  **smallest piece you changed** — after editing one section, preview that section, not its document.

Everything about how the sheet must look comes from the **formatters** in that payload, and
everything about what it must contain from the section's own assembly guidance and the routine.
Read them. Do not lay out a document from memory or from another subject's habits.

## Measure with the `mesureur` subagent

It renders and returns **numbers** — pages, lines used per section, overflow, whitespace — not an
opinion about whether it looks right.

> **Seam.** The server has no `generate_document` or `measure_document` yet, so the render happens
> outside it. Until it lands, the `mesureur` drives whatever local renderer the team uses and
> reports the same numbers. What must not change when it lands is this skill's discipline: the
> decision is made on measured output, never on the specification.

## When a sheet overflows

**Render it again with no images at all, and count.** The cause is usually text, and stripping the
images tells you that in one measurement instead of an afternoon of guesses.

Then tighten in this order — smallest change that could work, remeasured each time:

1. text (the usual culprit),
2. spacing and layout knobs the formatter allows,
3. images,
4. content — and only with the expert's agreement, because dropping content is a pedagogical
   decision and not yours.

**Never arbitrate on an estimate.** If you cannot measure it, say that you cannot measure it and ask
for the render, rather than reporting a judgement as a result.

## Check the artifact, not the specification

The two most expensive rendering bugs in this project were both invisible to any check of the spec —
a page size that silently defaulted to the wrong standard, and a spacing setting that cropped
full-width images to a few millimetres. Both were found by looking at a rendered page.

So look at the page. Report what you measured and how you measured it.

## Preview output is segregated — keep it that way

A preview `.docx` goes through **`create_preview_upload_url`** only. Never `create_upload_url`, and
never `log_generation`: those write to the canonical bucket and the generation history, and a
preview recorded there becomes indistinguishable from a real deliverable.
