## Architecture

The architecture summary lives in [CLAUDE.md](../../CLAUDE.md) — the converged `{ nodes, relationships }` envelope + LC metadata scheme, the one-profile-per-subject model (a declarative `SubjectProfile` assembled by a single generic factory — parse behavior only, no schema on the adapter), and the enforced module layering (imports point **down**; service modules never import `adapters`; the generic `CurriculumModel ⇄ nodes/edges` round-trip lives in `curriculum/store-bridge.ts`). The full design rationale is in [`docs/design-notes/multi-subject-architecture.md`](../design-notes/multi-subject-architecture.md). The operational how-to for wiring a new subject follows.

## Adding a new grade/subject

A subject is **data plus one small profile literal**, keyed by `(workspace, grade, subject)`. The key carries the workspace because two tenants can own the "same" grade/subject with genuinely different graphs — Nigeria and Rwanda both sit at `primary-1-3/maths`. The registry is many-to-one on purpose: two keys may point at the same profile when their graphs share a shape.

The [README](../../README.md#adding-a-new-subject) has the step-by-step recipe with commands. This section is the reasoning behind it.

1. **The graph goes into the store, not onto disk.** There is no `sources/` tree any more — `import-kg` writes the raw Learning-Commons envelope (`{ nodes, relationships }`) straight into Firestore, and `refreshAvailableContexts` lists the store's namespaces so `get_context` reports what actually exists. Stage a converted graph under `imports/<workspace>/<grade>/<subject>/`, deliberately outside `test/fixtures/` so the test matrix does not pick it up. `scripts/convert-eidu-jsonl.mjs` turns a raw EIDU/CASE JSONL export into the canonical envelope.

2. **Author a `SubjectProfile`** under `src/adapters/profiles/<workspace>/`. It is data, not behavior: an `id` and a parse descriptor, which the generic factory in `build.ts` turns into a `SubjectAdapter`. Most of the parse is already generic — a node's kind comes from its own canonical LC fields (`groupName` on a `LessonGrouping`, `statementType` on a `StandardsFrameworkItem`, the `label` on a content leaf) — so a standards-only graph often declares nothing but its id. The remaining knobs are the genuine per-subject differences: `numberFrom` (where a unit's ordinal lives), the containment/support/progression/dependency edges, and a named `prune` strategy. The schema is `.strict()`, so an unrecognised key is a hard refusal rather than a silent ignore.

   The profile no longer carries a `deliverables` list (a document's identity is the graph node it covers) nor a `capabilities` block (retired with the CI-maths domain tools), so there are no subject-conditional adapter methods to wire.

3. **Register it** in `src/adapters/index.ts` under the `"<workspace>/<grade>/<subject>"` key. Every literal is Zod-validated at module load, so a malformed profile fails loudly at startup rather than as a silent mis-parse in a later read.

4. **Ship the authoring guide as an asset**, at `assets/<workspace>/<grade>/<subject>/GRAPH_GUIDE.md` — never as a code literal. `getRegisteredGuide` composes it with the shared `assets/AUTHORING_CONVERSATION.md`, and `import-kg` writes the pair into the namespace's config cell as `{ core, guide }`.

5. **Import, deploy, then verify live.** The profile is code: a data-only import is not enough, because the deployed server must also carry the new profile module. `activateContext` resolves the in-repo adapter purely as a *registration check* — "is this grade/subject supported at all" — and then **rebuilds the adapter from the namespace's stored config cell**, which is the live source of truth. A namespace with no cell falls back to the in-repo literal; an invalid cell is refused rather than approximated, and `scripts/write-profile.mjs` is the repair path for a cell too broken to activate.

   There is no `detect()` schema guard any more. The refusals that replace it are explicit: no graph in the store for that namespace ("import it first"), no registered profile for it ("not supported yet"), or a stored config cell that will not validate.

**No schema on the adapter.** Adapters carry behavior only. Write-safety rules live in the write tools, not on the adapter. The stored `id` for every node and edge is the raw LC IRI, verbatim; friendly properties live inside `properties.raw` and must NOT be used as write-target identities.

**Rules the build enforces:** imports point *down* the layers; **service modules (`storage`/`curriculum`/`kg-store`/`kg-recipes`) must not import `adapters`** — pass what they need in as arguments (the tool layer resolves the active adapter/model and threads it in); cross-module imports go through the module's `index.ts`. `npm run check:cycles` fails the build on any import cycle or upward import.

## Testing note

The storage layer sits behind a small `StorageAdapter` interface. The reconcile / history / variety / ingest logic is verified against an in-memory fake (no credentials needed). Unit tests run with `npm test` (Vitest); the store lifecycle and the read/preview paths are covered under `src/kg-store/__tests__/` and `src/server/__tests__/`. `npm run build` runs the import-cycle check (`npm run check:cycles`) before `tsc`, so a broken layer boundary fails the build. The **Firebase implementation is compile-checked but not live-tested here** — validating real bucket calls (list, signed URL, download, history read/write) needs your service-account credentials and network access, so do a first run against your own project.

### Keeping the fixtures honest

The suites assert against committed graphs under `test/fixtures/<workspace>/<grade>/<subject>/knowledge_graph.json`, seeded into a memory store by `src/__tests__/harness.ts`. They are a **snapshot of graphs that keep being edited**, and a stale snapshot fails silently: every suite stays green while testing a curriculum shape production no longer has. That is not hypothetical — `senegal/ci/maths` sat at **0 `DocumentSection`s** in the fixture long after the live graph had grown roughly 1,100 of them, so the whole section-based generation path was verified against a structure the server never sees.

Two mechanisms guard it, one offline and one credentialed:

- **`test/fixtures/SHAPE.json`** pins a coarse census of each fixture — how many nodes carry each LC label, how many edges carry each type — and `src/__tests__/fixture-shape.test.ts` asserts it on every run. It is too blunt to notice a reworded lesson and sharp enough to notice a structural change, so a refresh that alters what the suites stand on **fails the build** until someone reads the diff and re-pins deliberately. The manifest is a review gate, not a cache.
- **`npm run check:fixtures`** reads the live published slot and reports how far the fixtures have drifted from it, writing nothing and exiting non-zero on drift. This is the one to run on a schedule or in a credentialed job — it answers "are our tests still honest?" without touching the working tree. **`npm run refresh:fixtures`** does the pull for real: it overwrites each fixture from live and re-pins `SHAPE.json`, then leaves the result uncommitted so the diff gets read. Both need `SERVICE_ACCOUNT_KEY_PATH` (or `SERVICE_ACCOUNT_KEY_JSON`) and `FIREBASE_STORAGE_BUCKET`, and both take an optional `<workspace> <grade> <subject>` to do one context.

Expect a refresh to break more than the shape test. Around 25 suites name fixture node ids literally, and a refreshed `ci/maths` brings different `TeachingLearningMaterial` ids — that fallout is the honest cost of the snapshot having gone unrefreshed, not a reason to skip it.

A shape that genuinely no longer exists in production belongs in `src/__tests__/synthetic.ts` instead: a tiny hand-built graph for mechanics the code still supports but no live curriculum exercises (a `Chapitre` grouping, an `Activity` filed under a `Lesson`). Everything else should use the real fixture and stay honest about production's shape.

## Assumptions still baked in (tell me to change any)

- One grade/subject is active at a time; switching drops the KG, terminology, and history caches so the next call reloads for the new context.
- Documents are **not** classified by filename any more: a document's identity is the graph node it covers (its scope node), recorded via `record_document_content(nodeId, …)`. `reconcile` diffs the bucket against history by `relPath` and reports untracked docs for linking. See [`../design-notes/graph-linked-documents.md`](../design-notes/graph-linked-documents.md).
- Glossary derives from the KG, with the FR/Wolof file as fallback; characters are derived from what you log/ingest.
- "Latest" among duplicates is the object whose md5 matches history, else the most recently updated.
