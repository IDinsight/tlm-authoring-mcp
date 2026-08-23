# Explore the graph

The **explorer** is a web page that lets you **view** the curriculum — domains, chapters, lessons and their links — without changing anything. It is a **read-only** view of the **published** (official) version.

Open the address your administrator gave you, then sign in (same credentials as the tool).

<!-- SCREENSHOT: explorer home page -->

## Pick a graph

At the top, a selector lists the available curricula (for example *Mathematics — CI*, *Reading — CE1*). Choose the one you want to explore. A curriculum appears automatically once it has been published.

## The two views

The explorer follows the **Learning Commons ontology**: it shows no subject-specific vocabulary, just the graph's structure as it is.

| View | What it shows |
|---|---|
| **Hierarchy (containment)** | The containment tree: from the standards framework down to its items, following the containment links |
| **By type (LC)** | All nodes grouped by their Learning Commons type, each with its links — the most complete view |

Click a node to open its **detail panel**; the small triangle **expands / collapses** its items.

## Colours and legend

Each node has a **colour** by its **Learning Commons type** (standards framework, framework item, lesson grouping, lesson, learning component, curriculum…). The **legend** shows the colour key.

## Search

Use the search bar to find a node by its title.

## Look at your draft before publishing

When a **draft** is open on a curriculum, two buttons appear above the tree: **Published** and **Draft**.

- **Published** — the official version, the one generation reads. This is the default view.
- **Draft** — the work in progress, **not published**. Every **added** or **changed** element carries a tag in the tree, and **removed** elements are listed above it (they are no longer in the tree, so that is the only place they can show). A counter recalls how many elements were added, changed and removed.

This is the answer to "what exactly am I about to publish?": you look at your own work in the same tree as always, instead of reading a summary.

!!! info "Curators only"
    Viewing the draft requires a **curator** role (or higher) in that workspace: a draft is work in progress, not a publication. If your role doesn't allow it, the explorer says so and stays on the published version.

!!! warning "A draft is still a draft"
    What you see here does **not** feed document generation until it is published (see [Review, publish or discard a draft](review-approve.md)). The explorer stays read-only: you look, you don't edit — edits happen by chatting with Claude.

## The catalog

The **Catalog** tab opens the libraries of reusable templates — your **workspace's** own and the **shared** one, common to every programme. Each entry appears as a card: its title, its kind, its summary, and what it is made of.

Three kinds of entry, told apart by their badge:

| Kind | What it describes | What the card counts |
|---|---|---|
| **Routine** | The teaching structure of a session | Its steps and materials |
| **Formatter** | How a document looks | Its formatting rules |
| **Rubric** | The criteria a document is judged by | Its scale (for example 0-4 or Yes/No), sections and criteria |

To find your way once a library grows:

- the **tabs** (All · Routines · Formatters · Rubrics) keep one kind at a time, each with its count;
- the **search box** filters on title and summary. Accents are ignored: typing `recitation` finds "poésie-récitation";
- the **library selector** narrows the view to the workspace or the shared shelf.

All three combine, and a counter shows how many entries remain out of the total. **Reset** clears them at once.

Click a card to read the entry's **full specification** — the instruction text generation actually reads.

!!! note "What the explorer shows"
    The explorer shows the **published** version only. A draft being edited does **not** appear here until it's published — by design, so it only ever shows the official version. To preview the effect of a draft, use the preview feature on the tool side.
