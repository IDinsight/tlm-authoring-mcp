# Layout templates — a page's structure as data, filled by the server

**Status:** live (2026-09-14). Code in `backend/src/kg-recipes/layout-spec.ts` (the schema, validation,
stack merge) and `backend/src/curriculum/compose.ts` (the composer); tool `compose_section`
(`backend/src/server/compose.ts`); the ci/maths pupil book's template in
`backend/test/fixtures/senegal-pupil-layout.json`, imported by `scripts/set-pupil-layout.mjs`.

## The problem

[`formatter-render-spec.md`](formatter-render-spec.md) drew a line: the `render` bag carries
geometry, never structure. Structure — which blocks appear, in what order, where the page turns —
was authored as prose in each section's assembly guide, and a model read it and composed the page
on every production. The note of 12 September 2026 found the consequence: the same lesson produced
twice came out laid out differently, because nothing forced the same reading twice. It also found
where the silent faults came from — a directive paraphrased, a picture under the wrong activity —
which are transcription faults, and a model transcribes.

Yet a pupil lesson is one section with nine child sections of three shapes, and every word and
picture on its page is in the graph: the directive is the covered activity's title, the picture
hangs under that activity, the marker is the section's rank among its siblings. Only the shape was
not data.

## The decision

The shape becomes data too, in a **`layout`** field on a formatter, beside `render` and separate
from it. A `layout` is a list of **templates**. A template names the sections it applies to (a
regular expression on the section title; `root` for the section asked for, otherwise its children)
and holds a **block tree in the exact shape `render_document` accepts**, with placeholders:

| placeholder | fills with |
|---|---|
| `{{covered.title}}`, `{{covered.name}}`, `{{covered.content}}`, `{{covered.ordinalName}}` | the node the section covers |
| `{{covered.grouping.title}}`, `{{covered.grouping.ordinalName}}` | that node's parent |
| `{{section.title}}`, `{{rank}}`, `{{item}}` | the section, its rank, the current content line |
| `\|match:REGEX`, `\|upper` | keep a capture group; upper-case |
| `forEach: {of: "covered.content.lines", match}` on a line | one line per matching content line |
| `image.picture: REGEX` | the attached picture whose name matches |
| `image.asset: {relPath}` or `{byRank: [..]}` | a fixed file, or one per rank |
| `when: {rank: N}` on a block | the block for that rank only (a group's first pictogram, its page break) |
| `{kind: "children"}` | the composed child sections, in order |

The composer fills a section's template around its children's, in position order, reads each
picture's file for its aspect ratio, anchors every line built from a covered node to that node's
id (what `propose_from_document` reads back), and returns a tree ready for `lint_content` and
`render_document`.

**What it cannot fill it reports.** A child section matching no template is returned in
`unfilled` with its guide, for the model to compose and insert at its place; a picture a template
names and the graph lacks is a `problem`. The teacher guide, which is prose, is always unfilled,
and that is correct: one verb serves both document types without a special case. Nothing is ever
invented to fill a gap.

## Why this keeps the earlier line

`render` still carries no structure. Structure moved from prose a model reads to a template code
reads — both authored, both in the graph, both per subject. The section guides keep what a template
cannot say: illustration requests, reasons, anomalies awaiting the experts. The code knows block
kinds, placeholders and matching; it knows nothing of any page. A second subject with another page
shape writes its own templates and runs the same composer.

## What it gives

- **Speed.** The pupil side of a lesson is one call instead of four model compositions.
- **Sameness.** Same graph, same page, byte for byte — a change on the page means the graph changed.
- **Fewer silent faults.** Copied, not transcribed: the directive and the picture cannot be wrong
  by paraphrase or misplacement, so the page rules have less to find.
- **One place to change a page.** A layout decision is one edit to the template, and every lesson
  follows on its next production.

Proof on the first day: the delivered Leçon 11 composed from the graph alone renders to two pages
with the same twenty pictures, two tables and one break as the file the experts accepted.

## Holes — the fiche skeleton (2026-09-14)

The teacher fiche is a different shape of page: its banners, order and page break are fixed, but
each phase's lines are a model's composition from that phase's guide. A template can now leave a
**hole** — `{kind: "unfilled"}` — where a section's own lines go. The composer emits nothing there
and reports the section under `unfilled` with its guide and **`insertAt`**, the block path where the
hole was; the caller composes the lines and lands them with an `insert-before` patch on the composed
tree's `treeRef`, filling from the last hole up so an insertion never shifts a path still to be used.
The fiche skeleton (`backend/test/fixtures/senegal-fiche-layout.json`, imported by
`scripts/set-fiche-layout.mjs`) composes the header — week and day from the lesson's ordinal
(`{{covered.position|ceil-div:5}}`, `{{…|mod-1based:5}}`), the OS banner from the lesson's name,
the matériel line pulled out of the fiche's own guide (`{{section.guide|match:^Case MATÉRIEL : (.+)$}}`)
— then the two séance banners (the second carrying the page break) and the nine phase banners with
their colours and pictograms, each followed by a hole. A picture in a template may ask for the
teacher's copy (`mark: "answer"`), which the composer names apart from the plain band.

What a hole left to the model was exactly the prefixed-line grammar of the guides — `[N]`, `[FR]`,
`[IMAGE : …]`, `{pt:…}`, `{img:…}` — which is deterministic too. It is now compiled (below).

## Guide blocks — the grammar compiled (2026-09-14, evening)

The fourth production of the same fiche, run after the skeleton went live, still spent its largest
avoidable share composing the nine phases by hand: a hundred and fifteen block operations written by
script, pasted twice after an index error, and patch paths recomputed by rebuilding the tree locally.
The phase guides are not prose, though. Every line of a CI-maths phase guide is one of three things
— a printed line whose prefix names its voice, a marker that opens a picture block, a call to a
phrase of the repertoire — or specification that never prints; a census of the 465 phase sections
found nothing else. So a template may now hand a section's guide to the server: `{kind: "guide"}`
in place of `{kind: "unfilled"}`, and the composer writes the phase (`curriculum/guide-compile.ts`).

**The grammar is data, beside the templates.** The same `layout` bag declares `guide`:

| key | what it declares | CI maths |
|---|---|---|
| `line.pattern` | a printed line, with `(?<prefix>)` and `(?<text>)` groups; `line.style` its block style | `^\[(?<prefix>[A-Z]+!?)\]\s*(?<text>.*)$`, style `puce` |
| `prefixes` | prefix → voice, the render variant the line prints in; a prefix not listed is a reported defect | `N`, `N!` → `N`; `FR`, `FR!` → `FR` |
| `call.pattern`, `call.phrases` | a phrase call, `(?<id>)` and `(?<args>)`; the repertoire as id → text with `⟨slots⟩`; `markerSlot` names the slot a marker argument fills | `{pt:PT-07 …}`; 32 phrases |
| `inline.pattern`, `inline.assets` | an asset set in the line, `(?<name>)` → file and role | `{img:picto-je-fais}` → `assets/picto-je-fais.svg`, role `picto-section` |
| `image.pattern`, `image.roles`, `image.mark` | a picture block, `(?<name>)` and optional `(?<marker>)`; the role by name; the teacher's copy | `▲ [IMAGE : L25-nf-2]`; `-amorce$` → amorce, else bande; `mark: answer` |
| `markers` | marker glyph → the inline asset its pastille is | ★ ▲ ■ ● → `rep-etoile` … |
| `trailing` | the end of a speech line printed apart, in its own style, untranslated | `(…)` on `FR` lines → style `parenthese` |

**What the compiler does with a line**, in order: an `image` match opens a block — the attached
picture of that name floats on the block's first printed line (or a line of its own if none
follows), its marker becomes that line's pastille unless the phrase the line calls already set it
(« une seule pastille par activité »); a `line` match prints in its prefix's voice, its calls
replaced by the repertoire's text with slots filled from the template's `vars` (the phase's
pictogram), the marker argument and the free argument, its inline tokens set as image runs, its
trailing parenthesis split off; anything else stays in the guide. A picture wider than the stack's
`images.fullWidthAboveAspectRatio` does not float, the same threshold the page rule checks. The
teacher's copy (`mark`) is drawn only on a picture that records its correct cell.

**What it reports and never invents.** Per section, `compiled[]` says how many lines printed, how
many stayed in the guide, how many pictures were placed, and lists what could not be resolved — a
picture no attached Material carries, a phrase the repertoire lacks, a slot nothing fills (a
`{pt:PT-07}` without its example), a prefix the formatter does not know — each also under
`problems`, so `complete` is false. A line with an unfilled slot does not print half-made. The
model's part is to read the page, fix the guide where the report says, and re-compose.

**Why it stays generic.** The code knows no prefix, no phrase number and no glyph of any subject;
its tests run on an invented grammar (« M : », « É : », `<R-12>`, `(photo : …)`) as well as on the
CI-maths one. A second subject with line-structured guides declares its own grammar on its own
formatter; a subject whose guides are prose declares none and keeps its holes. The grammar is kept
to three motifs on purpose: what needs two lines to judge — a response following its question — is
a lint rule's business, and a richer grammar would be a language a curator could no longer edit.

## Seams

- Templates match by section title. A subject whose sections are not named by kind needs another
  match key; none has asked yet.
- The grammar reads one line at a time. A constraint across lines is a declared lint rule, not a
  grammar rule.
- The marker slot of a phrase is filled with the asset's NAME; a repertoire that wants the pastille
  set in line wraps the slot in its own inline syntax (`{img:⟨repère⟩}`). That is a convention of
  the data, stated here because the code cannot check it.
- A picture's ratio is read from its file, so composing needs the bucket. Where storage cannot be
  read the picture is a `problem`, never a guess.
- The answer signs under a band's cells (a rule newer than the delivered corpus) are not yet in the
  pupil template: the delivered files carry them inside the band image.
- A table's rows are a list of lists, which Firestore refuses; the store wraps and unwraps them at
  its boundary (`kg-store/firestore-shape.ts`, see the store reference). The first template import
  found this; the in-memory test store never would.
