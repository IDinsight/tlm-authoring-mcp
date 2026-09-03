---
description: Take an expert's corrected document back into the graph
argument-hint: [document or lesson the expert corrected]
---

The expert has handed back corrections on: $ARGUMENTS

Follow the `reprendre-corrections` skill. In particular:

- work from the **PDF render**, not a Word conversion — ask me for the PDF if you only have a `.docx`;
- do the reading in the `lecteur` subagent;
- resolve every target by name in one `find_node` call;
- propose **one** batched `edit_nodes`;
- do not raise an objection you have not seen in the PDF yourself.

Show me the proposed changes in French, grouped by lesson, before touching anything.
