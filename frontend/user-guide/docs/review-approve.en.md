# Review, publish or discard a draft

Once a curator has prepared changes, they wait in a **draft**. The **approver's** job is to **review** them and then **publish** them — publishing is what makes them official and visible to document generation. If they should not be kept, you **discard** the draft.

!!! info "Approvers only"
    Only **approvers** can publish. Curators prepare; approvers approve.

## 1. Review the draft

> "Show me the pending changes for this subject."

Claude shows the full list of changes — everything that will become official on publish: edited titles, added or moved lessons, new chapters, and so on.

Then ask for the two checks, which answer two different questions:

> "Check the draft before I publish."

- **The wiring** — what is connected to nothing: a document attached to no content (it would be produced **empty**), a section belonging to no document, a routine nobody uses, an isolated element. This is mechanical and the same for every subject; each point comes with what to do about it.
- **The coverage** — does what has been written actually cover what the curriculum expects? That is a judgement, made against the expectations written in the subject's guide.

Both are **warnings**, never blocks: the decision is yours. But a document "attached to nothing" almost always deserves a fix before publishing — it is the quietest failure in the system, since generation would simply produce an empty document with no error at all.

<!-- SCREENSHOT: full draft view (diff) -->

## 2. Publish

> "Publish the draft."

Publishing happens in **two steps**, like the other important actions:

1. Claude shows you a final summary of what will become official.
2. You **confirm** → everything is published **at once** (atomically). From then on, document generation uses the new version.

!!! warning "Publishing makes changes official"
    Once published, the updated curriculum feeds material production. Review before you confirm.

## Approving your own changes

By default an approver **may** publish a draft they edited themselves. Depending on the project's configuration, a **second review** may be required. Either way, the publish record shows whether the person who made the changes is also the one who published — for transparency.

## Take back a single change

A mistake in the **last** change does not mean throwing everything away:

> "Undo the last change."

Claude first tells you **which** change it is about to take back (what, when, by whom), you confirm, and that one change leaves the draft — **the others stay**. Ask again and the change before it goes: you walk back up the thread one change at a time.

Two deliberate limits:

- You can only walk back within the **current draft**. Anything already published cannot be undone this way: it takes a new change, itself reviewed and published.
- If a more recent change touched the **same element**, Claude **refuses** and says which one, rather than patching together a mixture of the two. Take back the more recent one first.

## Discard a draft

If a draft should not go out:

> "Discard the draft."

The official version stays **unchanged**. (Both curators and approvers can discard.)

## Check the history

Every action (edit, publish, discard, refusal) is recorded in a **log**. To review it:

> "Show me the history of recent changes."
>
> "Who published last, and when?"

!!! note "Read-only log"
    The log is viewable by approvers. It cannot be edited or erased — that's what guarantees a reliable trail.
