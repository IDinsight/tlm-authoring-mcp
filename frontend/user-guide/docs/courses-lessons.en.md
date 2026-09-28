# Courses, groupings & lessons

This is where the curriculum's **content** gets written: a course, its groupings, its lessons and their activities. You create them, put them in order, and link them to the standards they teach. The documents that present them come afterwards (see [Compose a document](compose-document.md)).

!!! info "Curators only"
    These changes require the **curator** role and stay in **draft** until they are published.

## The content layer at a glance

```text
Course  →  Grouping(s)  →  Lesson  →  Activities
```

- The **course** is the root of a subject's content.
- A **grouping** gathers lessons together. Your curriculum calls it a chapter, unit, module, week or day, and it can nest several levels of them (a week that contains days, for example).
- The **lesson** is the unit of teaching. It is the lesson that you align to an objective.
- The **activities** are what the pupil does: each exercise, with its instruction, and its expected answer when it has one. An **assessment** (an end-of-unit review, a test) sits at the same level as a lesson.

!!! tip "The curriculum carries the words"
    The text of an exercise is written **on the activity**, not in a document. That is what lets every document reuse the same instruction word for word, and lets the tool spot a page that strays from it. A new question means a new activity here.

## Create

Describe what you want and where:

> "Add a grouping 'Decimals' at the end of the course."
>
> "Add a lesson 'Adding two decimals' to this grouping, aligned to the objective 'Add decimal numbers'."
>
> "In this lesson, add three activities: …"

You can describe everything at once. Claude prepares the whole set, shows the **preview**, and only writes after you agree. A new element takes the shape of similar elements already in the graph: a new lesson looks like the existing lessons, without you having to say so.

## Edit and reorganise

| You want to… | Say, for example… |
|---|---|
| Correct a title | "Rename this grouping to 'Decimal numbers'." |
| Rewrite an instruction | "Replace the instruction of the second activity with: …" |
| Move a lesson | "Move this lesson to the next grouping." |
| Reorder | "Put this lesson in first position." |
| Delete | "Delete this activity." |

Moving a lesson does not set off a chain of renumbering: belonging to a grouping is a link, not a fixed number. For a deletion, the preview shows everything that would go with the element.

For a series of corrections, give them all at once: "In lessons 3 to 8, replace 'work out' with 'calculate' in the instructions." Claude prepares a single grouped change, which you confirm in one go.

## Link a lesson to its objective

> "Align this lesson to the objective 'Compare two numbers up to 20'."
>
> "Which objective does this lesson teach?"

The details are in [Standards & components](build-standards.md#alignment-linking-a-lesson-to-its-objective).

## Give a lesson its flow: routines

An **instructional routine** is a reusable session plan. You apply it to a lesson, to an activity, or to the whole course so that it holds for every lesson in it:

> "Apply the 'Mental maths session' routine to this course."

Everything is explained in [Instructional routines](routines.md).

## See the result before publishing

> "Show me the pending changes."

Claude lists what will change when the draft is published. To see what your changes would produce in a document, without publishing anything:

> "Preview the section for lesson 12 from the draft."

The preview is **isolated**: it never appears in the official documents. Preview the smallest piece you changed — a section rather than a whole document. When everything looks right, see [Review, publish or discard a draft](review-approve.md).
