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

## Seams

- Templates match by section title. A subject whose sections are not named by kind needs another
  match key; none has asked yet.
- A picture's ratio is read from its file, so composing needs the bucket. Where storage cannot be
  read the picture is a `problem`, never a guess.
- The answer signs under a band's cells (a rule newer than the delivered corpus) are not yet in the
  pupil template: the delivered files carry them inside the band image.
- A table's rows are a list of lists, which Firestore refuses; the store wraps and unwraps them at
  its boundary (`kg-store/firestore-shape.ts`, see the store reference). The first template import
  found this; the in-memory test store never would.
