# Understand the graph

The **knowledge graph** is the curriculum laid out as a network: what pupils must learn, what teaches it, and the links between the two. Everything the tool produces comes out of it. This page explains what the graph is made of and how it comes into being; the pages that follow show how to fill it.

## Two layers, stitched together

- **The standards** say *what the pupil must master*. They are the backbone: broad sets, then precise objectives inside them, then **learning components** that break each objective down. This layer rarely changes.
- **The content** says *what teaches those standards*: a course, its groupings (chapters, units, weeks…), its lessons, and the activities in each lesson. This is the layer you write and keep developing.

Each lesson is **aligned** to the standard it teaches. That thread is what lets you answer "which objective does this lesson teach?" and "which objectives are not taught anywhere?".

!!! example "An example"
    A standard says: "The pupil can compare two numbers up to 20."
    A lesson called *"Bigger, smaller"* is aligned to this standard: it is the lesson that teaches it. Its activities are the exercises the pupil will do.

## A third layer: documents

The curriculum is not a book. A **document** — a pupil book, a teacher's guide, a lesson sheet — is a separate element of the graph. It **covers** part of the curriculum and says **how to present it**. One curriculum can feed several documents: the pupil book and the teacher's guide cover the same lessons, each in its own way.

The rule that holds it all together: **the curriculum carries the words, the document carries the page.** The text of an exercise lives on the activity, in the curriculum. The document only says where and how that exercise is placed. So you correct an instruction once, in the curriculum, and every document that covers it picks up the fix.

Documents are described in [Compose a document](compose-document.md).

## Your curriculum's own words

The tool imposes no vocabulary. One curriculum calls its groupings "chapters", another calls them "units" or "weeks". One names its standards "domain" and "specific objective", another "theme" and "competency". These names are written **in the elements of the graph**, and they are the names Claude uses when it talks to you.

The **subject guide** fills in the rest of the picture. It describes, in prose, the subject's conventions and what the curriculum must cover. The experts write it, and it is edited like everything else (see [Review and publish](review-approve.md)).

> "Read me the guide for this subject."

## How a graph comes into being

**It starts with an import.** When a new subject arrives, a developer **imports** its starting backbone — at the very least the standards framework — from a file. This step does not happen through the conversation; it is described in [Administration](admin-developer.md).

**After that, everything is built through conversation.** Standards, components, courses, groupings, lessons, activities: you create and correct them with Claude. A **new course** can even start from nothing in the conversation. Only the root of the standards depends on the import.

You can also start **from an existing document** — a teaching plan, an old guide, another country's curriculum. Claude reads it and proposes a structure to create, which you approve before anything is written.

> "Here is our annual teaching plan as a PDF: suggest the lessons I should create."

## Get your bearings before you build

> "Give me an overview of this subject."

Claude gives you the big picture: how many standards, courses, lessons and documents there are, and whether a draft is open.

> "Show me the structure of the course, without the full text."

Claude walks the graph from that point and lists its skeleton for you. For a visual overview, open the [explorer](explorer.md).

!!! note "Nothing is official until it is published"
    Everything you create goes first into a **draft**, which document production cannot see until an approver publishes it. So you can build without risk. See [Review, publish or discard a draft](review-approve.md).
