---
name: reprendre-corrections
description: Take an expert's corrected document back into the graph — read the PDF render in a subagent, propose one batched edit, and never object to something you have not seen yourself. Use when someone hands back a marked-up or corrected .docx, or says "voici les corrections", "l'expert a relu", "reprendre ses remarques", "intégrer les corrections".
---

# Taking an expert's corrections back into the graph

The expert opened a produced sheet, corrected it in place, and handed it back. Your job is to turn
their corrections into graph edits — faithfully, and without inventing objections.

## Read the PDF render. Never a Word or LibreOffice conversion.

This is the one rule in this skill that is not negotiable, and it is mechanical, not stylistic.

**A conversion drops tables.** Everything laid out in a table disappears from the extracted text
without any error. You then "discover" that content is missing, and raise it — and the content was
there all along, on the page, in a table. That has happened, and the false objections cost a day.

So: work from the **PDF render** of the document. If you only have a `.docx`, say so and ask for the
PDF rather than proceeding on converted text. `get_document_text` extracts from `.docx` through a
converter and carries exactly this limitation — it is fine for a quick look, and not fine as the
basis for an objection.

## Do the reading in a subagent

Dispatch the `lecteur` subagent. It reads the whole source and returns **a structured edit
proposal** — a list of `{ what changed, where, from, to }` — not a narrative.

This is the single largest token saving available: a bulk read that costs ~184,000 tokens inside a
subagent returns ~2,000 to the main thread. Read the source yourself only when the proposal points
at something you must verify with your own eyes.

## Resolve targets by name, in one call

The proposal names lessons and sections the way the expert does. Turn the whole list into ids with
**one** `find_node` call passing `queries`. Anything in its `unresolved` list needs the expert's
answer — ask, quoting each candidate's path. Do not guess a target.

## Emit ONE batched edit

All of it goes in a single `edit_nodes` call with an `items` array — one item per node, each
carrying only the fields that change. One batch is one diff, one token, one audit record, and it
either lands whole or not at all.

Do not loop one edit per correction. Do not delete and re-add a node to "replace" it: that cascades
its subtree, drops every edge pointing at it, and mints a new id, so every reference to it breaks
silently.

## Never raise an objection you have not seen

Before you tell the expert that something is missing, wrong, or inconsistent: **find it in the PDF
yourself.** Quote the page.

Four objections were raised last week that were not real, and each was caught only because a person
opened the PDF. An objection you cannot point at is a guess, and the expert has to spend their time
disproving it.

If the proposal and the document disagree, the document wins and the proposal is wrong.

## Then present it

Show the batch as the expert would recognise it — grouped by lesson, in their vocabulary, in French.
Get an explicit yes, then confirm. The `session-autorat` skill carries the rest of the write
discipline.
