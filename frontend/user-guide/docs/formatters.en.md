# Formatters

A **formatter** decides **how a document looks**: page size, margins, fonts, colours, picture style, output languages. You write it once and apply it to as many documents as you like, so that they all look alike.

## Who decides what on a page

Producing a page is split into two halves, and the formatter only handles one of them.

| Who | Decides | Example |
|---|---|---|
| **Claude**, working from the curriculum and the section's assembly guide | **What goes on the page**, and in what order | "first the lesson title, then the picture band, then the three exercises" |
| **The formatter** | **What it looks like** | "a title is 16 pt bold, a picture band spans the full width" |

The server puts the two together and builds the Word file. So Claude never picks a colour or a size. It names a **style** ("lesson title", "instruction"), and the formatter says what that style means.

## The three parts of a formatter

1. **Written guidance.** Text Claude reads before composing: the tone, what gets printed for the pupil and for the teacher, the illustration style, what to avoid.
2. **Page settings.** Exact values the server applies itself: page size and margins, text styles and characters per line, maximum picture size, target page count, and the **languages** to produce. Without these settings a document **cannot be produced**: the tool refuses rather than put out an unstyled file.
3. **Page templates** (optional). When every page of a document follows the same structure, you can write that structure once as a template: "at the top, the lesson number and title; then the picture for activity 1; then its instruction…". The server then fills each page **straight from the curriculum**, identically every time, with no need for Claude to recompose it. Anything no template covers goes back to Claude, who composes it by hand.

!!! example "Why templates matter"
    Without a template, Claude recomposes each page from the guidance, so two productions of the same lesson may come out slightly different. With a template, an instruction or a picture cannot be copied out wrong: it is **copied** from the curriculum, not rewritten.

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

**To fix it for everyone**, write to the catalog. That write **is published at once**, with no draft and no undo, because other people rely on a library. Read the preview before you confirm.

!!! tip "The guidance and the settings must say the same thing"
    If the prose says "12 pt text" and the settings say 11, the tool flags it during review. Keep the two in agreement: the prose explains, the settings are what gets applied.

!!! info "Who can change what"
    - **Applying** a formatter, or **editing a document's copy**: a **curator** (draft).
    - **Creating, duplicating or editing** an entry in the workspace catalog: an **approver** (published at once).
    - A **shared** entry: the **super administrator** only. To adapt one, duplicate it.
