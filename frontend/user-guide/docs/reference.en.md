# Reference

## Who can do what

Roles are granted **per workspace**: you can be a curator in one workspace and have no role in another.

| Action | No role | Curator | Approver | Admin | Super-admin |
|---|:---:|:---:|:---:|:---:|:---:|
| Read and explore published curricula | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edit the curriculum and documents (draft) | — | ✅ | ✅ | ✅ | ✅ |
| Apply a routine, a formatter or an evaluation grid | — | ✅ | ✅ | ✅ | ✅ |
| Preview, produce and upload documents | — | ✅ | ✅ | ✅ | ✅ |
| See the draft in the explorer | — | ✅ | ✅ | ✅ | ✅ |
| Discard a draft | — | ✅ | ✅ | ✅ | ✅ |
| **Publish** a draft | — | — | ✅ | ✅ | ✅ |
| Write to the workspace's catalog and lexicon | — | — | ✅ | ✅ | ✅ |
| View the history | — | — | ✅ | ✅ | ✅ |
| Delete a catalog entry | — | — | — | ✅ | ✅ |
| Manage members, send invitations | — | — | — | ✅ | ✅ |
| Create a workspace, open it to a domain, write to the shared library | — | — | — | — | ✅ |

To find out your role, ask: "**What can I do?**"

## Three ways a write takes effect

Nothing is written without your confirmation. What happens after that, though, depends on what you are changing:

| You are changing… | Effect | Safety net |
|---|---|---|
| **The curriculum or a document** (lessons, sections, images, the subject guide…) | Goes into the **draft** | Nothing is official until it is **published**. The last change can be undone. |
| **The catalog or the lexicon** | **Published immediately** | The preview you see before confirming. No undo. |
| **A delivered file, a member** | **Written immediately** | The confirmation names the file or the person, and the workspace. No undo. |

## Short glossary

| Term | Meaning |
|---|---|
| **Workspace** | The container for a curriculum. It owns the curricula, the catalog, the lexicon and the produced documents, and it is where roles are granted. |
| **Grade / subject** | The scope you work in within a workspace. You work on one at a time. |
| **Knowledge graph** | The curriculum as a network: standards, content, documents, and the links between them. |
| **Standard** | What the pupil has to learn. Its levels carry whatever names your curriculum gives them. |
| **Objective** | A specific learning goal. It is what a lesson aligns to. |
| **Learning component** | A fine-grained skill that spells out part of an objective. |
| **Alignment** | The link saying that a lesson **teaches** an objective (or that an assessment **assesses** it). |
| **Course** | The root of a subject's content. |
| **Grouping** | A set of lessons: a chapter, unit, week, day… depending on your curriculum. |
| **Lesson** | The unit of teaching, aligned to an objective. |
| **Activity** | What the pupil does: an exercise, with its instructions and the expected answer. |
| **Document** | What gets produced: a book, a guide, a lesson sheet. It **covers** part of the curriculum. |
| **Section** | A page or part of a document, with what it covers and how it is put together. |
| **Assembly guide** | What a section says about how its page should be composed. |
| **Journal** | The dated record of the decisions made about a document or a section. It is never printed. |
| **Instructional routine** | A reusable plan for how a session unfolds. Applies to a course, a lesson or an activity. |
| **Formatter** | How a document looks: instructions, page settings, templates, languages. Applies to a document. |
| **Page template** | A page structure written once, which the server fills in from the curriculum. |
| **Evaluation grid** | The criteria used to judge a produced document. Applies to a document. |
| **Catalog** | The library of routines, formatters and evaluation grids: one shelf per workspace, plus a shared one. |
| **Lexicon** | The workspace's terms in each of its languages. It guides translation. |
| **Subject guide** | The subject's conventions and what the curriculum should cover, written as prose. Claude reads it before writing. |
| **Draft** | Changes that are waiting and not yet official. There is one per subject. |
| **Publish** | To make the draft official. Production then uses it. |
| **Preview** | A file produced on the side so you can look at it, without delivering anything. |
| **Deliverable** | A file placed in the official documents area. |
| **Stale** | Describes a file produced before a change to the part of the curriculum it covers. |
| **Authoring plugin** | The *tlm-autorat* plugin: the procedures Claude follows, and its commands. |
| **Explorer** | The read-only web page that shows the curriculum, its draft, the catalog and the lexicon. |

## Need help?

- An access or account problem → your workspace's **administrator**.
- To find out what you can do → "What can I do?"
- To see where things stand → "Where do things stand?"
- To learn your subject's conventions → "Read me this subject's guide."
- To add a subject or a workspace → [Administration](admin-developer.md).
