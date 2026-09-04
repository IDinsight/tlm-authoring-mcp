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

Structure varies per lesson and belongs to the model; geometry is the same for every page a formatter
governs and belongs to the formatter. **An `if (subject === …)` anywhere in `src/render/` would mean
the split failed.**

## The module

`src/render/` is subject-agnostic and knows nothing about curricula, Firestore or MCP. Everything
reaches it through the `render/index.ts` barrel.

| File | What it owns |
|---|---|
| `document.ts` | The block-tree schema (`table` / `line` / `spacer`) and its validation. Unknown keys are **refused**, never ignored. |
| `docx.ts` | The layout itself: document model + resolved spec → `.docx` bytes. |
| `zip.ts` | A `.docx` is a zip of XML parts and the repo has no zip library; writing the container directly is ~60 lines of `node:zlib`. |
| `resolve-spec.ts` | A formatter **stack** → one effective spec. Nearest wins, and the merge is **deep**. |
| `variants.ts` | One source tree → one file per language, and deriving a language the tree does not carry. |
| `measure.ts` | Laying a file out and counting its pages. |
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
block tree. The server merges that node's formatter stack, validates the tree against it, lays out the
`.docx` and returns a short-lived `downloadUrl`. The tree shape is advertised in
`get_capabilities` under `section:'document'` — call `preview_generation` first for the section's
curriculum, routine and formatter prose.

**One source, one file per language.** When the formatter's `language.strategy` is `per-file`, each
declared variant gets its own document: a line tagged with a variant prints only in that variant's
file, a line marked `inAllFiles` prints in every one, and `files[]` comes back with one entry each.
Tables survive the split even when everything inside them is dropped — a banner is structure, not
speech, and a file that lost its banners would be missing its scaffolding rather than its translation.

Pass `translateInto` (a variant id, e.g. `wo`) to have the server **derive** a language the tree does
not carry, translating line by line through the subject's MOHEBS glossary so the wording matches
materials already in classrooms. Translation spends a metered backend, so it needs a role in the
workspace.

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
the page size actually produced and the whitespace left below the last line of each page; with
`budget.maxPages` declared it also reports `fits`.

Measuring is **opt-in** because it is not free. It needs a layout engine in the image, which the
Dockerfile installs only under `--build-arg WITH_LAYOUT_ENGINE=1` — measured at **149 MB** (108 → 257
MB) plus several seconds of cold start. Without it the call reports `available: false` rather than a
guess, and the render itself is unaffected. A wrong page count is worse than no page count, because a
wrong one gets believed and a missing one gets chased.

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
ships. `teacher-sheet.golden.test.ts` rebuilds lesson 1's teacher sheet from scratch and compares it
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

## Not done yet

- **The canonical bucket and history.** Output is preview-only. Writing a produced document into
  `documents/` and recording it in history is a separate decision with separate stakes.
- **Inter-block spacing has no schema key.** The spacer paragraphs between banners carry two numbers
  each with nowhere in `properties.render` to put them; they live in the document model for now.
- **`images.placement` can only be a default.** Whether a given picture floats or sits in the run of
  the line is a per-section choice, not a formatter-wide one.
- **CI never exercises the golden corpus** (see above).
