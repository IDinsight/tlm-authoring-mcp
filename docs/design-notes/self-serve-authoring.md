# Self-serve authoring — the expert without a developer

> **Status: Phases 1–3 BUILT (2026-08-23); phases 4–5 still proposed.**
> What shipped, and where it lives:
>
> - **Phase 1** — `?slot=draft` on the `/kg` routes with a curator gate + per-node
>   `chg` tags ([`kg-export.ts`](../../backend/src/kg-export.ts),
>   [`http.ts`](../../backend/src/http.ts)), the explorer's slot switch + change
>   badges ([`SlotSwitch.tsx`](../../frontend/explorer/src/components/SlotSwitch.tsx)),
>   and **`check_draft`** — the wiring lint ([`kg-store/lint.ts`](../../backend/src/kg-store/lint.ts),
>   [`server/check.ts`](../../backend/src/server/check.ts)), which also rides
>   `publish_draft`'s dry-run as `checks`.
> - **Phase 2** — Rung 1 as one shared guide composed into every subject's
>   ([`assets/AUTHORING_CONVERSATION.md`](../../backend/assets/AUTHORING_CONVERSATION.md));
>   Rung 2 as **`start_here`**, **`find_node`** + server-side name resolution
>   ([`curriculum/find.ts`](../../backend/src/curriculum/find.ts)), and `nextSteps`
>   on every write ([`server/next-steps.ts`](../../backend/src/server/next-steps.ts));
>   Rung 4 as four named French workflows ([`server/prompts.ts`](../../backend/src/server/prompts.ts)).
>   Rung 3 stays struck.
> - **Phase 3** — **`create_document`** / **`add_section`**
>   ([`kg-recipes/document.ts`](../../backend/src/kg-recipes/document.ts)) and
>   **`duplicate_entry`**; the build-then-clone catalog detour is retired in the tool
>   descriptions and the user guide.
> - **Risk 2** corrected in [`shared.ts`](../../backend/src/server/shared.ts) (the
>   comment no longer claims a gate that has never run). **Risk 3** closed: the
>   `KG_EXPLORER_PUBLIC` ungate is scoped to published reads and can never reach a draft.
>
> **One correction to the note itself.** It specifies French for `check_draft`,
> `start_here` and the prompts, because it was written from the Senegal pilot.
> But one deployment serves six workspaces and five of them (Nigeria, Ghana ×2,
> CBSE, Madhi, Rwanda) work in English — as do all eight subject guides, which are
> notes to the model. So every server-authored payload is **English**, and its
> `instruction` tells the model to relay it in the expert's working language,
> which the subject guide names. The exception is the Rung-4 **prompts**, which
> stay French: prompt text is not read by the model, it IS the user's first turn,
> and it cannot vary by tenant (prompts register before any workspace is known).
> French is right there today because all four workflows are about authoring
> documents and routines, and Senegal is the only workspace with a content layer
> to author.
>
> Still open: **phases 4 and 5** (`undo_last`, per-section `preview_generation`,
> `request_review`, the unfinished-work view), and **risk 7** — nobody has watched a
> real expert use any of this yet.
>
> The rest of this note is the original proposal, kept as the rationale. What has
> been **run to completion** is the client probe: a
> throwaway prompt, deployed in two versions and opened in the client the experts use,
> plus a `ping` that now reports what that client advertises. Four results:
>
> - **Prompts are surfaced and invokable.**
> - **Their content is acted on — but only in the expert's voice.** A version phrased as
>   orders to the assistant was refused as injection; the same prompt rephrased as the
>   user's own request was answered normally.
> - **Completions never render.** The argument is a plain text field, so node ids must be
>   resolved **server-side** from typed names.
> - **Elicitation is unavailable** (`Anthropic/ClaudeAI 1.0.0`, `supportsElicitation:
>   false`) — which also means the confirmation gate is weaker than the code claims. That
>   one is a **write-safety finding**, not a UX one; read risk 2 on its own.
>
> Net: Rungs 1, 2 and 4 are available, Rung 3 is struck, and D8 and D9 are rewritten.
>
> This note takes the authoring surface we have — generic LC verbs, a catalog,
> draft/publish, an audit trail, a French user guide — and asks what still stands between
> a subject expert and doing the work alone. It proposes five phases. It deliberately
> **re-opens a question that was settled once** (typed vs generic authoring tools,
> retired in [`typed-authoring-tools.md`](typed-authoring-tools.md)) and states the test
> that keeps Phase 3 from being that idea a second time.
>
> Scope: the **authoring** experience only. Ingestion, the store, and generation are
> out of scope except where they surface to the expert.

## The question this answers

The ingestion problem is solved: two Senegal graphs are live, the EIDU workspaces are
converging on a repeatable path, and a new subject is authored data rather than new
code ([`authorable-catalog.md`](authorable-catalog.md)). The next question is the one
that decides whether any of it is used:

> *Can a subject expert create a document, style it, attach a routine, and publish it —
> without a developer in the room?*

Today the honest answer is "with the guide open and someone on call". The gaps are not
in the documentation — [`frontend/user-guide`](../../frontend/user-guide) is already
French, plain-language, and written around what an expert would actually type. The gaps
are that **the system's verbs are the graph's verbs**. The expert says "I want a
revision sheet for chapter 5"; the surface offers "add a node, then create an edge".

The sharpest illustration is in our own tool description. [`use_formatter`](../../backend/src/server/catalog.ts)
tells its caller:

> *"If a Course has no TLM yet, mint one first: `add_nodes` a TeachingLearningMaterial +
> `create_edges` a `covers` edge to the Course."*

That is the data model explaining itself to the user's assistant, mid-task. And the
failure is silent: when the `covers` edge is forgotten, nothing errors — generation
simply reads an empty document, and the expert discovers it at the end.

## Where we already are (why most of this is cheap)

Six things are already true, and each removes most of the cost from a phase below:

- **Natural language is already the interface.** No syntax to teach; the guide is
  written as sentences to say, not commands to run.
- **Draft / publish / audit / roles already exist.** Safe experimentation is
  structurally in place — it is just not *visible* (Phase 1).
- **Elicitation is already wired.** `requireConfirmation`
  ([`shared.ts`](../../backend/src/server/shared.ts)) checks
  `getClientCapabilities().elicitation` and, when present, asks the **user** directly
  through a client dialog, falling back to the agent-mediated `confirm:true` two-step
  otherwise. **Measured 2026-08-23: the client reports `supportsElicitation: false`, so
  only the fallback has ever run.** The negotiation code is sound; the capability is
  simply not there (Phase 2, and risk 2 — this has consequences beyond UX).
- **`add_nodes` already takes a `catalog` argument**
  ([`authoring.ts`](../../backend/src/server/authoring.ts)). Authoring an entry
  **directly into a library** needs no new plumbing — only guidance that stops routing
  people through the curriculum graph first (Phase 3).
- **The draft is already a discrete changeset**, not a copy
  ([`canonical-changeset-store.md`](canonical-changeset-store.md)). A visual diff is a
  *read* of a list we already keep, not a graph comparison we have to compute.
- **Apply records carry their `GraphDiff` inline**
  ([`kg-store/types.ts`](../../backend/src/kg-store/types.ts)), and **`/kg` routes are
  already JWT-gated** (`requireJwt`, [`http.ts`](../../backend/src/http.ts)). Per-step
  undo is invertible in principle; a draft view needs a *role* check on top of an
  existing auth story, not a new one.

## Phase 1 — "I can see what I changed before I publish"

The trust foundation. Everything after this is easier once an expert can look at their
own draft.

| Item | What | Size |
|---|---|---|
| **Draft slot in the explorer** | Thread a `slot` param through the `/kg` export routes — both currently pin `pointer.publishedSlot` ([`kg-export.ts`](../../backend/src/kg-export.ts)) — and add a slot switch in the explorer. Gate `draft` behind a **curator+ role check** on top of the existing `requireJwt`. | Medium |
| **Visual diff** | Colour nodes by change: added / moved / edited / untouched, read straight off the draft's changeset overlay. | Medium |
| **`check_draft`** | A **structural** lint, reported in plain French: document with no formatter, section covering nothing, node orphaned from every containment tree, routine attached to no lesson. Runs on demand *and* inside the publish dry-run, as warnings. | Small–medium |

**Why this is first.** Publish is currently an act of faith: the expert reads a diff
narrated back to them in chat and presses the button. One bad publish teaches an expert
not to touch the system without a developer — which is precisely the outcome the whole
project is trying to avoid. Seeing your own work is the cheapest trust we can buy.

This extends, rather than duplicates, the **Documents view** already proposed in
[`teaching-learning-materials.md`](teaching-learning-materials.md): that note adds a
third *view* (rooted at TLMs); this adds a *slot* dimension to every view.

### The line `check_draft` must not cross

We **retired** coded coverage rules on purpose: coverage now lives as prose in the
subject guide and is checked on demand by `review_draft`
([`authorable-catalog.md`](authorable-catalog.md), increment 3). `check_draft` must not
resurrect them by the back door.

The line: **`check_draft` checks wiring, never pedagogy.** "This document has no
formatter attached" is wiring — true regardless of subject, mechanical failure mode.
"This chapter doesn't cover enough of the addition objective" is pedagogy — it belongs
in the guide's prose and in `review_draft`'s judgment. If a proposed rule needs to know
what the subject *teaches*, it is not a `check_draft` rule.

## Phase 2 — Guiding the expert through the connector itself

Today the connector exposes ~50 tools, **zero prompts**, and **one** resource
(`catalog://`). All the hand-holding lives outside the product, in the mkdocs guide —
so an expert must read documentation in one window and type into another. MCP has
purpose-built surfaces for exactly this, and we use almost none of them.

Four mechanisms, ordered by **how little they depend on the client**. The first two work
everywhere today; the last two are stronger but need a support check.

### Rung 1 — the guide's prose (zero plumbing, works today)

`get_graph_guide` already shapes how the model behaves for a subject. It carries
coverage expectations; nothing stops it from carrying **conversation scripts** —
"when the expert asks for a new document, ask these three questions in this order,
then propose the plan before writing anything" — plus the vocabulary rule (never say
TLM / SFI / `hasPart`; say *document*, *section*, *objective*).

This is an authored-data change with no code. It should ship immediately, independent
of every other item in this note.

### Rung 2 — tool-shaped guidance (works in every client)

- **A `start_here` tool.** One argument-free call answering *what can I do, and what is
  unfinished*, in French. `get_capabilities` answers "what is possible" for a machine;
  nothing answers "what should I do next" for a person.
- **`nextSteps` on write responses.** Every mutation already returns a diff envelope;
  adding a short, literal "what usually comes next" list ("apply a formatter, then
  preview, then publish") steers the model without the expert knowing a tool name.

Neither depends on client features. Both are small.

### Rung 3 — elicitation (measured: unavailable)

The idea was sound: ask the **user** directly, mid-tool-call, for the inputs a task
needs — a one-field dialog for the document's name, a single-select for the chapter it
covers — so the model cannot quietly fill in a plausible wrong value.

**It is not available.** `ping` now reports the connected client's advertised
capabilities, and a real session returns `Anthropic/ClaudeAI 1.0.0` with
`supportsElicitation: false`. `requireConfirmation`'s dialog branch has therefore never
run in production; every confirmation has gone through the agent-mediated fallback.

Rung 3 is struck. Its job — getting a trustworthy value from the expert — passes to the
server-side name resolution described under Rung 4's consequence.

### Rung 4 — MCP prompts (measured: available, with a writing rule)

Prompts are **user-controlled** by design: the spec's own illustration is a slash-command
menu, and the client surfaces them for a person to pick. That is precisely the missing
affordance — an expert opening the connector sees a menu of *named workflows*, not a
blank box:

- *Créer un nouveau document*
- *Appliquer un style à un document*
- *Créer une routine pédagogique*
- *Préparer une relecture*

A prompt returns a scripted opening turn (and may embed resources), so picking one drops
the expert into a conversation that already knows the sequence, the vocabulary, and the
guardrails. It is the mkdocs guide, moved inside the product.

**Completions are the sleeper feature.** The completion utility autocompletes *prompt
arguments and resource-template variables*, surfaced by clients as a dropdown. That is a
direct fix for the single most user-hostile thing in the whole surface: **node UUIDs**.
Instead of pasting `a3f2…`, the expert picks *"Chapitre 5 — Les nombres jusqu'à 20"*
from a filtered list, and the server resolves the id. Our data is already exactly the
shape a completion handler wants — a namespace, a label filter, a title match.

### What the probe actually found (2026-08-23)

We deployed one throwaway prompt with one completable argument and opened it in the
client the experts use. Three results, one of them uncomfortable:

- **Prompts are surfaced and invokable.** The prompt appeared, was selected by a human,
  and resolved with its argument substituted. The mechanism works end to end.
- **The resolved prompt arrives as an attached text file**, named after the prompt —
  not as an inline conversation turn.
- **Its content was read as data and deliberately not obeyed.** The assistant flagged
  the attachment as carrying instructions addressed to it, said it treats text inside
  uploaded files as data rather than commands, and declined to follow it.

That third result was **confounded by our own wording**: round one ended with *"Réponds
simplement : « … »"* — an imperative aimed at the assistant, the exact shape a
prompt-injection guard is built to catch. So we reworded the same prompt as the expert's
own request and redeployed.

**Round two passed, decisively.** Asked *"Je voudrais préparer une fiche de révision pour
le chapitre « … » — de quelles informations as-tu besoin, et quelles étapes suivrais-tu ?"*,
the assistant answered it as a normal request: it ran two read-only tools to orient
itself, listed exactly what it needed (context, the chapter's node identity, audience,
language, whether a new TLM is required), and laid out a read → propose → write-only-
after-approval plan. No injection flag, no refusal.

So the rule is sharper than "text is data":

> **Prompt text in the *user's* voice is acted on. Text addressed to the assistant is
> refused.**

A prompt the user selected arrives as the user's own input, and a request written in it
reads as their request. An instruction *about the assistant's behaviour* written in the
same place reads as injection — correctly. Every rung ships server-authored text to the
model, so every rung inherits this: write guidance as the expert speaking, or as
reference the model consults, never as orders. Rung 1's guide prose works today for
exactly that reason.

**This restores most of Rung 4's value.** Named workflows can genuinely brief the model —
the constraint is a writing rule, not a ceiling. Two unprompted details from round two
are worth keeping: the assistant told the user, in plain French, that their client does
not support elicitation and it would therefore ask for approval in chat (the new `ping`
field paying for itself immediately), and it flagged the exact ambiguity D9 predicts —
*"« Chapitre 5 » n'a pas le même contenu en lecture CE1 qu'en maths CI"* — without being
asked. That is the name-resolution problem, found by the system itself.

**Completions: measured, and absent.** The argument was a **plain text field** — no
dropdown, no suggestions, despite the server advertising the `completions` capability
and answering `completion/complete` correctly (proven by the probe's own tests). The
client simply does not ask. So the feature that would have ended UUID-pasting is not
available to us, and no amount of server work changes that.

### The consequence: resolve names on our side

Waiting for a client dropdown was always the wrong dependency. If the client will not
offer the expert a list, **the server should accept what the expert can actually type**:

- write tools take a human identifier (`"Chapitre 5"`) alongside — or instead of — a
  node id, and resolve it;
- an ambiguous or missing name comes back as **candidates**, so the model asks "did you
  mean chapter 5 of the teacher's guide or of the pupil manual?" rather than guessing;
- a `find_node(query)` read gives the model a way to turn any phrase into an id.

This lives in Rung 2 (tool-shaped guidance), needs no client feature, and works in every
client we will ever face. **D9 stands — a pasted UUID is a bug in the flow — but its
mechanism is now server-side name resolution, not client-side autocomplete.**

## Phase 3 — "I can say what I mean"

Wrap the primitives in the expert's vocabulary — but only where the wrapper carries an
invariant (see the test below).

- **`create_document(name, covers)`** — mints the `TeachingLearningMaterial` **and** its
  `covers` edge in one atomic call. Replaces the hand-instruction quoted above.
- **`add_section(documentId, name, position)`** — the same for `DocumentSection`:
  `hasPart` from the TLM **and** `covers` to the curriculum node, together.
- **`duplicate_entry(entryId)`** — "start from the house style and change the body font
  to 12 pt". Nobody authors a formatter from a blank page; copy-then-edit is the real
  mental model. A clone-with-fresh-ids into the same library.
- **Retire the `add_to_catalog` detour in guidance** — today an entry must be built
  inside the active subject and then cloned into the library, so a new formatter briefly
  lives inside the CI-maths curriculum, and an interrupted session leaves a half-built
  formatter there with nothing to flag it. `add_nodes(catalog: "workspace")` already
  does this directly. **No code — the tool description and the user guide are the fix.**

### The test — why this is not typed authoring tools, round two

The 9 per-label typed adds were removed because they were **thin facades over the same
`addNode` recipe**: one node per call, identical shape, no invariant of their own, and
their only real content — the per-kind property vocabulary — survived in
`KIND_PROPERTIES` and the `add_nodes` description. Nothing was lost. That judgment was
right and this note does not reverse it.

The proposed verbs differ in kind, and the difference is the test:

> **A task verb earns its place only when it enforces a multi-element invariant that a
> primitive call can silently violate.**

- `create_document` **passes**: a TLM without its `covers` edge is a valid graph write
  and a broken document. Two elements, one invariant, silent failure.
- `add_section` **passes**: two edges on two different axes, both required.
- A hypothetical `create_lesson` **fails**: `add_nodes` with `alignTo` is already atomic
  and already carries the invariant. It would be a facade — exactly what we retired.

Applied honestly the test admits about three verbs and rejects the rest. If a fourth
candidate appears, it goes through the test, not through sympathy for the caller.

## Phase 4 — "I can try it, and take it back"

- **`preview_generation(nodeId)`** accepting a `DocumentSection` (or a document), not
  only a Course ([`preview.ts`](../../backend/src/server/preview.ts) takes `course`
  only). The per-piece reader already exists — `walk_document_section`
  ([`walk-document-section.md`](walk-document-section.md)); this is routing, not new
  machinery. Today, changing one routine step means regenerating a whole chapter to see
  the effect. *Small.*
- **`undo_last`** — invert the most recent apply record's `GraphDiff` and stage the
  inverse onto the draft. Real work (inverting a move, inverting a delete, refusing when
  a later edit touched the same node) but bounded. `discard_draft` being the only undo
  means six edits and one regret costs all six — a strong deterrent to exactly the
  experimentation this phase exists to encourage. *Medium.*

## Phase 5 — "This is a workflow, not a box of tools"

- **`request_review`** — a curator marks the draft ready and the approver sees it.
  Today that handoff happens on WhatsApp. A stamp on the draft pointer, surfaced in
  `get_context` (and a natural Rung-4 prompt: *Préparer une relecture*).
- **The unfinished-work view** — Phase 2's `start_here`, grown up: N unpublished
  changes, these 3 documents have no formatter, these 12 lessons have no routine.
- **Notification on review request** — only if the team asks. Email is a real dependency
  for what may be five people in one room.

## What we deliberately won't build

**A write-capable explorer UI.** The split — chat drives writes, the explorer shows
state — is the right one. Making the explorer editable means rebuilding a form-based
graph editor, and it would cost the thing that makes this usable at all: an expert
describing intent in French instead of filling in fields. The explorer stays read + diff.

## Sequencing logic

Phase 1 makes mistakes **visible**, Phase 2 makes the system **legible**, Phase 3 makes
mistakes **rarer**, Phase 4 makes them **cheap**, Phase 5 makes the work **shared**.

Two things jump the queue because they cost almost nothing and are independent of
everything else: **Rung 1** (conversation scripts + the vocabulary rule in the guide)
and the **elicitation-branch check**. Do both this week regardless of what else is
scheduled.

Building Phase 3 before Phase 1 produces better tools that nobody trusts yet.

## Risks and open questions

1. **~~Prompt content may be inert as guidance.~~** *(Answered — see Phase 2.)* Prompts
   surface, invoke, and — when written in the user's voice — are acted on normally. Only
   text addressed to the assistant is refused. Rung 4 is worth building; completions are
   not available, so its arguments are free text resolved server-side.
2. **The confirmation gate is weaker than the code claims.** *(Answered, and it is not
   only a UX finding.)* `shared.ts` describes the elicitation branch as "the strong gate
   — the agent cannot bypass it with `confirm:true`". With `supportsElicitation: false`,
   that gate has never existed in production: **every** confirmed upload, history write
   and graph mutation was approved by the agent choosing to send `confirm:true` after
   asking in chat. That is still a real checkpoint — the agent is instructed to ask, and
   a human does answer — but it rests on the agent's cooperation, not on a dialog the
   model cannot forge. Worth deciding deliberately whether that is acceptable for the
   destructive verbs (`delete_nodes`, `publish_draft`), and worth correcting the comment
   either way.
3. **The `/kg` read ungate must not reach the draft.** `http.ts` has an env escape hatch
   that ungates the `/kg` read routes and reports `authRequired:false`. A draft slot is
   unpublished work in a multi-tenant store — scope the ungate explicitly to published
   reads, or remove it, before a draft route ships.
4. **Undo conflicts.** Inverting apply *k* when apply *k+1* touched the same node has no
   safe automatic answer. Recommend refusing with a clear explanation over attempting a
   merge.
5. **Does `check_draft` belong inside `review_draft`?** Both are "look at my draft and
   tell me what's wrong". Recommend keeping them separate — one is mechanical and
   server-decidable, the other a judgment the calling model makes from prose — but
   presenting them to the expert as one moment, not two tools to remember.
6. **Diff granularity for a large staged edit.** A batch touching 200 nodes is not
   reviewable node-by-node; the diff view likely needs a summary tier before a detail
   tier. Unresolved.
7. **Who is the first expert?** Every item here is friction *inferred* from the tool
   surface, not watched. One recorded session of a real expert attempting one real
   document would re-rank this list, and costs less than any single item on it.

## Decisions at a glance

| # | Decision | Chosen default |
|---|---|---|
| D1 | Where the self-serve gap lives | **Not documentation** — the guide is already expert-facing; the gap is that the tool surface speaks graph, not curriculum |
| D2 | Build order | **See → guide → say → try → share**: visibility (1), legibility (2), vocabulary (3), undo/preview (4), workflow (5) |
| D3 | Typed task verbs, after retiring typed adds | **Yes, but gated by a test** — a verb must enforce a multi-element invariant a primitive can silently violate; admits `create_document` / `add_section`, rejects facades |
| D4 | `check_draft` scope | **Structural wiring only, never coverage** — pedagogy stays prose in the guide, judged by `review_draft` |
| D5 | Catalog authoring path | **Author into the library directly** via the existing `catalog` arg; the build-then-clone detour is retired in guidance, not in code |
| D6 | Explorer write access | **Never** — chat writes, explorer reads + diffs |
| D7 | Draft visibility auth | **Role check on top of the existing JWT gate**, with the read-ungate escape hatch scoped to published only |
| D8 | In-product guidance mechanism | **Rungs 1, 2 and 4; Rung 3 struck.** Prompts are surfaced and their content *is* acted on — provided it is written in the expert's voice, never as orders to the assistant. Elicitation is unavailable in this client |
| D9 | How the expert supplies a node id | **Never by hand — resolved server-side.** Completions were measured and do not render, so tools accept a typed name and return candidates when ambiguous. A pasted UUID is still a bug in the flow, not user error |

## Related

- [`authorable-catalog.md`](authorable-catalog.md) — the catalog, profiles, and
  coverage-as-prose this note builds on
- [`typed-authoring-tools.md`](typed-authoring-tools.md) — the retired typed adds, and
  why Phase 3 is gated by a test
- [`teaching-learning-materials.md`](teaching-learning-materials.md) — the document
  model, and the Documents view Phase 1 extends
- [`walk-document-section.md`](walk-document-section.md) — the per-piece reader Phase 4
  routes preview through
- [`canonical-changeset-store.md`](canonical-changeset-store.md) — the changeset overlay
  that makes the visual diff a read
- [`graph-native-authoring.md`](graph-native-authoring.md) — the current generic verb
  surface
- [`frontend/user-guide`](../../frontend/user-guide) — the expert-facing guide Phase 2
  moves inside the product
