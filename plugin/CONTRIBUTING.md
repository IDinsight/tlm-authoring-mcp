# Contributing to tlm-autorat

## The one invariant

**A skill file may contain procedure. It may not contain a pedagogical rule.**

A rule copied into a skill file becomes a stale fourth copy of itself. On 1 September 2026 the same
five lessons were reauthored three times in one day as conventions were adopted, revoked and
restored — anything written down here would have been wrong twice that day and nobody would have
known.

So: how long a step lasts, how a lesson is structured, what a bullet may contain, which characters a
scene may use, how an answer is marked, which typeface is used — none of that is written here. It is
fetched at runtime from `get_graph_guide`, `list_catalog`, the document's formatter and its rubrics.

## The check

`./check-no-rules.sh` greps every skill and command for tokens that mark subject content. Any hit is
reviewed by a human, because the grep cannot tell a rule from an example — and the answer must be
that it is neither, because neither belongs in a procedure file.

Run it before opening a PR. It is fast and it has no dependencies.

## Writing a skill

- **Name the tool and the order.** That is what a procedure is.
- **Say what to check before confirming**, and what makes a write irreversible.
- **Say where a rule comes from**, never what the rule is.
- **Mark the seams.** Where a step needs something that does not exist yet, say so in the skill
  rather than pretending the loop closes.
- Keep it short. A skill nobody finishes reading is a skill nobody follows.
