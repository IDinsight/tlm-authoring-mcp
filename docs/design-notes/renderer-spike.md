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

`render.spike.test.ts` checks the teacher sheet (`GOLDEN_DIR`); `pupil.spike.test.ts` checks that the
same code carries a second document type (`PUPIL_DIR`). Neither runs without its corpus.

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

## Genericity — asked, answered no, then fixed

Nothing in `renderer.ts` knows what a maths lesson looks like. It knows tables, lines, runs,
pictures and spacers; which banner is turquoise, how tall a band may stand, which colour marks
French and where a page break is carried are all read out of the `RenderSpec`. But one document type
can be matched by accident, so the same renderer was pointed at the pupil tool — 42 picture
placements against nine, grids of images in tables nested inside tables, three type sizes, a page
break standing on its own — **with no new code**.

**First answer: the spec generalised, the content model did not.** Page geometry, block fill and the
image ceilings carried over on nothing but different values. Everything else was lost: all 42
pictures, the page break, the title's type size, the bullet rule, and any cell holding more than one
paragraph.

Every one of those was a missing way to **describe** a document rather than a missing render knob —
the WP3 line holding rather than breaking. So the model was rebuilt around one idea:

> **A banner and an image grid are the same thing** — a table whose cells hold blocks. Blocks nest;
> a cell is not a string.

Both document types now come out of the same code, and both suites pass:

| | teacher sheet | pupil tool |
|---|---|---|
| pictures | 9, floated right | 42, in nested grids |
| tables / cells | 14 banners | 12 tables, 70 cells |
| page break | on the banner's paragraph property | a paragraph of its own |
| type sizes | one | 12, 11.5 and 16 pt |
| picture roles | 3, told apart by shape | 7, five of them square |
| bullets | on every content line | none |

What the rebuild had to add, all of it structural: cells holding blocks; all three page-break
carriers honoured, with the model saying WHERE a page starts and the spec saying HOW; a container's
style cascading into what it contains; per-run styling, because a line is not one style — the pupil
header sets "Unité 1 · Leçon 1" at 12 pt and the lesson title at 16 pt in the same paragraph.

### The one thing the exercise says about the spec

A picture's **role is authored, not inferred**. The teacher sheet's three roles happen to be
separable by shape — a band is wide, an opening scene taller, a pictogram tiny. The pupil tool has
seven distinct heights and five of them are square, so nothing about the picture says which is a
4.99 cm answer and which a 0.46 cm sign. `images.maxHeightCm` holds both; the second just needs a
longer list of role names. Same key, no new shape — but a renderer that tried to *derive* the role
would be right on one document type and wrong on the other.

## Not attempted

Composing the words — the golden's `[N]` lines were rewritten by hand during the tightening pass, and
laying out finished lines is a different job. Translation. Page counting, which needs a layout
engine. Translation. Page counting, which needs a layout
engine. And **Andika is not installed on the machine this ran on**, so nothing rendered here is at
true metrics: geometry, colour and structure are read from the file and unaffected, but no page
count from this environment means anything.
