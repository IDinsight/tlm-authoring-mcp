# Rendering — a composed page into a `.docx`, and back again

The step that used to happen on one person's laptop. `preview_generation` hands a caller everything a
document needs and then says "now generate the `.docx`" — which was only ever true for whoever held
the Python scripts. This is the other half: the authoring model composes the page, the server lays it
out.

Three tools cover the round trip. `render_document` turns a composed page into a Word file,
`propose_from_document` reads a corrected Word file back into proposed graph edits, and `check_stale`
says which produced documents quote curriculum that has since moved. The design rationale — including
why this was rebuilt rather than ported, and what the golden corpus settled — is in
[`renderer-spike.md`](../design-notes/renderer-spike.md); the geometry schema is in
[`formatter-render-spec.md`](../design-notes/formatter-render-spec.md).

## The division of labour

This is the whole argument, and every other decision here follows from it:

| Who | Decides | Lives in |
|---|---|---|
| **The model** | What is *on* the page — which banner, in what order, where the page turns | The block tree it composes, per section |
| **The formatter** | What it *looks like* — page size, margins, type, colours, image ceilings, how a page break is written | `properties.render` on a `FormatterSpec` |
| **`src/render/`** | Nothing | — it merges the stack, validates the tree, and lays out |

So the block tree **carries no geometry**: no colour, no point size, no centimetre. A block names a
`style` and a picture names a `role`, both defined by the formatter. A page break says only
`pageBreak: 'before'`, and the formatter's `pagination.pageBreakCarrier` decides whether that is
written as a paragraph property or a paragraph of its own.

**Pictures.** A page names its pictures in `media`, inline as base64 or by a bucket `relPath`. Word
embeds raster pictures only, so a **vector** picture — an SVG; the pupil book's pictograms and answer
marks are SVG masters — is rasterized to PNG at layout, on the server, at 1024 px on its longer side
(`render/raster.ts`). Detection is by bytes, not by name, and the `.docx` part is written as `.png`
while the page keeps calling the picture by the name it gave. An SVG that sets text with a font is
**refused**, naming the file and the fix: the server has no fonts, and the letters would otherwise
render as nothing — a page that renders successfully and wrongly. `create_media_upload_url` accepts
`.svg` for the same reason.

Structure varies per lesson and belongs to the model; geometry is the same for every page a formatter
governs and belongs to the formatter. **An `if (subject === …)` anywhere in `src/render/` would mean
the split failed.**

## The module

`src/render/` is subject-agnostic and knows nothing about curricula, Firestore or MCP. Everything
reaches it through the `render/index.ts` barrel.

| File | What it owns |
|---|---|
| `document.ts` | The block-tree schema (`table` / `line` / `spacer` / `clear`) and its validation. Unknown keys are **refused**, never ignored. |
| `docx.ts` | The layout itself: document model + resolved spec → `.docx` bytes. |
| `zip.ts` | A `.docx` is a zip of XML parts and the repo has no zip library; writing the container directly is ~60 lines of `node:zlib`. |
| `resolve-spec.ts` | A formatter **stack** → one effective spec. Nearest wins, and the merge is **deep**. |
| `variants.ts` | One source tree → one file per language, and deriving a language the tree does not carry. |
| `measure.ts` | Laying a file out: the page count, where the words and the pictures landed, and marks drawn over marks. |
| `read-docx.ts` | A produced `.docx` → back into the block model. |
| `propose.ts` | A corrected document against the graph it came from → proposed edits. |
| `sources.ts` | What a document was made from, and whether that has moved since. |

### Why the stack merge is deep

A section does not have a render spec; it has **formatters**, each composed of `FormatterSpec`
children carrying a `render` bag. `documentSectionSubgraph` hands back the whole stack — the
document-wide formatters plus the section's own — and the renderer needs one spec.

Nearest wins, because a section attaching its own formatter is *overriding*, not restating. The merge
is deep because a section overriding one margin must not silently drop the other three: a shallow
merge would let `{ page: { marginsCm: { top: 1 } } }` erase the page size, and that failure shows up
as a Letter-sized sheet. The project has paid for that once.

## `render_document`

`nodeId` names the `DocumentSection` (or `TeachingLearningMaterial`) being rendered; `document` is the
block tree — or `treeRef`, see below. The server merges that node's formatter stack, validates the
tree against it, lays out the `.docx` and returns a short-lived `downloadUrl`. The tree shape is
advertised in `get_capabilities` under `section:'document'` — call `preview_generation` first for the
section's curriculum, routine and formatter prose.

### The tree by reference — `treeRef` and `patch`

A teacher sheet's tree is 20–26 KB, and the loop that produces one — compose, lint, render, measure,
fix, render again — carried it in full on every call: four or five times a sheet, ~100 KB of retyped
JSON, about a third of the wall clock (measured on Leçons 24 and 25). So the server keeps it.
`compose_section`, `lint_content` and `render_document` each hand back a **`treeRef`** for the tree
they used; the next call passes `treeRef` instead of `document`, and a correction travels as a
**`patch`** — a list of ops applied in order on block paths (`blocks[3]`, or inside a table cell
`blocks[1].rows[0][0].blocks[2]`, the same form lint findings use): `replace`, `insert-before`,
`insert-after`, `remove`, plus `media` (upsert an entry by name) and `remove-media`. A patch is
applied to a copy and the result validated; one that breaks the page is refused whole, naming the op,
and nothing is rendered. The response's ref is always for the tree **actually used**, patched or not.

A ref lives 24 hours, in the namespace it was made in (`server/tree-park.ts`, on the same pending
store the two-phase tools park their large payloads in — stored as one JSON string, because a block
tree nests arrays in arrays and Firestore refuses those as fields). A ref that resolves to nothing is
a refusal naming it with the only two causes it can have — expired, or another namespace — and the
caller re-sends the tree. A tree over ~900 KB (pictures inlined as base64) is not kept and the
response says so; such a tree should be naming its pictures by `nodeId` or `relPath` anyway.

**One source, one file per language.** When the formatter's `language.strategy` is `per-file`, each
declared variant gets its own document: a line tagged with a variant prints only in that variant's
file, a line marked `inAllFiles` prints in every one, and `files[]` comes back with one entry each.
Tables survive the split even when everything inside them is dropped — a banner is structure, not
speech, and a file that lost its banners would be missing its scaffolding rather than its translation.

Pass `translateInto` (a variant id, e.g. `wo`) to have the server **derive** a language the tree does
not carry, translating through the subject's MOHEBS glossary so the wording matches materials already
in classrooms. The lines go to the translator **as one batch** (the same `translateBatch` the
`translate` tool uses, several in flight at once, each line with its own term bank): one call per
line took a teacher sheet's 22 spoken lines to three minutes and past the client's timeout, and the
batch does them in seconds. A line the translator refuses refuses the whole render, naming it — a
Wolof file with one French line left in it reads as finished. Translation spends a metered backend,
so it needs a role in the workspace.

### The teacher's copy — `mark: "answer"`

The teacher's fiche shows each band with a check on the correct cell; the pupil's file shows it
plain. Every lesson used to make those copies by hand — download the bands, composite the tick,
upload seven new files under new names, place those by path — six to twelve minutes of a model's
time per lesson for an operation identical on every band seen. Now the graph records the answer and
the server draws it. `attach_image` takes `answerCells` (1-based, left to right, every vignette
counted, two when the answer line gives two), stored as `metadata.answerMark.cells` on the picture's
Material and shown under `pictures` in the section read; `edit_nodes` sets it on a picture already
attached. A media entry `{name, nodeId, mark: "answer"}` then gets the marked copy at render time
(`render/answer-mark.ts`): the picture rasterized if it was vector, the check drawn in the
formatter's `images.answerMark` colour, size and corner (black, a quarter of the cell, top-left by
default — the formatter's own words), and the page names the attached picture as before, so the two
picture rules still hold. Note that a clear is never free: when the block already runs past its
band, the clear still costs a body line (it shows under `gaps`), so it belongs only after a block
shorter than its band — `page_geometry`'s `linesBeside` says which. **The cell count is recorded with the answer** (`answerCellsOf`, stored as
`metadata.answerMark.of`): the first version derived it as width over height rounded, assuming square
vignettes, and the delivered bands refuted that on the first real lesson — 4.6:1 with a reference cell
and three signed ones is four cells, which rounding calls five. Without `of` the square guess still
stands and a refusal says it was a guess. A cell the band does not have, a picture that records no
answer, or bytes that cannot carry a mark are each a refusal naming the entry. `answerMarked` on the
response lists what was drawn.

### The `clear` block — ending a wrap

A floated band anchors to its paragraph and the text wraps beside it. When that paragraph is shorter
than the band — a one-line directive beside a 1.6 cm picture — the next block starts beside the band
too, and the next band, anchored there, **draws over the first**. The formatter prose always
prescribed the remedy (« un paragraphe de deux points portant un saut d'habillage "tout dégager" »)
but the tree had no block to say it with: a spacer adds height, and the height it needed differed
per lesson and was found by rendering, three times a sheet.

`{ kind: "clear" }` is that paragraph. It takes no numbers — the tree says *where*, the renderer says
how tall — and it is written as a text-wrapping break that clears both sides, so whatever follows
starts below the lowest floated picture, however tall it was. Three details were **measured, not
read**, and each costs the clear if dropped: the leading is *at least* two points, never exact (an
exact line cannot grow to reach below the picture, and LibreOffice then ignores the break — the next
band moved 4 pt, not 46); the paragraph *mark* is two points too, not only the run (at body size it
adds a whole body line of white under every picture, which across seven bands is more than a page's
reserve); and the type is the smallest Word accepts. Measured on this renderer's own output: 2.3 pt
between a band and the one that follows it.

### `page_geometry` — the numbers before the render

Every number a page is laid out with is deterministic — the line pitch, the width left beside a
floated band, how tall a 4.6:1 band stands — and every one was being discovered by rendering,
reading the measurement and rendering again: three measured renders a sheet at two and a half minutes
each. `page_geometry(nodeId, pictures?)` reads the **same merged formatter stack** the renderer uses
and does the arithmetic once: the page and its usable box, the line pitch and lines per page (under an
exact leading only — under `atLeast`/`auto` a line grows with its content and a number would be the
estimate this project has been burnt by), the block styles and their line budgets, the image ceilings,
and for each picture the caller says it will place (`{role, aspectRatio, float?}`) its printed size,
the width left for text beside it and **`linesBeside`** — how many body lines it stands beside, which
is how long its anchor block must run before the next float, or where a `clear` goes. Pictures are
sized by `imageSizeCm`, the renderer's own function, so the report cannot disagree with the file.
The first render is then a calculation rather than a guess.

**Isolation.** Output goes to the segregated `previews/` prefix on the same terms
`preview_generation` has: short-lived URLs, invisible to `reconcile` and `list_documents`, never
recorded through `log_generation`. Writing the canonical bucket is a separate decision with separate
stakes, and this tool deliberately cannot. It renders from the **draft** when one is open and from
**published** otherwise; `renderedFrom` says which, so a sheet is never mistaken for one made from
unpublished edits. Curators and approvers only.

### Measuring pages

> « Le nombre de pages se compte sur le RENDU, en PDF, jamais à la lecture d'un guide. »

That rule was earned. An estimate that counted the lines a guide declares put one document at 2.5
pages; it rendered at eleven. So `measure: true` lays each file out and **counts** its pages, reporting
the page size actually produced and, per page, where the words and the **pictures** landed; with
`budget.maxPages` declared it also reports `fits`.

Three poppler tools read the PDF: `pdfinfo` for the count and the page size, `pdftotext -bbox` for
the words, `pdftohtml -xml` for the pictures. The pictures matter because `freeBelowCm` used to be
the gap below the last *word*: a page ending in a picture band overstated the room left — the
dangerous direction for a number whose job is to say how close a sheet is to overflowing — and a
reserve check passed on the server that failed in print, by half a centimetre of band. It is now the
gap below the last **mark**, picture or word (`inkBottomCm`; `textBottomCm` and `imageBottomCm` stay
alongside), and each file reports **`reserveKept`** against `budget.reserveBottomCm` on its last
page. `picturesMeasured: false` says `pdftohtml` was absent — then `images` is empty and `overlaps`
says nothing, rather than reporting none.

Each page also reports **`overlaps`**: a picture drawn over the picture before it
(`image-over-image`, with the depth in cm), or over words (`image-over-text`, naming them). That is
the defect a page count never shows — a band anchored to a one-line activity, the next band anchored
beside it and drawn 0.36 cm into it, found by opening the PDF because the count and the whitespace
were both fine. The render response lifts every overlap to the file's own `overlaps`, with its page.
A pictogram set flush against its neighbours' glyph boxes is not an overlap: two boxes share ink only
past half a millimetre in both directions.

And **`gaps`**: white between two consecutive lines that no picture explains — a step of more than
one and a half line pitches, the pitch read off the page itself, with no picture spanning it. That is
what a `clear` nothing needed looks like: it ends a wrap that had already ended and costs a body line
(16 pt measured locally; more on a page whose text ran further). Seven defensive clears turned a
two-page fiche into three, and two render cycles went to finding the four that were for nothing.
Place clears from `page_geometry`'s `linesBeside`, and read `gaps` on the first measurement.

**The layout engine is warmed once and copied per call.** LibreOffice's first start with a profile
scans every installed font and builds its registry; every conversion used a fresh profile, so every
call paid that again — most of the two minutes a measured render was taking on the one-CPU instance,
and with two files measured in sequence the client's three-minute limit was overrun and the whole
response lost (Leçon 25, 2026-09-14). The server now warms one profile at startup by converting a
trivial document (an init-only start leaves the font cache cold — measured) and gives each conversion
a copy of it; the files of a render are measured side by side under a **100 s budget per file**, and
a measurement that overruns comes back `available:false` with the reason while the file still ships.
Each measurement reports `elapsedMs` (layout vs read) and `warmProfile`, so a slow call explains
itself without server logs.

Measuring is not free: it needs a layout engine in the image, measured at **149 MB** (108 → 257 MB)
plus several seconds of cold start. It was **opt-in** (`WITH_LAYOUT_ENGINE=0`) for as long as it
bought nothing — with no formatter carrying a `render` bag, `render_document` could not lay a page
out at all. The Dockerfile's **default is now `1`**, because the CI-maths teacher-sheet formatter
carries the gabarit's geometry and `budget.maxPages: 2` can now produce a verdict. Build with
`--build-arg WITH_LAYOUT_ENGINE=0` for a lean image; the call then reports `available: false` rather
than a guess, and the render itself is unaffected either way. A wrong page count is worse than no
page count, because a wrong one gets believed and a missing one gets chased.

The deploy workflow uses `gcloud run deploy --source backend`, which builds through Cloud Build and
has nowhere to pass `--build-arg` — so for the deployed service that Dockerfile default is the only
switch, and changing it is what turns measuring on in production.

**Andika is part of the measurement, not a nicety.** It is a literacy face with unusually generous
natural leading; substituting another changes glyph advances, which changes line counts, which changes
the page count this exists to report. `fonts-sil-andika` ships it.

## `propose_from_document` — the loop closing the other way

An expert opens a sheet, fixes a sentence, sends it back. `relPath` names the corrected `.docx` in the
bucket, and this works out what that means for the graph. It returns `proposals` and, for the ones
that can simply be applied, `editItems` in the exact shape `edit_nodes` takes.

**It proposes and never writes.** Applying goes through `edit_nodes` like any other change, so a
person sees the diff and confirms it. A tool that read a Word file and silently rewrote the curriculum
would be the most dangerous thing in this server.

Three outcomes, and the difference between them is the point:

- **EDIT** — the anchor is there and the words differ. Unambiguous: apply it.
- **MISSING** — the graph has the node, the document no longer does. Reported, **not** proposed as a
  delete: a deliberate cut and a slip while editing look identical in a Word file.
- **UNPLACED** — text belonging to no node. Reported without a parent, because guessing one from
  position is how a sentence ends up filed under the wrong lesson.

It works by reading node ids that `render_document` wrote into the file as Word **content controls** —
invisible on the page, preserved when a person edits around them. A document produced any other way
comes back `anchored: false` with its text but no matches; that is the honest answer, not a failure.
Comparison is on the **words**, ignoring the bullet the formatter adds and the whitespace Word
normalises — reporting those as edits would bury the real ones in noise.

## `check_stale` — which documents have gone out of date

A produced sheet is a photograph of the curriculum at a moment. The curriculum carries on without it
and nothing says so, which is how a bucket ends up holding a sheet quoting wording nobody uses any
more, indistinguishable from a current one.

The obvious fix — a graph version stamped on each document — is useless: any edit anywhere bumps it,
so every document goes stale at once and the flag stops meaning anything. Staleness has to be **per
document**, against the nodes that document actually drew from.

The anchors already say which those are. So a document's sources are exactly its anchors, read out of
the file itself rather than declared by anyone, and it is stale when any of their content has changed
since. Editing one lesson flags the files covering that lesson and nothing else. The result separates
`changed` from `removed` deliberately: reworded text can simply be regenerated, while a vanished node
needs a person to decide what the document should say instead.

**The one rule: a document that records no sources is `UNKNOWN`, never current.** Everything produced
before this existed is in that state, and reporting those as up to date would be the single most
misleading thing this could do.

Read-only — it says what is out of date and why; regenerating is a separate, deliberate act. Optional
`nodeId` narrows to one lesson. Members only (`readDocuments`).

## Verifying it still produces the real thing

`src/__golden__/` holds the only check that the renderer reproduces the documents the project actually
ships. `teacher-sheet-lecon11.golden.test.ts` rebuilds lesson 11's teacher sheet from scratch and compares it
against the real file; `pupil-tool.golden.test.ts` checks the same code carries a second document type
(42 picture placements against nine, grids of images in tables nested inside tables, a page break
standing on its own).

**The golden corpus is not in the repo** — a megabyte a sheet, twenty sheets — so both suites **skip
silently** unless the environment names the folders:

```bash
BASE="$HOME/Desktop/Maths CI new lessons"
GOLDEN_DIR="$BASE/Guide d'utilisation de l'outil de l'élève/Outputs" \
PUPIL_DIR="$BASE/Outil de l'élève/Inputs/Previously generated/lecon_01" \
  npx vitest run src/__golden__          # 19 passed, 2026-09-03
```

That the corpus lives on one laptop and nowhere else is a real risk, not a packaging detail — it is
the only definition of correct output the project has, and CI therefore never checks the renderer
against reality. Backing it up somewhere durable is worth doing before it is needed.

### The leading rule, and why the obvious version is wrong

Worth knowing because it is the defect the whole `properties.render` schema exists to make impossible.
A line height in points is ambiguous: under an **exact** rule Word crops an inline picture to the line
box, under an **automatic** one the line grows to the picture. During production this flattened every
full-width band to 5 mm — invisible to a page count, caught only by looking at the page.

The note written at the time reads "the paragraph carrying an image keeps automatic leading", and
implemented that way it is wrong: it relaxes the line under every pictogram too, each grows by a few
points, and across a sheet that is enough to push a séance onto another page. The rule that reproduces
the golden's own distribution exactly is narrower:

> A paragraph relaxes its leading only when it carries an inline picture **taller than the line box**.
> A floated picture never qualifies — it has no line to respect.

And relaxing has to be **written into the paragraph** (`w:lineRule="auto"`), not left to the document
default: the default is the body's exact leading, so a paragraph that says nothing inherits it and the
picture is cropped to the line — invisibly to a page count. The first sheet rendered with 2 cm
pictograms clipped every one of them to 14 pt and measured exactly the same as the corrected one.

## Not done yet

- **The canonical bucket and history.** Output is preview-only. Writing a produced document into
  `documents/` and recording it in history is a separate decision with separate stakes.
- **Inter-block spacing has no schema key.** The spacer paragraphs between banners carry two numbers
  each with nowhere in `properties.render` to put them; they live in the document model for now.
- **`images.placement` can only be a default.** Whether a given picture floats or sits in the run of
  the line is a per-section choice, not a formatter-wide one.
- **CI never exercises the golden corpus** (see above).
