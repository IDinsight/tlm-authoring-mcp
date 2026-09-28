# Review, publish or discard a draft

Every change to the curriculum (a lesson, a document, a section, an attached image, the subject guide) builds up in a **draft**. Until the draft is published, nothing in it reaches document production. The **curator** prepares the changes and flags when they are ready; the **approver** reviews them and **publishes**.

!!! info "One draft per subject"
    Each subject has only **one** open draft, shared by everyone working on it. If there is already one when you arrive, it is most likely a colleague's work: talk to them before you publish or discard it.

## 1. See what has changed

> "Show me the pending changes."

Claude lists everything that will become official when the draft is published: items added, changed and deleted, plus a change to the subject guide if there is one. To see it in the tree, open the **Draft** view in the [explorer](explorer.md#see-the-draft).

## 2. Run the checks

> "Check the draft before publishing."

There are three checks, and each one answers a different question:

| Check | The question | Example finding |
|---|---|---|
| **Wiring** | Is anything connected to nothing? | A document that covers nothing (it would come out empty), a section that sits outside any document, a routine nobody uses |
| **Coverage** | Does what has been written cover what the curriculum expects? | An objective that no lesson teaches. Claude judges this from the expectations written in the **subject guide** |
| **Consistency** | Do two things that are written contradict each other? | A routine whose total duration is not the sum of its steps, a grid whose weights do not add up to 100%, a cited item that does not exist |

These are **findings**, never blocks: the decision is yours. Still, a document "connected to nothing" almost always needs fixing before you publish.

With the authoring plugin, `/evaluer` runs all of these checks in one pass (along with a document's own checks; see [Evaluate a document](evaluate.md)).

!!! tip "Silence a warning you meant to trigger"
    If a warning is deliberate, because a rule does not apply to one particular item, ask Claude to **silence it on that item**. It will not come back there, and it still applies everywhere else.

## 3. Flag that it is ready

When you have finished, say so, and add a note:

> "Mark the draft as ready for review. Note: lessons 1 to 6 are done, lesson 7 is still waiting for its images."

The note is the message you would otherwise have written by hand. The approver sees it when they ask "where do things stand?".

!!! warning "Nobody is notified automatically"
    No email, no notification. **Tell the approver** yourself.

To go back to work: "Actually, I still have corrections to make. Withdraw the review request." The draft itself is left alone; only the request goes. It also disappears on its own once the draft is published or discarded.

## 4. Publish

> "Publish the draft."

1. Claude shows one last summary of what is about to become official, together with the findings from the checks.
2. You **confirm**, and everything is published **in one go**. Document production switches to the new version straight away.

By default, an approver can publish a draft they edited themselves; the history then records it as such. The server can also be set up to forbid this, in which case a second approver has to publish.

!!! warning "Publishing makes the changes official"
    Once published, the updated curriculum feeds everything that gets produced. Files already produced from the old version will show up as **stale** (see [Produce a document](create-materials.md#only-redo-what-has-changed)).

## Undo the last change

> "Undo the last change."

Claude first tells you **which** change it is about to undo: what it was, when, and who made it. You confirm, and only that one leaves the draft; the others stay. Ask again and the one before it goes.

There are two limits, both deliberate:

- you can only go back within the **current draft**. Anything already published is corrected with a new change;
- if a more recent change touched **the same item**, Claude refuses and tells you which item, rather than mixing the two changes together.

!!! danger "The catalog does not go through the draft"
    A write to the **catalog** (the library's routines, formatters and evaluation grids) is published immediately, with no draft, and cannot be undone this way. Deleting a catalog entry is permanent: it requires the admin role, and the history keeps a full copy of what was deleted.

## Discard a draft

> "Discard the draft."

All the work in progress is thrown away, and the official version stays as it was. Both curators and approvers can do this, once they have confirmed.

## Edit the subject guide

The **subject guide** holds the conventions and expectations Claude reads before it writes anything. You edit it like everything else, in the draft:

> "In the subject guide, add that instructions are always written in the imperative."

The change appears in the draft's summary and is published along with it.

## View the history

Every action (an edit, a publish, a discard, a refusal, a role being granted) is recorded in a **history** that nobody can change or erase.

> "Who published last, and when?"
>
> "What changed on this lesson this month?"

**Approvers** can look through the history.
