# The renderer spike — can a document be produced in this runtime?

**Status:** Live (spike, `backend/src/__spike__/`). It reproduces one sheet and is not a renderer:
no `generate_document` tool, no bucket, no translation, no page counting. WP4 proper is still to
build.

## Why a spike rather than a decision

WP4 needs a program that turns authored curriculum into a `.docx`. That program existed — seven
Python scripts on one laptop — and the roadmap called WP4 "blocked without them: they are the
specification of correct output."

They are gone. `producteur-fiches-v4.tgz`, which held the renderer and its three checking tools, is
not on the machine, in Spotlight, or in the Trash; only the illustration-dossier bundle survived.
So WP4 is a rebuild whichever language it lands in, and "port the Python or ship Python alongside"
was never the real question.

What survived is better: the **twenty sheets produced on 2 September 2026** — lessons 1–10, French
and Wolof — plus the preview PDF and the note recording what was changed and why. Output, not
specification. That turns the language question into an empirical one: build one sheet in the
server's own runtime, hold it against the real file, and see what fights back.

## What the corpus settled first

The rebuilt scripts in the `producteur` handoff had measured a set of files from the storage bucket
and flagged several values as disputed, because the files disagreed with the project notes. They
were measuring the wrong artifact — the bucket holds the guide **source**, rendered whole, not a
produced sheet. All twenty real sheets agree with each other and with the notes:

| | bucket draft | the produced sheets |
|---|---|---|
| Margins | 1.4 / 1.5 cm | **2.5 cm, all four** |
| Line height | 12 pt, automatic | **15.5 pt, exact** |
| Body | 10 pt | **12 pt** |
| Pictures | none | 9–10, at most 2 embedded per séance |
| Page break | none | carried by the séance banner |

Nineteen pages in the preview PDF: nine lessons at two pages, plus lesson 5 — a single séance — at
one. The languages are two files from one source: every French file carries black and red and never
blue, every Wolof file black and blue and never red.

## What the spike is

Three files, about 500 lines, no new dependency.

| | |
|---|---|
| `zip.ts` | A `.docx` is a zip of XML parts and the repo has no zip library. Writing the container directly is ~60 lines of `node:zlib` — which is itself part of the answer. |
| `renderer.ts` | Document model + `RenderSpec` → `.docx` bytes. |
| `golden.ts` | A produced sheet → the same document model, so the comparison is not the renderer marking its own homework. Doubles as a sketch of WP6a. |

`render.spike.test.ts` checks the teacher sheet (`GOLDEN_DIR`); `pupil.spike.test.ts` checks whether
the same code carries a second document type (`PUPIL_DIR`).

`render.spike.test.ts` reads `Guide-Lecon-1-ensembles-FR.docx` into the model, renders it again from
scratch, and compares. It skips unless `GOLDEN_DIR` names the folder holding the sheets.

**The corpus lives on one laptop and nowhere else.** It is not in the bucket, not in the repo (a
megabyte a sheet), and it is the only definition of correct output the project has. Backing it up
somewhere durable is worth doing before it is needed.

## What it reproduces

Page size and all four margins; every banner colour and text colour; the page break on the banner,
once; every banner including the stacked header; **every printed line word for word**; all nine
pictures floated right and sized from the spec rather than from the file; and the leading rule of
every paragraph, which is the interesting one.

macOS's own text engine opens the output and reads it correctly.

### The leading rule, and why the obvious version is wrong

A line height in points is ambiguous: under an **exact** rule Word crops an inline picture to the
line box, under an automatic one the line grows to the picture. During production this flattened
every full-width band to 5 mm — invisible to a page count, caught only by looking at the page.

The fix in the notes reads "the paragraph carrying an image keeps automatic leading", and
implemented that way it is wrong. It relaxes the line under every pictogram too, each of those lines
grows by a few points, and across a sheet that is enough to push a séance onto another page. The
rule that reproduces the golden's own distribution exactly — six inline-picture paragraphs on the
exact rule, two on automatic — is narrower:

> A paragraph relaxes its leading only when it carries an inline picture **taller than the line
> box**. A floated picture never qualifies: it has no line to respect.

That distribution is asserted in the suite, because it is the defect the whole `properties.render`
schema exists to make impossible.

## What it found

1. **`type.leadingRule` and `images.paragraphLeadingRule` were missing from the schema.** Everything
   else measured off the twenty sheets validated on the first attempt; these two did not exist, so
   the schema could hold the setting that caused the crop and not the one that fixes it. Both are in
   now, with `atLeast` alongside — the three rules OOXML has. See
   [`formatter-render-spec.md`](formatter-render-spec.md).

2. **The renderer does not write the words.** The golden's `[N]` lines were rewritten by hand from
   the source guide during the tightening pass. Laying out finished lines and composing them are
   different jobs, and only the first belongs here.

3. **`images.placement` can only be a default.** Real sheets float some pictures and set others in
   the run of the line. Which one a picture gets is a per-section choice; where a floated one goes
   is the formatter's.

4. **Inter-block spacing has no key.** The spacer paragraphs between banners carry two numbers each
   and nowhere in the schema to put them. Left in the document model and recorded here rather than
   widening the schema a second time in one pass.

## Genericity — asked, and answered with a qualified no

Nothing in `renderer.ts` knows what a maths lesson looks like. It knows banners, lines, pictures and
spacers; which banner is turquoise, how tall a band may stand and which colour marks French are all
read out of the `RenderSpec`. But one document type can always be matched by accident, so the same
renderer was pointed at the pupil tool — 42 picture placements against nine, grids of images in
table cells rather than banners of text, three type sizes, a page break standing on its own —
**with no new code**. `pupil.spike.test.ts` records what happened.

**The spec generalised. The content model did not.**

Carried over, from a spec with the same keys and different values: page size and all four margins,
the block fill (a palette of one instead of ten), and the declared image heights.

Lost:

| | |
|---|---|
| **All 42 pictures.** | Not most — every one. A pupil page *is* a grid of pictures, and a banner cell in this model holds a string. The teacher sheet hid this: its pictures sit in paragraphs, which the model has. |
| **The page break.** | The spec offers three carriers; this document uses `paragraph` and the renderer acts only on `banner-property`. The value is declared and read, and nothing honours it. |
| **`blocks.*.sizePt`.** | Declared in the schema, consumed by nothing. Only shows up on a document with more than one type size. |
| **Per-block bullet markers.** | `blocks.bullet.marker` exists; the model carries one marker and puts it on every line, so the page title gets bulleted. |
| **Cells with several paragraphs.** | The instruction box holds three numbered questions; a cell is one string, so they come out concatenated. |

Every one of those is a missing way to **describe** the document, not a missing render knob. That is
the WP3 line holding up rather than breaking: geometry belongs in `properties.render` and it fitted
both types; structure is authored per section, and the spike stubs structure out with a model shaped
around one document.

**So WP4's real work is the content model, not the schema.** A cell must be able to hold blocks
rather than a string, blocks must nest, and the renderer must honour all three page-break carriers
and a block's own type size. None of that is a new `properties.render` key.

## Not attempted

Emphasis within a line (the golden bolds the odd word; this model treats a line as one colour) —
that belongs in the document model, alongside the five gaps the pupil-tool test found. Translation. Page counting, which needs a layout
engine. And **Andika is not installed on the machine this ran on**, so nothing rendered here is at
true metrics: geometry, colour and structure are read from the file and unaffected, but no page
count from this environment means anything.
