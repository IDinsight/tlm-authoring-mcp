# Generate teaching materials

You can generate **any document the graph defines** — a whole **course**, or just a part of one (a chapter, a lesson). What you produce is not a fixed list of templates: it all depends on what has been built in the curriculum, formatters included.

## What you can produce depends on the graph

A **course** is the root of a document. Several courses can coexist in one subject, and more can be created by a designer (see [Add and edit a course and its lessons](courses-lessons.md)).

!!! example "Example: CI mathematics"
    In CI mathematics, two courses coexist today: the **pupil manual** and the **teacher's guide** (the lesson sheets). These are not document types hard-wired into the tool — they are two courses *in the graph*. Create a third, and it becomes generatable just the same.

You can generate a course **in full** or only **a part**: a chapter, a lesson, a range of lessons.

## What generation draws on

When you ask for a document, Claude does not start from a blank page: it builds on what has been prepared in the graph.

- The **lesson structure** comes from the [instructional routines](routines.md) applied to each lesson.
- The **layout** comes from the [formatter](formatters.md) applied to the course — palette, typography, page setup, illustration style.
- The **content** and the **objectives to cover** come from the [standards](build-standards.md) and their alignments.

In other words: what comes out — both substance *and* form — is decided by the graph. The better the curriculum is prepared, the better and more consistent the produced document.

The tool also keeps documents **consistent** (same characters, same terminology, notion coverage) and **varied** where it matters (the example domains — fruits, vegetables… — rotate from one chapter to the next).

## How it works

1. **Pick the workspace, grade and subject** (see [Getting started](getting-started.md)).
2. **Ask for what you want to generate** — a whole course, or a specific part:

    > "Generate the pupil manual."
    >
    > "Generate chapter 5 of the pupil manual."
    >
    > "Prepare the sheets for the lesson 'Compare two numbers'."

3. **Claude prepares the context** automatically: the relevant part of the graph, the routines and formatter attached, the characters already used, terminology, the notions to cover, and a suggested example domain that doesn't repeat neighbouring chapters.
4. **Claude drafts the document.**
5. **You approve saving it.** Before the document is saved, a **confirmation request** appears. Nothing is saved until you accept.

<!-- SCREENSHOT: save-confirmation dialog -->

## The save confirmation

!!! warning "Immediate write — no draft"
    Saving a document writes **directly** to the shared space: it is **immediate, with no undo**. The confirmation request states exactly what will be written. Read it, then accept or decline.

    (This is different from curriculum edits, which go through a draft first — see [Review, publish or discard a draft](review-approve.md).)

## Tips

- **Say what you want to generate**: the whole course, a chapter, a lesson. If you don't know what exists, ask "which courses and chapters exist?".
- **Some documents build on others.** For example, lesson sheets build on the manual: if you're preparing both, do the manual first.
- **Check example variety.** To see which example domains have already been used:

    > "Which example domains were used in recent chapters?"

- **Preview a draft before publishing.** If you are testing a curriculum change, you can see the document it would produce **without publishing anything** — see [Preview before publishing](courses-lessons.md).

## Pictures

A picture is part of the material the way a text is: it is **attached to the lesson or activity it illustrates**, with one sentence saying **what it shows**. That sentence, read beside the activity's text, is what catches a picture that contradicts its words — two wrong answer keys went to print that way.

> "Attach the picture “band-1” to the activity “Compare the necklaces”: it shows three shell necklaces, Binta's in the middle."

What happens then:

- Claude checks the file was really **uploaded** before attaching it — a picture the graph points at without the file existing would never print.
- Attaching is a **draft edit**: visible in review, undoable, published with everything else.
- Every section covering that activity **sees the picture** and can place it on the page.
- A picture **not drawn yet** is ordered the same way: "Commission the picture “band-2” for the activity …: it will show …". The graph knows it, the illustrator delivers by uploading the file to the announced path, and nothing else changes.
- The picture is **approved together with the draft** that attaches it, by the approver — like a text. A new version is a new file: attach it in turn and delete the old one ("Delete the picture “band-1”.").

Reviewing a composed page flags a placed picture attached to nothing, and an attached picture the page leaves out.

## Finding a document you already produced

> "List the documents for this course."

Claude tells you what already exists and can give you a download link.
