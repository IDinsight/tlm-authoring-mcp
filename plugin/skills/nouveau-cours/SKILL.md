---
name: nouveau-cours
description: Construire un cours à partir de rien, dans l'ordre qui garde le graphe cohérent à chaque étape — racine du cours, colonne vertébrale des standards, routines venues du catalogue, document, formatter, sections. À utiliser au démarrage d'une nouvelle matière, d'un nouveau niveau ou d'un nouveau cours, ou quand on dit « partir de zéro », « créer un nouveau cours », « monter un nouveau programme ».
---

# Building a course from nothing

The order matters. Each step attaches to something the previous step created, and a step taken out
of order leaves elements the next read cannot reach.

## Before anything

Read **`get_graph_guide`**. A new course still belongs to a subject with conventions, and this is
where they are. If the subject is genuinely new, say so — the guide is authored data, and starting a
course without one means the conventions exist nowhere and the next author will invent their own.

Then **`namespace_stats`** to see what is already there. "From nothing" is usually "from less than I
expected", and a standards spine often already exists.

## The order

1. **Course root** — `add_nodes` with `kind:'Course'` and no parent. Everything hangs off it.
2. **Standards spine** — the objectives the course teaches, as a `StandardsFrameworkItem`
   hierarchy. This comes from the curriculum authority, not from you. If it is already imported,
   walk it and use it rather than creating a second one.
3. **Routines from the catalog** — `list_catalog` (it defaults to names; add `kind:'routine'` to
   narrow), then `get_catalog_entry` for the full spec of the ones that look right.
   **Prefer an existing routine.** Nobody authors a session structure from a blank page — start from
   the one that is nearly right and adapt it. `use_routine` copies it in; the copy is independent, so
   later changes to the library do not reach it.
4. **The document** — `create_document`, giving the name and what it `covers` **by name**. It mints
   the document and its coverage link together. Do not build it from `add_nodes` + `create_edges`:
   a document without its coverage link is a valid write and a broken document that generates empty.
5. **A formatter** — `use_formatter` from the catalog, or `duplicate_entry` to adapt one. A document
   with no formatter is one of the things `check_draft` reports, and generation has nothing to lay
   the page out with.
6. **Sections** — `add_section` per slot, each naming what it covers. Sections nest, so a part can
   hold chapters that hold lesson sheets. Front matter — a cover, a table of contents — is a section
   with no coverage, deliberately.

## Check before you go further

Run **`check_draft`** once the document has sections. It catches exactly the failures this sequence
is designed to avoid, and catching them at six sections is cheaper than at sixty.

## Work in batches, but keep each batch coherent

`add_nodes` and `create_edges` each take many items in one atomic call — use that. But a node minted
in a batch cannot be another item's parent in the same batch, so build **one level at a time**: the
groupings, confirm, then their children.

Each confirmed call should leave the graph in a state someone else could pick up.
