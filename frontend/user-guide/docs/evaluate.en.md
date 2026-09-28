# Evaluate a document

You have produced a document. How do you know it is **good**? You hold it up against an **evaluation grid**: a list of criteria written ahead of time for your curriculum, kept in the catalog and attached to the document.

It is the third kind of catalog entry:

| Entry | What it describes | Applies to |
|---|---|---|
| **Routine** | How a session unfolds | A course, a lesson, an activity |
| **Formatter** | What a document looks like | A document |
| **Evaluation grid** | The criteria used to judge the result | A document |

## Two kinds of grid

Every grid carries a **scale**, and the scale decides what the evaluation gives you.

| Kind | Scale | Result |
|---|---|---|
| **Scored grid** | Numeric (for example 0 to 4) | A **score**, the weighted average of its sections |
| **Approval grid** | Yes / No | A **green light**: a single "No" blocks it, and there is no average |

One measures *how* good the document is; the other tells you whether it *can go to print*. A document can score very well and still be held back by one "No", which is why the two are often attached together.

The scale, the sections, the weights and the criteria all come from the grid **as it is written in the catalog**. The tool knows none of them in advance.

> "Which grids does the catalog offer?"

## Attach a grid

> "Attach the approval grid to this document."

Like a routine or a formatter, the grid is **copied** under the document, so a later change in the catalog does not reach it. A document can carry several grids, and the evaluation reports on all of them.

!!! warning "A grid attached twice counts twice"
    If you are not sure, ask before attaching: "Which grids are attached to this document?"

## Run the evaluation

> "Evaluate this document."

The tool gathers the document's grids and the produced file. **Claude does the reading and the scoring**, criterion by criterion, and gives the reason for every score. The tool never passes judgement itself.

With the authoring plugin, `/evaluer` carries out the evaluation **in a single review**, in this order:

1. is the document **ready** (coverage, sections, formatter, grids);
2. the draft's **wiring**;
3. **coverage**, measured against the subject guide;
4. **consistency** between the things that are written, and the **composed page checked against the graph**;
5. the **grids**, applied to the rendered file;
6. **terminology**, if the document is translated: are the terms it uses the ones in the workspace's lexicon?

!!! tip "Ask where each mistake is"
    A score with no evidence is no use to anyone. A good accuracy criterion asks for **every error to be quoted, along with where it appears**. If a score or a "No" comes back without a quoted passage, ask for it again.

## What a grid does not need to check

Anything the tool **already guarantees** does not need ticking off by hand: margins and sizes (the formatter applies them), the page count (the render measures it), an instruction copied out wrong (the page check compares it with the curriculum). Claude sorts the grid before reading it. Whatever is already guaranteed is flagged as such, and the rest is judged against the document.

A grid is therefore best kept to the criteria that **require actually reading** the produced document.

## What the evaluation cannot do

Some criteria assume a **field test**: how well pupils understand the instructions, how long they take to solve an exercise. Reading the document cannot tell you that. The rule is to **say so** rather than invent a score. A made-up score gives false confidence, and that is worse than an empty box.

Other criteria can only be judged across the **whole document**: anything about balance or spread, whether between types of exercise, settings or characters. Those are assessed after a full read, never page by page.

!!! note "No curriculum evaluation yet"
    A grid attaches to a **document**. Evaluating the curriculum itself against a grid is not planned for now.
