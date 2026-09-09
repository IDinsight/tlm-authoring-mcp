---
description: Qu'est-ce qui attend une décision humaine ?
---

Show me every open arbitration — the questions waiting on a human, not on a tool.

Gather them from all three places they live:

1. **`start_here`** — its `waitingOn` field, if a draft has been handed over for review.
2. **The graph itself.** Pending decisions are written into the authored guidance on documents and
   their sections, as lines marking something to confirm, to arbitrate, or to submit to a named
   person. Walk the documents I am working on and collect them — `walk_document` for the section
   spine, then read each section's own guidance. These are graph reads, so they run in the main
   thread (a subagent has no graph tools): use `detail:'skeleton'` to find the sections cheaply,
   then read in full only the guidance you must to pull the decisions out.
3. **The catalog** — entries whose text refers to something that does not exist, which is a decision
   waiting to be made about what should exist.

For each one tell me: what is being asked, where it is written, who it is waiting on if that is
named, and what is blocked until it is answered. Put the ones blocking other work first.

Change nothing. This is a read.
