---
name: illustrations
description: Build and verify a lesson's illustration dossier — prompt, single cell, assembled band, answer marker — checking the produced image rather than the prompt, and regenerating nothing without an explicit go-ahead. Use when asked about illustrations, images, vignettes, dossiers d'illustration, or "refaire les images".
---

# Illustration dossiers

## The pipeline, in order

1. **Prompt** — written from the section's own guidance and the document's image formatter, never
   from habit. Fetch them: `walk_document_section` returns both.
2. **One cell, at 1:1** — produce a single image first and look at it. If it is wrong, the prompt is
   wrong, and every image made from it will be wrong the same way.
3. **Assembled band** — compose the cells into the band the layout expects.
4. **Answer marker** — added last, once the band is settled, so a change upstream does not orphan it.

Each stage is checked before the next begins. Skipping to a full set and checking at the end means
discovering a prompt error twenty images later.

## Naming

`L06-nf-1-v2.png` — lesson, short slug, index, version. Versions increment; nothing is overwritten,
so a regenerated image never silently replaces the one an expert already approved.

If the document's image formatter declares its own convention, **the formatter wins** — read it
first and follow it.

## Check the produced image, never the specification

An illustration that satisfies its prompt exactly can still be wrong on the page: the wrong size,
cropped, unreadable at print scale, or showing something the text contradicts.

**Look at the image.** Dispatch the `illustrateur` subagent to build the dossier and verify it; it
returns a structure — which images exist, which are missing, which failed a check and why — not a
description of what it made.

There is one class of error no text-based check will ever catch: a **mismatch between text and
image**, where the words and the picture each make sense and disagree with each other. Two wrong
answer keys reached production that way. Catching it needs eyes on the rendered vignette beside its
text. That is this skill's job, and it cannot be delegated to a linter.

## A contact sheet per lesson

Assemble one sheet showing every image for the lesson together. Errors of consistency — a character
who changes appearance, an object family that drifts, a style that shifts halfway — are invisible
one image at a time and obvious on a contact sheet.

## Regenerate nothing without an explicit go-ahead

Regeneration is not free and it is not neutral: it can replace an image the expert has already
approved.

So: **present a list** of what you propose to regenerate and why, one line each, and wait for a yes.
Not "I'll refresh the images" — the actual list. A go-ahead covers the images on that list and no
others.
