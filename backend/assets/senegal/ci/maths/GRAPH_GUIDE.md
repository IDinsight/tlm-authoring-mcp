# CI Maths — graph guide

How the CI-maths knowledge graph is shaped, and how to author it. This is
guidance for you (the LLM), not machine config: the server already parses the
graph; read this to know the conventions and intent before you walk or edit it.

## Two layers

- **Standards spine** — the official curriculum objectives. A `StandardsFramework`
  root holds `StandardsFrameworkItem` (SFI) nodes. An SFI's `statementType` says
  what it is: `Objectif spécifique` (the OS — a taught objective) and domain values
  (`Arithmétique`, `Mesure`, …). An SFI holds its sub-skills as `LearningComponent`
  children.
- **Content layer** — the authored teaching material. ONE `Course` (`description`
  "Planification") holds 23 `LessonGrouping`s, every one a school week
  (`groupName: "Semaine"`). A `Lesson` is one taught lesson, hanging under its week.
  There is no `Chapitre` grouping — see "Chapters are derived, not stored" below.
  The weeks are numbered 1–25 with 10 and 18 missing, so week `position`s have gaps
  by design; don't renumber them.

## Querying the graph

- Every walk is paginated. Use `limit:50` and page with `cursor` — do not
  raise `limit`.
- Set `includeEdges:false` unless you specifically need the edges to
  reconstruct a subgraph.
- Narrow with `nodeTypes` and `edgeTypes`. `direction:'both'` without
  `nodeTypes` reaches the whole graph; avoid it.
- Common recipes:
    * All SFIs in a domain: fromId=<domainId>, direction='out',
      edgeTypes=['hasChild'], nodeTypes=['StandardsFrameworkItem'].
    * All lessons in the course: fromId=<courseId>, direction='out',
      edgeTypes=['hasPart'], nodeTypes=['Lesson','Assessment'] — content nests by
      `hasPart` only; `hasChild` is the standards tree.
    * A lesson's current alignments: fromId=<lessonId>, direction='out',
      edgeTypes=['hasEducationalAlignment'], maxDepth=1.

## How the layers connect

A `Lesson` aligns to the OS it teaches with a `hasEducationalAlignment` edge to that
`StandardsFrameworkItem` — the alignment, not a copy of the objective's text, is how
a lesson "knows" its objective. A `LearningComponent` `supports` the SFI it belongs to.

## One lesson, one parent — its week

A lesson sits under exactly ONE container: its `Semaine` grouping, by `hasPart` (the
edge carries `axis:"schedule"`). All 84 lessons and all 28 bilans have a single
parent. An earlier shape of this graph also hung a lesson under a `Chapitre` on a
second axis — that is gone. A node with two containment parents is now a mistake to
report, not a design to preserve.

## Chapters are derived, not stored

The Student's Book is written chapter by chapter, but a chapter is **not a node**.
It is a run of the course-wide ordinal:

- every `Lesson` and `Assessment` carries `metadata.order`, unique and gapless from
  1 to 112 across the whole course;
- sort by it; each run ENDING at a **chapter bilan** is one chapter — 25 of them,
  covering every lesson with none left over.

**Not every bilan closes a chapter.** Of the 28 `Assessment`s, 25 are chapter bilans
("Bilan du chapitre N") and **3 are palier-integration bilans** ("Bilan des chapitres
1 et 5 (intégration du palier 1)", at orders 27, 43 and 80). A palier bilan assesses
across chapters that have already ended, so it sits INSIDE a chapter's run and must
not be treated as a boundary — split on it and one chapter wrongly swallows the next
one's lessons. The title is what separates them; nothing else in the data does.

So to assemble a chapter: find its chapter bilan, then take the lessons whose
`metadata.order` sits between the previous chapter bilan's and this one's. Three
consequences worth knowing before you plan a document:

- **The ordinal is course-wide, not per-week.** 13 of the 25 chapters span more than
  one week, and 13 of the 23 weeks hold parts of more than one chapter. A chapter and
  a week are different slices of the same lessons.
- **Chapter NUMBERS come from the source Planification and are not sequential.** They
  run 1–29 out of order and with gaps (…7, 6, …11, 12, 13, 10…), and **two different
  chapters are both numbered 25**. Trust the run for what belongs together; use the
  bilan's `description` verbatim for what the chapter is called. Never renumber a
  chapter to close a gap, and never assume a number identifies a chapter uniquely.

Seven runs currently hold a bilan and no lessons — their lessons are not authored
yet. That is a gap in the data, not a rule.

## The bilan

A chapter's assessment (the "bilan") is an **`Assessment`** node — LC's first-class
label for it — still carrying `educationalUse: "Assessment"`. It is data, not a title
heuristic. A bilan hangs under its **week** by `hasPart` exactly like a lesson, and
aligns to the OS it assesses; unlike a lesson it carries no `position` (canonical
`Assessment` has no ordinal — its place in the sequence comes from `metadata.order`).

A bilan aligns to a spine standard **titled "Bilan …"**; a lesson aligns to an
ordinary objective. The spine holds 28 such standards and each has exactly one content
node, so that pairing is what tells the two apart — not the node's own title. Both
mislabellings this graph had were caught by it: a lesson wrongly labelled `Assessment`
(its alignment pointed at an ordinary objective) and four bilans wrongly labelled
`Lesson` (their alignments pointed at bilan standards). When a node's own title and its
alignment DISAGREE, that is the interesting case — stop and look, don't relabel.

The bilan is what CLOSES a chapter, so there is exactly one per chapter by
construction. It is NOT one per week: 18 of the 23 weeks hold at least one bilan —
10 hold one, 7 hold two, 1 holds four — and 5 weeks hold none. Don't add a bilan to
"complete" a week.

## Authoring conventions

- **Add a lesson:** create a `Lesson` under its `Semaine` (`hasPart`), give it a
  `position` within the week AND a `metadata.order` in the course-wide sequence (the
  ordinal chapters are derived from), and align it to the OS it teaches
  (`hasEducationalAlignment`).
- **Ordinals** live in `position`; membership is the edge, so repositioning a node
  never cascades to its siblings.
- **Kinds are the graph's own words** — a grouping's `groupName`, an SFI's
  `statementType`, a content leaf's LC `label`. There is no separate subject "role"
  tag to set.

## Removing content

- **`delete_nodes` and `delete_edges` are bulk.** Both take an ARRAY of ids and
  remove one or many in ONE atomic draft edit (one dry-run + one confirm) — not one
  round-trip per item. All-or-nothing: a missing id, or an id listed twice, blocks
  the whole batch.
- **`delete_nodes` cascades along containment** (`hasPart`/`hasChild`): it removes
  each node, every descendant whose parents are ALL in the deleted set, and every
  edge incident to a removed node. The dry-run WARNS with the FULL set that will
  vanish — read it before confirming; seeing the cascade is the safety (no force flag).
- **A week is a lesson's ONLY parent, so deleting one takes everything under it.**
  There is no second axis holding the lessons up any more: `delete_nodes` on a
  `Semaine` removes that week's lessons, its bilan, and their `Activity` tasks. Read
  the dry-run's cascade before confirming. To remove a single lesson, delete the
  `Lesson` itself (its `Activity` tasks cascade with it).
- **To keep a subtree, detach first:** `delete_edges` the containment edge into the
  node, then `delete_nodes` it — the now-detached children survive.
- Both are DRAFT edits — nothing is live until `publish_draft`.

## Coverage expectations

A well-formed chapter satisfies these. There are no automatic coverage warnings on
an edit, `diff_draft`, or publish — `review_draft` checks all of them against the
draft and reports any it finds:

- **One week per lesson** — every `Lesson` and `Assessment` has exactly one
  containment parent, a `Semaine`, via `hasPart`. Two parents, or none, is wrong.
- **The course ordinal is intact** — `metadata.order` across all `Lesson`s and
  `Assessment`s is unique and gapless from 1. It is what chapters are derived from,
  so a gap or a duplicate silently redraws a chapter boundary.
- **Every chapter ends in a bilan** — sorted by `metadata.order`, the LAST item is a
  chapter bilan, so no lessons trail past the final chapter.
- **Every bilan standard has exactly one content node** — the spine's 28 "Bilan …"
  standards each pair with one `Assessment`. A `Lesson` aligned to one is mislabelled.
- **No empty chapter** — each run between chapter bilans holds at least one `Lesson`.
  Seven fail this today (bilan, no lessons); that is known unfinished authoring.
- **Every teaching lesson is aligned** — each `Lesson` has a
  `hasEducationalAlignment` edge to the OS it teaches. A lesson with no alignment
  is unmoored from the curriculum.
- **Every bilan is aligned too** — each `Assessment` aligns to the OS it assesses.

## Generating documents from the graph

The graph gives you the curriculum; the **routines** give you each document's section
structure; the **formatters** hanging off each **TLM** (by `hasPart`) give you the
look. What follows is the **authoring judgment** that sits on top — the part that is
neither structure nor style.

There are two deliverables, each its own **`TeachingLearningMaterial`** (a TLM — find
it in `namespace_stats.roots` by filtering `labels` for `TeachingLearningMaterial`):
- the **Student's Book** — the TLM whose `description` is **"Outil de l'élève"**
  (the illustrated pupil manual, one chapter at a time);
- the **Teacher's Guide** — the TLM whose `description` is **"Guide de
  l'enseignant"** (the lesson sheets — *fiches de leçon* — for a chapter).

Both `covers` the SAME single `Course`; the deliverable is the TLM, and the Course is
the curriculum they each render differently. Read a TLM with `walk_document(tlmId)`.

Read a lesson's objective and sub-skills with `get_standards(lessonId)`: the aligned
`StandardsFrameworkItem` `description` is the OS text, and its `LearningComponent`s are
the sub-skills an activity targets. Empty `nodes` means that lesson is not yet wired to
the spine — say the OS is missing, don't invent it.

### The per-piece reader: `walk_document_section`

Produce a document **one slot at a time**, and read that slot with
**`walk_document_section(sectionId)`** — the per-piece generation entry. A slot is a
`DocumentSection` under its TLM that `covers` the curriculum it renders: a chapter of the
Student's Book, a *fiche* of the Teacher's Guide. In a **single read** the reader returns
everything that piece composes over:

- its **curriculum** — the covered subtree (pure `hasPart`/`hasChild`);
- the **routine** that applies — resolved nearest-wins, document-first: the section's own
  `usesRoutine`, else the owning TLM's, else the covered `Course`'s (this is where a
  Teacher's-Guide-specific routine like the *Fiche* lives, inherited by every fiche);
- the **formatters** — the TLM's doc-wide Formatter/FormatterSpec stack unioned with the
  section's own.

So you no longer assemble the routine and the style by hand — one call hands you all three
for the exact slot you are generating.

**Find (or author) the section first.** List a TLM's slots with
`walk_document(tlmId).sections`. Neither maths TLM has a spine yet — both still
resolve by the `covers → Course` fallback (`scope: "course"`) — so today this is
always the authoring path, not the lookup path. Author the slot as the
first step of generating that piece: `add_nodes` a `DocumentSection` (give it a
`position`), then `create_edges` a `hasPart` from the TLM to it and a `covers` from it to
the chapter/lesson it renders — publish, and `walk_document_section` now drives the piece.
Authoring the slot spine is part of producing the document, not a prerequisite someone
else must finish first.

### Conventions for both deliverables

- **French only.** Titles, prose, activity prompts, teacher speech, metadata — all
  French. `get_terminology` returns a French *and* a Wolof rendering; use **only** the
  French, and never place the Wolof form in a maths document.
- **Faithful to curriculum vocabulary.** Use each lesson's OS text (from
  `get_standards`) verbatim and the official terms from `get_terminology`; do not
  paraphrase an objective or swap a synonym for a key mathematical term. The term stays
  exact in the **title, the "Je retiens", and the teacher metadata**. (A child-facing
  question stem may be simplified to a concrete phrasing — see below — as long as the
  key term still appears in those three places.) If a term's official wording is
  missing, say so rather than invent it.
- **Everyday Senegalese life.** Set scenes in the market, compound, village, schoolyard,
  fields, garden, well, roadside — **avoid classroom interiors** unless the objective
  genuinely needs one (a board or ten-frame demo) with no everyday alternative. Use
  Senegalese names (Awa, Moussa, Binta, Samba, Fatou, Ibrahima…) and objects (mangues,
  oranges, paniers, calebasses, cauris, tam-tams, pirogues). Reuse the **characters
  already established** across the book, and adopt a **fresh example domain** each
  chapter, so successive chapters vary their objects. Both come from the same place:
  read a few recent chapters with `list_documents` / `get_document_text` and see which
  characters and object families they already used.
- **Pedagogy (APC + enseignement explicite).** The teacher models, then guides, then
  pupils practise; skills are set in realistic situations; move concrete → abstract;
  treat errors as learning (distractors are real misconceptions); keep text minimal.

### Student's Book (chapters — "Outil de l'élève")

**The golden rule: a 6-year-old answers by LOOKING, not by REMEMBERING.** CI pupils
barely read and cannot hold an abstract set in working memory. Every activity must be
solvable purely by looking at its **own** image. If answering needs the child to recall
the opening scene, flip to another page, or reconstruct a set that isn't drawn right
there, the activity is wrong — redesign it.

**Self-contained images.** Everything needed to answer is drawn inside that one activity
image: if the question is about "le grand panier", the basket is drawn there; a
*réunion* draws both source baskets; a *partition* draws the set to be sorted; a
comparison draws both groups in each option panel.

**Decidable, never self-answering questions.**
- Ban tautological "identify-then-verify" stems (e.g. *"Montre le sous-ensemble des
  tomates. Est-il inclus dans le grand panier ?"* — it answers itself).
- **Inclusion is a real question only when a *separate* candidate is tested against a
  drawn reference:** draw the reference set, then three candidate baskets (A/B/C), and
  ask which one *could come entirely from* it. The correct candidate uses only objects
  present in the reference; distractors introduce at least one that isn't.
- **One idea per question** — never chain "do X, and is Y true?".
- The child-facing stem stays concrete and answerable by looking (*"Quel petit panier
  peut sortir du grand panier ?"*); the abstract term (inclusion, partition, réunion)
  lives in the title / "Je retiens" / metadata.

**CI calibration.** Keep every group to about **five objects or fewer** (subitisable at
a glance); make the correct option verifiable by direct visual matching against the
drawn stimulus; make distractors **visible misconceptions** ("included because it's also
a vegetable", "sorted but one item left behind", "joined but one basket forgotten"), not
random noise; and **vary the correct letter** across activities (don't let it sit on A).

**The amorce scene.** Before writing it, review *all* the chapter's components (from
`get_standards`) and pick a scene rich enough to seed every activity image. It is the
reference the **bilan** points back to, so draw the relevant set(s) with small,
countable quantities, and make its warm-up questions decidable from the drawn scene.

**Chapter coverage.** Judge coverage **per lesson**: every non-bilan lesson is targeted
by at least one activity (if several lessons share a component, each still gets its own),
and wherever the OS supports it a lesson gets **two distinct** activities. The bilan's
questions together cover every non-bilan OS and stay decidable from the amorce image.

**Two-pass generation.** Write the whole chapter *before* generating any image.
- *Pass 1* — produce the complete `.docx`, and wherever an image belongs insert a
  labelled `[IMAGE: <id>]` description block instead: self-contained enough to hand
  straight to the image generator, specifying the stimulus (if any) **and all three
  A/B/C choices**, because the choices appear **only in the image** and are never written
  as text. (The bilan has no image — it refers back in words to the amorce.)
- *Pass 2* — generate the **amorce first** (it fixes the cast and palette), then each
  activity image; **check every finished image against its answer key** (correct option
  present, at the intended letter, uniquely correct; counts and contents match) and
  regenerate any that don't; then embed. Ratios, on-page sizes, the art-style block to
  prepend, and image compression all come from the **formatters** — read them, don't
  reinvent them.

Pupils do not write in the book (MCQ; the pupil writes only the letter).

### Teacher's Guide (lesson sheets — "Guide de l'enseignant")

The five-step structure, its names, its timings, and each step's spec come from the
**"Fiche de leçon — enseignement explicite" routine** (including the first-lesson /
intermediate / bilan variants and the bilan's question split) — `walk_document_section`
returns it as this fiche's `routine`, alongside the curriculum and the formatter; don't
restate it. The house style comes from the returned **formatter**. What follows is the
delivery judgment on top.

- **Low-cost, blackboard-first (the load-bearing constraint).** Schools cannot buy
  props, so the teacher demonstrates **primarily on the blackboard** — chalk drawings,
  tally marks, and closed loops ("patates") standing for the ensembles and
  sous-ensembles. Beyond the board, use **only free, already-available** supports: chalk
  and board, the pupils' slates (*ardoises*), their fingers, and small no-cost items they
  can gather themselves (*cailloux, cauris, bâtonnets, capsules*). **Never** ask the
  teacher to buy or bring real produce or baskets — represent them as **drawings on the
  board**. This holds for every step, and especially the JE FAIS steps.
- **No images.** Lesson sheets contain no image of any kind — not even the amorce
  picture. Where a lesson evokes the opening scene, the teacher does so in words and may
  point pupils to the picture in **their own** manual (*"Regardez bien l'image de votre
  manuel…"*).
- **Writing voice.** Third-person narration ("le maître présente / pose / lit" — "les
  élèves ouvrent / répondent / justifient"); teacher speech as **`E dit : « … »`**;
  emphasis on key words via **UPPERCASE** (GAUCHE, PLUS LOURD, DIZAINE), not bold. (The
  colours these take come from the formatter.)
- **Delivery rules.** Lessons run ~30 minutes; the teacher reads every instruction aloud
  (pupils cannot read yet); at independent practice pupils write **only the letter**
  (A/B/C); one sheet = one lesson = one OS (two at most if closely linked — and where
  several lessons share an OS, differentiate the sheets by facet: discovery,
  manipulation, consolidation). Each sheet's activities build **directly** on the pupil
  manual's activities for the same OS.
