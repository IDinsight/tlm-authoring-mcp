# Produce a document

Producing means turning a document in the graph into a **Word file** (or an InDesign file, see [below](#producing-for-indesign)), section by section. Everything that decides the result is already in the graph: the curriculum supplies the words, the section says where to put them, and the formatter says what they look like. The better prepared the graph, the better and more consistent the file.

!!! info "Who can produce"
    Producing requires the **curator** role (or higher) in the workspace, because it reads the workspace's pictures and, where needed, translates. Before producing a document for the first time, ask "**Is this document ready to be produced?**" (see [Compose a document](compose-document.md#7-check-that-it-is-ready)).

## Ask for it

> "Produce the lesson 12 section of the workbook."
>
> "Produce all the files for lesson 12."
>
> "Produce the teacher's guide for the 'Decimal numbers' grouping."

The second request is the most common. A lesson owes **one file for each document that covers it**, multiplied by **the languages** each document's formatter declares. Claude makes them all and **skips the ones that are already up to date** (see below). With the authoring plugin, the `/lecon` command runs this procedure and ends with a **delivery note**: for each file, its pages, the font used, any overlaps and the findings of the checks.

## What happens, step by step

1. **Claude reads the section**: what it covers in the curriculum, the routine that applies, the formatter and its settings, the attached pictures. It also reads the **page's fixed numbers** — usable width, lines per page, the size each picture will take — so that it composes by arithmetic rather than by trial and error.
2. **The page is composed.** If the formatter carries **templates**, the server fills in what they cover straight from the curriculum. Claude composes the rest, working from the section's assembly guide.
3. **The page is checked against the graph, before anything is rendered.** For example:
    - a printed instruction that does not repeat the activity's instruction **word for word**;
    - a printed answer that does not match the answer recorded on the activity;
    - a line longer than its style allows;
    - more pictures than the formatter permits, or a placed picture that is attached to nothing.

    Each of these mistakes would give you a file **that is produced without an error and is still wrong**. That is why the check comes first.
4. **The server builds the file and measures it.** It counts pages on the file as actually laid out, never on an estimate, and flags any picture that overlaps text. It checks that the file really uses **the font the formatter declares**: with a substitute font, every count would be wrong. On request it also returns **a picture of each page**, so you can judge by eye what the numbers cannot tell you. If the page runs over, Claude tightens it and repeats steps 3 and 4.
5. **One version per language.** If the formatter declares several languages, the server produces the translation using the workspace's **lexicon**. Text an expert has already written in the target language is kept as it is: nothing an author wrote by hand is ever translated again.
6. **You approve the upload.** See below.

!!! tip "If Claude stops"
    A missing instruction, an absent picture, a check that cannot be run: Claude **stops and tells you** rather than making something up. The right fix is almost always to complete the graph (the instruction on the activity, the attached picture), not to correct the page.

## Upload: preview or deliverable

There are two destinations, and they never mix:

| | **Preview** | **Deliverable** |
|---|---|---|
| Where | A separate area, with a short-lived link | The workspace's official document store |
| Shown in the list of documents | No | Yes, with its history |
| Can be undone | Nothing to undo | **No**: the write happens at once |

!!! warning "A deliverable is written straight away"
    Uploading a deliverable has **no draft and no undo**. The confirmation request states exactly which file will be written, and **in which workspace**. Read it before you accept. Several files are confirmed in one go.

To try out the effect of an unpublished draft, ask for a **preview**: it is produced from the draft and never reaches the official store.

## Producing for InDesign

When the document carries an InDesign formatter (see [Formatters](formatters.md#producing-for-indesign-too)), you just ask for it:

> "Produce lesson 12 of the pupil book for InDesign."

The page is composed as for Word, from the same templates, taking the InDesign-only formatter into account. What comes back differs in three ways.

- **One package per language**, with a short-lived link: the InDesign file, its pictures in a folder beside it (linked, not embedded) and the fonts. You unzip it and open it in InDesign, wherever it is.
- **No page count.** Only InDesign lays out an InDesign file. Open it and look for the small **red +** that InDesign shows when text overflows its frame.
- **Corrections made in InDesign cannot be brought back yet.** Bringing back an expert's corrections (below) only reads Word files. Correct the words in the curriculum, then produce the page again.

The package is a **preview**, placed on the side as described above. The designer is the one who turns it into the print file.

## Only redo what has changed

Every file the tool produces keeps a record of the curriculum text it contains. So for each file, the tool can tell you whether it is **up to date**, **stale** (the curriculum has changed since) or **unknown** (produced some other way, so it keeps no such record).

> "Which files for lesson 12 are stale?"

A lesson can then be produced again by redoing only the stale or unknown files. You can always ask for everything to be redone.

## Find a produced document

> "List the documents produced for this course."
>
> "Give me the download link for the lesson 12 sheet."

A Word file placed in the document store **some other way than through the tool** (by hand, or by an older process) is attached to nothing. Claude can list these **untracked** files, read their text and attach each one to the part of the curriculum it covers. That attachment is written at once, like a deliverable.

> "Which files in the document store are not attached to anything?"

## Measure a file produced elsewhere

A file the tool produces already carries its measurement. For a Word file that came from somewhere else (corrected by hand, or made with another tool):

> "How many pages is this file, and does it run over?"

With the plugin, that is the `/mesurer` command.

## Bring back an expert's corrections

An expert opened a file, corrected some wording and sent it back to you. Those corrections have to go **into the curriculum**, or the next production will wipe them out.

> "Here is the sheet the inspector corrected: carry her corrections over into the curriculum."

Claude compares the file with the graph and **proposes** the changes; it writes nothing itself. There are three cases:

- **changed wording**: the correction is clear and can be applied;
- **a passage that has disappeared**: it is flagged, **not deleted**, because in a Word file a deliberate cut and a slip of the hand look the same;
- **an added passage**: it is flagged without being filed anywhere, because guessing where it belongs from its position is the surest way to put a sentence under the wrong lesson.

You approve the proposals, and they go into the draft like any other change. With the plugin: `/reprendre-corrections`. The comparison works best on a file the tool produced; a file made any other way is still read, but without a precise match to the graph.
