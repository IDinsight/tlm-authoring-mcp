# Compose a document

A **document** is what actually gets produced: a pupil's book, a teacher's guide, a revision sheet, a workbook. It is not the curriculum. It is a separate element of the graph that says **what it covers** in the curriculum, **what it looks like**, and **what it is judged against**.

Your graph is what tells you which documents exist in your subject and what they contain:

> "Which documents exist in this subject, and what does each one cover?"

!!! info "Curators only"
    Creating and editing a document requires the **curator** role. As with the curriculum, everything goes through the **draft**.

## What a document is made of

| Part | What it says | How you get it |
|---|---|---|
| **What it covers** | Which part of the curriculum it presents (a course, a grouping, a lesson) | When the document is created |
| **Its sections** | Its pages or parts, each with what it covers | One at a time, or in a batch |
| **Its formatter** | How it looks, its languages, the geometry of its pages | From the catalog ([Formatters](formatters.md)) |
| **Its grids** | The criteria that decide whether it is good | From the catalog ([Evaluate a document](evaluate.md)) |
| **Its journal** | The dated record of its decisions | As the work goes along |

## 1. Create the document

You create a document in one sentence, by saying **what it covers**:

> "Create a workbook that covers the course for this subject."
>
> "Create a revision sheet for the 'Decimal numbers' grouping."

!!! warning "A document that covers nothing goes unnoticed"
    A document attached to nothing raises **no error at all**: it just produces an empty file, and you find out at the very end. That is why creating it and attaching it happen **in a single step**, and why the checks always flag it.

## 2. Split it into sections

**Sections** are the real unit of work: a document is produced **section by section**. Each one says what it covers, and they can nest (a part holds chapters, which hold pages).

> "Add a section to this document for each lesson in the 'Decimal numbers' grouping."
>
> "Add a cover page at the start."

A cover page, a table of contents or an introduction page are sections **that cover nothing**, and that is fine.

A section can carry an **assembly guide**, which describes how the page is put together: what comes first, what is printed for the teacher, what stays as a comment. What the page has to **say** stays in the curriculum; the section only says **how to lay it out**.

## 3. Choose its formatter

> "Which formatters does the catalog offer for this kind of document?"
>
> "Apply the 'Workbook' formatter to this document."

The formatter decides how the document looks and which **languages** it comes out in. Without its **page settings**, the document cannot be produced: the tool refuses rather than put out an unstyled file. See [Formatters](formatters.md).

## 4. Attach its grids

> "Attach the approval grid to this document."

A document can carry several. See [Evaluate a document](evaluate.md).

## 5. Illustrations

A picture is part of the curriculum just as much as a piece of text. It is **attached to the lesson or activity it illustrates**, with a sentence saying **what it shows**. Any section that covers that activity sees the picture and can place it.

> "Attach the picture 'band-1' to the activity 'Compare the collections': it shows three baskets of fruit, and the one in the middle holds the most."

- The file has to be **uploaded** first: Claude gives you the upload address, or does it for you. A picture the graph points to but that does not exist would never print, so the attachment is refused until the file is there.
- The "what it shows" sentence is not decoration. Read alongside the activity's instruction and answer, it is what lets you catch a picture that contradicts its own words.
- Attaching a picture changes the **draft**: it is reviewed, undone and published along with everything else. A new version of a picture is a new file, which you attach in turn before removing the old one.

With the authoring plugin, Claude can also **draw** a lesson's pictures ("Prepare the illustrations for lesson 12"). It checks the picture it gets back, not just the request it made, and it **never redraws** an existing picture without your explicit agreement. The drawing style comes from the document's formatter.

## 6. Keep the journal

Every document and every section keeps a **journal**: dated, signed entries that say **why** a decision was made, what was measured, and what is waiting for an expert's opinion.

> "Note in the document's journal: we removed the examples page because it pushed every lesson onto a third page."
>
> "Why is this section put together this way?"

The journal is never printed. It is there for whoever picks up the document six months from now. Two people can write in it at the same time without overwriting each other.

## 7. Check that it is ready

> "Is this document ready to be produced?"

Claude answers with **a single report**: does the document cover something, does it have sections, a formatter with its page settings, page templates, a grid, a routine? Every gap comes with what you need to do to fill it. The report blocks nothing: producing without a grid, for instance, is still your call.

## Start from an existing document

- **A document in the graph serves as a model.** "Create a workbook for the next course, built like this one." Claude reads the model's structure and rebuilds it on the new coverage.
- **An outside file**: a mock-up, an old guide, another country's workbook. Give it to Claude: it proposes the parts, the sections and what each one covers, and you approve them before anything is written.

Once it is composed, the document can be produced: see [Produce a document](create-materials.md).
