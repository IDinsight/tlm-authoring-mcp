# Formatters

A **formatter** decides **how a document looks**: page size, margins, fonts, colours, picture style, output languages. You write it once and apply it to as many documents as you like, so that they all look alike.

## Who decides what on a page

Producing a page is split into two halves, and the formatter only handles one of them.

| Who | Decides | Example |
|---|---|---|
| **The assistant**, working from the curriculum and the section's assembly guide | **What goes on the page**, and in what order | "first the lesson title, then the picture band, then the three exercises" |
| **The formatter** | **What it looks like** | "a title is 16 pt bold, a picture band spans the full width" |

The server puts the two together and builds the Word file (or the InDesign file, see [below](#producing-for-indesign-too)). So the assistant never picks a colour or a size. It names a **style** ("lesson title", "instruction"), and the formatter says what that style means.

## The three parts of a formatter

1. **Written guidance.** Text the assistant reads before composing: the tone, what gets printed for the pupil and for the teacher, the illustration style, what to avoid.
2. **Page settings.** Exact values the server applies itself: page size and margins, text styles and characters per line, maximum picture size, target page count, and the **languages** to produce. Without these settings a document **cannot be produced**: the tool refuses rather than put out an unstyled file.
3. **Page templates** (optional). When every page of a document follows the same structure, you can write that structure once as a template: "at the top, the lesson number and title; then the picture for activity 1; then its instruction…". The server then fills each page **straight from the curriculum**, identically every time, with no need for the assistant to recompose it. Anything no template covers goes back to the assistant, who composes it by hand.

    A template can also have the server print the section's **assembly guide**. The formatter then says which lines of the guide get printed and in what voice, what the stock phrases are called and what they say, and how a picture is named. The server prints those lines itself and reports, section by section, what it printed, what it kept as commentary and what it could not resolve.

!!! example "Why templates matter"
    Without a template, the assistant recomposes each page from the guidance, so two productions of the same lesson may come out slightly different. With a template, an instruction or a picture cannot be copied out wrong: it is **copied** from the curriculum, not rewritten.

## Formatters stack

A document can carry several formatters. A general one sets the common tone (the house style); a more specific one adds the rules for this particular document; a section can carry one of its own on top. When two of them disagree, **the one closest** to the page wins.

> "Which formatters apply to this section, and which one sets the size of the titles?"

## Browse the catalog

Formatters live in the same [catalog](routines.md#the-catalog) as routines and grids.

> "Which formatters does the catalog offer?"
>
> "Show me the details of the 'House style' formatter."

## Apply a formatter to a document

A formatter is applied **to a document**, not to the curriculum: how something looks belongs to what you print, not to what you teach.

> "Apply the 'House style' formatter to this document."

As with a routine, this puts an **independent copy** under the document. Editing that copy changes only this document, and a later edit to the catalog entry does not reach it.

## Create or edit a formatter

**Starting from an existing formatter** is almost always the easiest route:

> "Duplicate the 'House style' formatter under the name 'Revision sheet style'."
>
> "In my copy, set the body text to 12 pt."

**To fix the formatter of a single document**, edit its copy, in the draft.

> "In this document's formatter, reduce the margins to 1.5 cm."

**To offer a formatter to others**: a formatter written for one document can be **filed into the catalog**, so that other documents can apply it.

> "File this document's formatter into the workspace library."

**To fix it for everyone**, write to the catalog. That write **is published at once**, with no draft and no undo, because other people rely on a library. Read the preview before you confirm.

!!! tip "The guidance and the settings must say the same thing"
    If the prose says "12 pt text" and the settings say 11, the tool flags it during review. Keep the two in agreement: the prose explains, the settings are what gets applied.

!!! info "Who can change what"
    - **Applying** a formatter, or **editing a document's copy**: a **curator** (draft).
    - **Creating, duplicating or editing** an entry in the workspace catalog: an **approver** (published at once).
    - A **shared** entry: the **super administrator** only. To adapt one, duplicate it.

## Producing for InDesign too

Some documents are laid out by a designer in **Adobe InDesign** rather than printed from Word. The tool can then write each page straight into **the designer's InDesign template**: the content arrives in the template's own styles, colours and master pages. The designer only has to finish the page and export the print PDF; nothing needs retyping or pasting by hand any more.

That takes two things.

1. **The InDesign template**, prepared by the designer: named styles (for paragraphs, tables and pictures) and a model page, with a main text frame the content flows into and, if needed, named frames for the number or the title. The template and the fonts that go with it are **uploaded** to the workspace's document store, just like a picture: the assistant gives you the upload address. Only include fonts whose licence allows it.
2. **An InDesign-only formatter** that names this template and its fonts. Marked "for InDesign only", it counts **only** when you produce for InDesign, and it then applies **last**: its settings win over every other formatter's. So one document can take two pages per lesson in Word and a single page in InDesign, and the Word book does not move when you adjust the InDesign one.

The template can carry **one set of styles per major part of the curriculum** (one colour per domain, for example). The formatter then says how to pick the set from what the section covers.

!!! warning "A style the template does not know is a refusal"
    If the page uses a style the InDesign template does not define, nothing is produced, and the tool names every missing style. Add them to the template, or correct the formatter, and try again.

Production itself is described in [Produce a document](create-materials.md#producing-for-indesign).
