---
description: Produire tous les fichiers qu'une leçon doit, en ne refaisant que ce qui est périmé
argument-hint: [la leçon, par son nom ou son numéro ; ajouter « tout » pour refaire même les fichiers à jour]
---

Produce every file this lesson owes: $ARGUMENTS

Follow the `produire-une-lecon` skill in its order. Resolve the lesson by name, list the sections
that cover it and their documents, and check each existing file's freshness before doing anything:
skip what is current and say so, unless I asked for everything.

Read each document's shared parts once. For every page: compose, run `lint_content` on the tree
before any render, render with `measure:true` and the languages the formatter declares (one
composition, the other languages derived), tighten and re-check on overflow.

Launch the `illustrateur` in the background before the reads, and read its findings before the
deposit. The measurement is the render's own (`measurement` on each file), never a second agent's,
and no review runs here — the grid is `/evaluer`, which I run separately on what was deposited.
Deposit the deliverables, add a journal entry to each produced section, and give me the delivery
note: per file pages, foot margin, font as declared, overlaps and gaps, the page-check and
illustrator findings; per lesson what was skipped and what was refused.

Never produce around a missing picture, missing content or a refused page check: stop and tell me
which skill fills the gap.
