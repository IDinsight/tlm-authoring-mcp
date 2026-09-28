# TLM user guide

This tool does two things: it **maintains a curriculum** (the "knowledge graph") and it **produces the documents that teach it** — pupil books, teacher's guides, lesson sheets, workbooks — as Word files ready to print.

It works the same way for every subject, every grade and every country. What sets two curricula apart is not in the tool. It is in their graph.

## What is specific to your curriculum lives in the graph

The tool knows nothing in advance about your subjects, your documents or your habits. Everything specific to a curriculum is **written into its graph** by its experts, which means you can read it back and correct it just by talking:

| What changes from one curriculum to another | Where it is written |
|---|---|
| The names of the levels (domain, theme, specific objective…) and of the groupings (chapter, unit, week…) | In the elements of the graph themselves |
| The documents you produce, and what each one covers | In the graph's **documents** |
| How a session unfolds | In the **instructional routines** |
| What a page looks like, which languages it comes out in | In the **formatters** |
| What makes a document good | In the **evaluation grids** |
| The subject's conventions, what the curriculum must cover | In the **subject guide** |
| How terms are expected to be translated | In the workspace **lexicon** |

So the examples in this guide are just that, **examples**: your curriculum may say "unit" where this guide says "chapter". To learn the conventions of the subject you are working on, ask Claude:

> "Read me the guide for this subject."

## Your working tools

- **The conversation with Claude.** Everything happens here, in everyday language. You say what you want — "add a lesson", "produce lesson 12", "is this document ready?" — and Claude calls the right tools. There are no commands to learn.
- **The authoring plugin** (the *tlm-autorat* plugin). It teaches Claude the right procedures: in what order to create a document, how to check a page before rendering it, when to stop and ask you. It is optional, but strongly recommended. See [Getting started](getting-started.md).
- **The explorer.** A **read-only** web page showing the published curriculum, its current draft and the catalog. You look at things there; you change nothing. See [Explore the graph](explorer.md).

## Who does what

What you can do depends on your **role in the workspace**.

| You are… | You want to… | Role |
|---|---|---|
| **Reader** | Look at a curriculum | no role needed |
| **Curriculum expert** | Write the standards, lessons and activities | curator |
| **Document designer** | Create documents, their sections and their formatters, and produce them | curator |
| **Approver** | Review the curators' work and **publish** it | approver |
| **Administrator** | Manage the members of a workspace | admin |

Not sure what your role is? Ask: "**What can I do?**"

## Where to start

1. [**Getting started**](getting-started.md) — get access, install the plugin, choose where you work.
2. **Build the curriculum** — [understand the graph](create-graph.md), [the standards](build-standards.md), [courses and lessons](courses-lessons.md), [routines](routines.md).
3. **Compose and produce** — [compose a document](compose-document.md), [its formatter](formatters.md), [produce it](create-materials.md).
4. **Evaluate and publish** — [evaluate a document](evaluate.md), [review and publish the draft](review-approve.md).
5. [**Explore the graph**](explorer.md), and the [**Reference**](reference.md) for vocabulary.

!!! note "Three safety rules"
    **Nothing is written without your agreement.** Before any change, Claude shows you what will change and waits for your "yes".

    **The curriculum goes through a draft.** Your changes pile up separately. They only reach document production once an approver **publishes** them.

    **You give names, never identifiers.** "Lesson 12", "the teacher's guide": Claude finds the element. If several share the same name, it asks you which one you mean.
