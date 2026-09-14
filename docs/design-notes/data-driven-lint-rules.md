# Lint rules as data — a formatter declares what its lines must look like

**Status:** live (2026-09-14). Code in `backend/src/kg-recipes/lint-rules.ts` (the schema, validation
at `edit_nodes`/`add_nodes` time) and `backend/src/curriculum/lint-declared.ts` (the runner, called by
`lint_content`); the fiche's rules in `backend/test/fixtures/senegal-fiche-lint-rules.json`, imported
by `scripts/set-fiche-lint-rules.mjs`.

## The problem

Two productions of Leçon 25, a day apart, re-found the same defects in the guides and arbitrated them by
hand, one by one: PT-07 called without its mandatory example; « Aujourd'hui, nous allons apprendre
à… » prefixed `[FR]` although the gabarit says it never prints; a RÉPONSE line running to a hundred
characters of justification; the amorce's oral questions with no answer in their parenthesis; bullets
over the one-line budget; a letter A/B/C on the page. Each costs a decision per fiche, and none is
caught, because `lint_content`'s rules are code and these are subject knowledge — the line the
project drew on purpose: *a rule here only ever asks a question the DATA answers; what a subject's
page must look like stays in its guide.*

## The decision

Both halves of that line hold if the rule itself is data. A formatter carries `properties.lintRules`
beside its `render` geometry and its `layout` templates: a list of *a line that looks like X must also
look like Y*, each with an id, a message, a fix. `lint_content` runs them the way it runs its own,
reports them as `declared:<id>`, and a node silences one with `metadata.lintIgnore` like any other.
A curator adds, edits or retires a rule with `edit_nodes`, validated on the spot, and the next lint
follows — no deploy.

A rule says **where** it reads: the assembly guides of the document the formatter is attached to and
of every section under it (`guide`, optionally only the sections whose title matches `sections`); the
`content` of the curriculum those sections cover (`content`); or the lines of a composed page checked
against a stack that carries the formatter (`page`). And **what** a matched line must satisfy:
`require` (must also match), `forbid` (must not), `maxChars`, with `unless` for the named exceptions;
a rule with `match` alone says the line should not be written like this at all.

## Why it keeps the earlier line

The code knows what a line is, where a document's lines are, and how to say which one broke which
rule. It knows nothing about PT-07, [FR], or a parenthesis: those are on the formatter, in the
subject's graph, where the guide already keeps its control points. The six rules of the fiche are
data in a fixture, not literals in a test.

## Scope — the node asked about, not the subject

A guide rule reads every section of the document its formatter governs. On the live CI-maths graph
the bullet-length rule alone matches **1,072** existing lines across 374 sections, and
`lint_content` had no cap on findings — importing that rule would have pushed every lint
response in the subject past the size limit, and the composer checking one page would have read a
thousand findings about pages it was not composing.

So `lint_content` takes the `nodeId` it already needed for the page rules and gives it to the
guide and content rules too: with a section, they read that section and what hangs under it (its
own guide lines, the content its own `covers` reach); with the document, everything under it;
the response says what was read under `declaredScope`. Without a node the rules still read the
whole subject, but the list is cut to the first 50 and the count per rule is kept under
`declaredTruncated`, with the instruction to pass `nodeId`. The skill says to pass it every time.

## Seams

- A rule reads lines. A defect that spans lines — a gesture line missing before a speech line, a
  phase with too many activities — needs a rule shape this does not have.
- `page` rules see printed text only, after composition; a prefix like `[FR]` is gone by then, so a
  rule about prefixes is a `guide` rule.
- The fiche's rule list is a first cut written from two diagnoses; its thresholds (`maxChars`) and
  exemptions are the curator's to tune.
