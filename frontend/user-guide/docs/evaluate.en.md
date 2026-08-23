# Evaluate a produced document

Once a document has been generated, how do you know whether it is **any good**? You check it against an **evaluation rubric** — a list of criteria written in advance, kept in the catalog and attached to the document.

This is the catalog's third kind of entry, alongside [instructional routines](routines.md) and [formatters](formatters.md):

| Entry kind | What it describes | Applies to |
|---|---|---|
| **Routine** | The teaching structure of a session | A lesson |
| **Formatter** | How the document looks | A document |
| **Evaluation rubric** | The criteria the result is judged by | A document |

## Two shapes of rubric

A rubric carries a **scale**, and the scale decides what an evaluation produces. Two shapes recur:

| Shape | Scale | What it decides |
|---|---|---|
| **Scored rubric** | A numeric scale (for example 0 to 4) | A **score**, the weighted average of its sections |
| **Approval checklist** | Yes / No | A **go / no-go**. A single "No" blocks — there is no average |

The two do not replace one another: one measures *how good* the document is, the other says whether it *may go to print*. The same document can score well and still be blocked by a single "No" — which is exactly why both are often attached to it.

The scale, the sections, their weights and the criteria all come from the rubric **as written in the catalog**. The tool knows no rubric in advance: your programme files its own there (often taken from an official annexe), and that text is what counts.

!!! info "A rubric is better off partial"
    A rubric need not reproduce in full the source document it is drawn from. Whatever a **formatter already guarantees at generation time** — margins, font size, pagination, illustration style — need not be re-checked afterwards: you do not want to produce a document in 9 pt and then tick "No". Keep the criteria that **require reading the produced document**.

## Attach a rubric to a document

A rubric in the catalog does not apply itself — you **attach** it to the document it judges.

> "Apply the approval rubric to this document."

As with a routine or a formatter, attaching creates an **independent copy** under the document. Later edits to the catalog's rubric do not reach documents already served.

One document may carry **several rubrics** — and normally does: one for the score, one for approval. The evaluation reports every one of them.

!!! warning "A rubric attached twice counts twice"
    Nothing stops you attaching the same rubric to a document twice — the evaluation would then report it in duplicate. If in doubt, ask "which rubrics are attached to this document?" before attaching.

## Run the evaluation

> "Evaluate this document."

The tool gathers the rubrics attached to the document plus the produced file, and then **Claude reads the document and assigns the scores** — the tool never judges by itself. You get, criterion by criterion: the score (or the Yes / No), and the reasoning behind it.

!!! tip "Ask for locations"
    A score without evidence is worthless. A well-written accuracy criterion asks for **each error to be cited with where it appears** — and a score or a "No" that arrives with no passage cited is worth asking about again.

## What an evaluation cannot do

Some criteria assume a **field test**: how many pupils understand the instructions, how long an exercise takes to solve. These cannot be inferred from reading a document.

The rule there is to **say so** rather than invent a score. A fabricated score on an unobservable criterion is worse than a blank: it creates false assurance.

Likewise, a criterion may only make sense across the **whole document**: anything about balance or spread — between exercise types, between contexts, between characters — means nothing page by page. Those are judged after a complete read.
