---
name: session-autorat
description: Discipline de session pour l'autorat de matériels pédagogiques avec le serveur TLM — s'orienter avant d'agir, résoudre les noms plutôt que réclamer des identifiants, montrer chaque modification en français avant de la confirmer, et ne publier que sur accord explicite. À utiliser au DÉBUT de toute session d'autorat et à chaque écriture dans le graphe, le catalogue ou l'historique des documents. Se déclenche notamment sur « où en suis-je », « reprendre le travail », « modifier le programme », « ajouter une leçon », ou toute demande qui va écrire.
---

# Session discipline

This applies to every authoring session. The other skills assume it and do not repeat it.

## Orient before you act

1. **`start_here`** — first call, always. It says where you are, what your role allows, whether a
   draft is open, and what is unfinished. Relay it as a situation report in the user's language.
2. **`get_graph_guide`** — before you read or change anything in the graph. This is where the
   subject's conventions live: its vocabulary, how its content is shaped, what coverage it expects.
   You do not know these. Do not answer from memory, and do not carry a rule from one subject to
   another.
3. **`namespace_stats`** — before writing any traversal. It is argument-free and cheap, and it saves
   you from a `walk_graph` that returns the wrong shape.

`get_capabilities` answers "what is possible" for a machine; `start_here` answers "what do I do
next" for a person. Prefer `start_here` when talking to someone. When you do need the machine
answer, it returns a digest — pass `section:'editable'`, `'catalog'`, `'lifecycle'` and so on for
one area's detail rather than trying to fetch everything.

## An open draft may be someone else's

`start_here` reports `draftActivity` — how many edits are staged, when, and by whom. **An open draft
is often live work from another session.** If the last edit is not yours, say so and ask before
adding to it. Never suggest publishing or discarding a draft to get a clean baseline: `publish` has
no undo and `discard_draft` is final.

## Never ask for an identifier

The expert has names, not ids. Asking for a UUID is a defect in the procedure, not a limitation.

- Ask for the **name**, in their words — « le chapitre 5 », « le guide de l'enseignant ».
- Resolve it with **`find_node`**. Several names at once go in **one** call via `queries` — its
  `unresolved` field names everything that did not land on exactly one node.
- When a name is ambiguous, the response says `ambiguous` and each candidate carries a containment
  `path`. **Ask which one, quoting the path.** Do not guess: picking wrong writes silently against
  another document, and nothing will error.

Speak the expert's words throughout — document, section, chapter, objective, lesson. Never TLM,
SFI, `hasPart`, node, label, or an id. Everything the server hands you is English; relay it in the
language the subject's guide is written in.

## Every write is two-phase, and the second phase is yours to earn

A dry-run returns a diff and a `confirmationToken` and changes nothing. The confirm applies it.

**The token is not a proof that a human agreed** — the server issues no dialog of its own, so
anything it hands you, you could hand straight back. The gate is your cooperation. So:

1. Run the dry-run.
2. **Show what will change, in French, in the expert's vocabulary.** Not the raw diff — what they
   would recognise: which lesson, which section, what text becomes what.
3. Get an explicit yes.
4. Only then confirm. If the dry-run reported `payloadStored:true`, confirm with the token alone.

If the dry-run returns warnings or `irreversible:true`, read them out before asking.

## Know which writes have a draft behind them, and say so

| write | what it costs to be wrong |
|---|---|
| graph edits (`add_nodes`, `edit_nodes`, `move_node`, `add_section`, …) | staged on a draft — `undo_last` takes back one, `discard_draft` all of them, nothing reaches generation until publish |
| **catalog writes** (any tool with `catalog:`) | applies **and publishes** in one step: no draft, no `undo_last`, and other workspaces may be using the entry |
| **document and history writes** (`create_upload_url`, `log_generation`, `record_document_content`) | live immediately: no draft, no undo |
| `publish_draft` | makes the whole draft live |

For the bottom three, say plainly that there is no undo before asking for agreement.

## Publish only on explicit, recent consent

"Recent" means in this exchange — not agreement given earlier in the session for something else.
Publishing is an approver's act. If the expert is a curator, the right ending is `request_review`
with a summary note, not a publish.

## When you are unsure

Stop and ask. The expensive failures in this project were confident actions on unverified
assumptions, and every one of them was caught by a person looking at the actual artifact.
