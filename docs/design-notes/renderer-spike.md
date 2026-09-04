# The renderer spike — can a document be produced in this runtime?

**Status:** Live. The renderer and its contract are in **`backend/src/render/`**, reachable as the
**`render_document`** tool; the golden-file comparisons that proved them stay in
`backend/src/__golden__/` (renamed from `__spike__` when it stopped being throwaway work). The operational manual for the live tools is [`docs/technical-reference/rendering.md`](../technical-reference/rendering.md). Still missing before WP4 is done: writing the CANONICAL bucket and history (output is preview-only
today). Page counting is built but **unverified end to end** — see below.

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
| `render/zip.ts` | A `.docx` is a zip of XML parts and the repo has no zip library. Writing the container directly is ~60 lines of `node:zlib` — which is itself part of the answer. |
| `render/docx.ts` | Document model + `RenderSpec` → `.docx` bytes. |
| `__golden__/golden.ts` | A produced sheet → the same document model, so the comparison is not the renderer marking its own homework. Doubles as a sketch of WP6a. |

`__golden__/teacher-sheet.golden.test.ts` checks the teacher sheet (`GOLDEN_DIR`); `__golden__/pupil-tool.golden.test.ts` checks that the
same code carries a second document type (`PUPIL_DIR`). Neither runs without its corpus.

`__golden__/teacher-sheet.golden.test.ts` reads `Guide-Lecon-1-ensembles-FR.docx` into the model, renders it again from
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

Nothing in `render/docx.ts` knows what a maths lesson looks like. It knows tables, lines, runs,
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

## Who composes the page

The renderer needs a block tree — this table, then this line, then this picture — and it does not
build one. **The authoring model does.**

That is not a shortcut. Structure is authored per section, and on the live CI-maths graph it is 2-8
KB of French guidance per lesson: which banner, in what order, where the page turns. It is not in
the graph as data and putting it there would mean describing one document type in a schema. So the
model reads the section and composes the tree; `render/document.ts` is the contract it composes to,
and it is **strict** — an unknown key is refused at authoring time rather than dropped silently at
render time.

The line between the two halves is enforced by omission: there is no colour, no point size and no
centimetre anywhere in the tree. A block names a `style`, a picture names a `role`, and the
formatter says what those look like. A model that wanted to set a colour would have nowhere to put
it. Page breaks work the same way — the tree says WHERE a page starts, `pagination.pageBreakCarrier`
says HOW the break is written.

**This changed a documented invariant.** `CLAUDE.md` said the server "never renders a `.docx`
itself", which was true and was also why document production lived on one laptop. It renders now,
and still decides nothing about what a page contains.

### The tool

`render_document(nodeId, document)` closes it. The node is a `DocumentSection` or the
`TeachingLearningMaterial`; `document` is the tree. The server merges that node's formatter stack,
validates the tree, lays out the `.docx`, and PUTs it itself — there is nothing left for the caller
to upload.

Output goes to the **segregated `previews/` prefix**, on the isolation `preview_generation` already
has: short-lived, invisible to `list_documents` and `reconcile`, never recorded through
`log_generation`. Writing the canonical bucket is a separate decision with separate stakes, and this
tool deliberately cannot.

Nothing renders when either half is wrong. An invalid tree or an unresolvable stack comes back
naming the path — and the stack is checked BEFORE the tree is looked at, because a stack that will
not resolve is the formatter author's problem and saying so with the formatter ids beats a page that
is wrong for reasons nobody can trace.

### One source, two documents

CI maths composes a page ONCE and produces two files: black lines in both, red French only in the
French file, blue Wolof only in the Wolof. That is `language.strategy: "per-file"`, and the renderer
honoured its COLOURS from the start while ignoring the split — so each file came out carrying the
other language too, which reads as a formatting oddity rather than as the wrong document.

`splitByVariant` does the split, and it is pure: a tree and a spec in, one tree per file out.
Anything that is not `per-file` stays one file. **Tables survive the split even when everything
inside them is dropped** — a banner is structure, not speech, and a file missing its scaffolding is
harder to spot than one missing a translation.

A tree composed in French has no Wolof lines to split out, so `deriveVariant` produces them: every
French line is duplicated as a Wolof one, keeping its style, its pictures and **its place** — the
twin sits immediately after its source, because once the split drops the other language, position is
the only thing that still lands a line between the right banner and the right picture. The page
break stays on the source line; two lines both starting a page would leave a blank one.

The translator is **injected, not imported**: `render/` must not know Gemini exists, and a test must
be able to derive a variant without spending a metered call. `render_document` supplies the real one
— glossary-grounded, the same term bank the `translate` tool uses, so a derived page does not drift
from the wording of materials already in classrooms. It is members-only for the same reason
`translate` is, and a tree that already carries the language is left alone: re-translating what an
author wrote by hand is the one thing this must never do.

### Counting the pages

« Le nombre de pages se compte sur le RENDU, en PDF, jamais à la lecture d'un guide. » The rule was
earned: an estimate that counted the lines a guide declares put one document at 2.5 pages, and it
rendered at eleven.

So `measureDocx` lays the file out — LibreOffice to PDF, then poppler for the count, the page size
actually produced, and the whitespace below the last line of each page. `render_document` takes
`measure:true` and reports it per file, with `fits` when the formatter declares `budget.maxPages`.

**When it cannot measure, it says so.** No arithmetic dressed up as a count: a wrong page count gets
believed, a missing one gets chased. The render itself is unaffected — a file with no page count is
still the deliverable.

Measuring is off by default and the layout engine is opt-in at build time
(`--build-arg WITH_LAYOUT_ENGINE=1`), because LibreOffice and the fonts add roughly half a gigabyte
to the image and seconds to a cold start, and every other tool works without them. **Andika is part
of the measurement**, not a nicety: substituting another face changes glyph advances, which changes
line counts, which changes the number this exists to report.

### Verified, 3 September 2026

Built with `--build-arg WITH_LAYOUT_ENGINE=1` and run against the twenty golden sheets:

> **20/20 at their documented page count, on A4.** Nine lessons at two pages, lesson 5 — the block's
> only single-séance lesson — at one.

That is the whole chain executing for the first time: the apt recipe resolving, Andika installing
(4 faces), `soffice --convert-to pdf`, and both poppler parsers reading real output rather than a
captured sample. The engine costs a MEASURED **149 MB** (108 → 257 MB), not the "roughly half a
gigabyte" the Dockerfile used to guess.

**And it found a limitation in `freeBelowCm`.** `pdftotext -bbox` emits words, never images, so a
page ending in a picture reports the gap below the last line of TEXT rather than below the last mark
— overstating the room left, which is the dangerous direction for a number whose job is to say how
close a sheet is to overflowing. This run reports 3.89–9.83 cm where the production note records
1.4–9.9 cm: the upper bounds agree closely, the lower does not, and these sheets end in full-width
image bands. Use it to compare pages with each other; use the PAGE COUNT to decide whether a sheet
fits.

### Reading a correction back (WP6)

An expert opens a sheet, fixes a sentence, sends it back. The hard part was never the `.docx`: it
was knowing WHICH node a line belongs to. Sheets from the old pipeline carried nothing that said —
`w:sdt` count was zero across every file measured — so matching meant guessing from position and
wording, and the roadmap treated reading corrections in as infeasible.

It was infeasible **for documents we did not produce**. We produce these. So a block may carry an
`anchor` — the node it came from — and the renderer writes it into the file as a Word content
control: invisible on the page, preserved when a person edits around it, gone if they delete the
block (which is how a deletion gets noticed rather than lost).

`propose_from_document` reads the corrected file and returns three kinds of thing, and the
difference between them is the whole design:

| | |
|---|---|
| **edit** | same node, different words. Unambiguous — returned as `editItems`, the exact shape `edit_nodes` takes. |
| **missing** | the graph has it, the document no longer does. **Reported, never deleted**: a deliberate cut and a slip while editing look identical in a Word file. |
| **unplaced** | text belonging to no node. Reported without a parent, because guessing one from position is how a sentence ends up under the wrong lesson. |

**It proposes and never writes.** Applying goes through `edit_nodes` like any other change, so the
diff is seen and confirmed. A tool that read a Word file and silently rewrote the curriculum would
be the most dangerous thing in this codebase.

Comparison is on the words: the bullet the formatter added and the whitespace Word normalised on
save are not edits, and reporting them would bury the real ones. A document with no anchors still
reads — it just cannot say where anything belongs, which is the honest answer rather than a
confident wrong one.

#### Which field a correction writes back to

The first version read every anchored node's text from `properties.content`, and it passed its
tests. Running it against the live server said otherwise: on `senegal/ci/maths` **21 nodes of 2019
keep their text in `content`, and all 21 are FormatterSpecs.** Every DocumentSection (1096),
Activity (519) and Lesson (60) keeps it in `description`. `proposeEdits` skips an anchor it has no
text for — deliberately, so it never reaches outside the scope it was given — so a correction to a
lesson banner matched nothing and was reported as **nothing at all**. Not an error; silence.

So the caller now resolves the field per node, in the order in which a node's text is load-bearing:
`content`, else the body of `description`, else its name line. Where the document's own text still
matches one of them exactly, that is the field the expert edited and nothing is inferred.

`editItems` names the argument that reaches the field it chose — `content`, `title` or `body`.
Emitting a `content` edit for a node whose text is its description would not correct anything: it
would leave a SECOND copy beside the real one. That is not hypothetical. It is exactly how four
catalog entries came to carry two copies of their prose, one of them citing formatter ids that had
moved on, invisible because only the other copy is ever rendered.

`body` did not exist when this was first written, and its absence is the same root cause: `title`
wrote the WHOLE `description`, so the only way to correct a name was to resend the body with it, and
the only way to reach a body was to resend the name. `edit_nodes` now splits them — `title` is the
name line and keeps what is under it, `body` is what is under it and keeps the name — which let the
head/tail bookkeeping here disappear.

One seam remains, and it is deliberate rather than an oversight: `render_document` writes the
segregated `previews/` prefix, while `propose_from_document` reads `documents/`. A corrected sheet
has been through a person and is a real deliverable, so it goes back through `create_upload_url` —
but it does mean the loop is not closed by the two tools alone.

### Knowing what has gone out of date (WP7)

A produced sheet is a photograph of the curriculum at a moment. The curriculum carries on without it,
and nothing said so — which is how the bucket ends up holding a sheet quoting wording nobody uses any
more, indistinguishable from a current one. There is a live instance in this very namespace: a record
describing its guides as "2 pages chacune", written before they were tightened to one.

The obvious fix is a graph version stamped on each document, and it is useless — any edit anywhere
bumps it, all eighty files go stale at once, and a flag that is always on is a flag nobody reads.
Staleness has to be **per document**, against the nodes that document actually drew from.

Which the anchors already say. So each produced file records its sources — the nodes behind its
blocks, with their wording at the time — and `check_stale` compares them against the graph now.
Editing one lesson flags the four files covering that lesson and nothing else.

The sources are **read out of the file's own anchors by the server**, never declared by the caller: a
caller that got its own list wrong would produce a document reporting itself current forever. Nothing
to declare, nothing to get wrong.

`changed` and `removed` are kept apart because they need different answers — reworded text can be
regenerated, a vanished node needs a person to decide what the document should say instead. Hashing
is on the words, so a re-import that reflows a paragraph is not a change.

> **A document with no recorded sources is UNKNOWN, never current.** Everything produced before this
> existed is in that state, including the twenty teacher sheets. Reporting them as up to date would
> be the most misleading thing here; regenerating one is what makes the question answerable.

### Merging the stack

A section has formatters, not a spec: the TLM's document-wide stack plus its own, each FormatterSpec
carrying a `render` bag beside its prose. `resolveRenderSpec` merges them, nearest wins, **deeply** —
a section overriding one margin must not silently drop the page size, because the resulting Letter
sheet is 1.8 cm short per page and this project has already shipped one production run that way. A
stack that merges into something invalid is refused where the formatter can be named.

## Not attempted

Composing the words — the golden's `[N]` lines were rewritten by hand during the tightening pass, and
laying out finished lines is a different job. Translation. Page counting, which needs a layout
engine. Translation. Page counting, which needs a layout
engine. And **Andika is not installed on the machine this ran on**, so nothing rendered here is at
true metrics: geometry, colour and structure are read from the file and unaffected, but no page
count from this environment means anything.
