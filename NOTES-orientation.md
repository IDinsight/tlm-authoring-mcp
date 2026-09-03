# NOTES-orientation — WP0 of ROADMAP-authoring-self-serve

**Status:** WP0 deliverable. Answers the roadmap's five orientation questions with file paths,
then records where the repo and the live graph contradict the roadmap. Nothing in WP1–WP8 has been
started.

**How this was produced:** by reading the code under `backend/src`, running the repo's own token
bench against the committed fixtures, and — because the working graph is the source of truth, not
the fixtures — by calling the live MCP server read-only against `senegal/ci/maths`. No writes, no
draft touched.

> ⚠ There is an **open draft on `senegal/ci/maths`** right now: 14 edits, 140 elements touched,
> last edited 2026-09-03 09:39 by `9ab53a02-…`. I left it alone. Someone should publish or discard
> it before WP-anything begins, because a stale draft silently changes what `preview_generation`,
> `check_draft` and `diff_draft` return.

---

## 1. Repo map

The server is one package under `backend/`. Layering is **enforced** by
[`scripts/check-cycles.mjs`](backend/scripts/check-cycles.mjs) (run by `npm run build`); imports
only ever point down. A new top-level module must be added to its `LAYERS` map
([check-cycles.mjs:34](backend/scripts/check-cycles.mjs:34)) or the build fails.

| What | Where |
|---|---|
| Tool handlers | `backend/src/server/*.ts` — one file per tool group, 34 files, ~6,500 lines |
| Server assembly | [`server/index.ts::buildServer`](backend/src/server/index.ts:35) — 24 `register*Tools` calls, in order |
| Tool schema declaration | `server.registerTool(name, { title, description, inputSchema })` where `inputSchema` is a **raw Zod shape** (not a `z.object`). Every handler is wrapped in `guarded()` from [`server/shared.ts:29`](backend/src/server/shared.ts:29), which converts a missing context into a `needsContext` payload and any throw into a typed `{ error: { code, message } }` |
| `get_capabilities` | [`server/capabilities.ts::buildCapabilitiesReport`](backend/src/server/capabilities.ts:69) — ONE flat async function building ~14 named blocks, returned as one object. Its mirror-property test is `server/__tests__/capabilities.test.ts` |
| Storage / bucket | `src/storage/{adapter,firebase,documents,history}.ts`. The `StorageAdapter` interface is in [`types.ts:55`](backend/src/types.ts:55); the singleton is swapped for tests via `__setStorageForTest` |
| Draft / publish | `src/kg-store/`: [`mutations.ts::runGraphMutation`](backend/src/kg-store/mutations.ts:384) is the two-phase envelope every write goes through; `publish-flow.ts` the pointer flip; `config-flow.ts` the profile cell; `undo.ts`, `draft-chain.ts`, `review.ts` |
| Audit | `store.appendAudit(...)`, records typed in `kg-store/types.ts`, committed in the same transaction as the state write; `nextAuditSeq()` gives a process-local sequence so same-millisecond writes order correctly |
| Response cap | [`utils/server.ts:28`](backend/src/utils/server.ts:28) — `DEFAULT_MAX_RESPONSE_BYTES = 100 * 1024`, override `TLM_MAX_RESPONSE_BYTES`. `asJson` replaces an oversized payload with `{ error: { code: 'RESPONSE_TOO_LARGE' }, shape, hint }`. The roadmap's invariant is accurate |

**For WP5's third checker:** `check_draft`'s six rules are a plain array,
[`kg-store/lint.ts:253`](backend/src/kg-store/lint.ts:253) — `documentCoversNothing`,
`documentHasNoFormatter`, `sectionCoversNothing`, `sectionOutsideDocument`, `routineUnused`,
`isolatedNode`. Exactly the six the roadmap names. Adding a *sibling* module rather than a seventh
entry there is both the right call and structurally easy. Note `lint.ts` sits in `kg-store` (layer 1)
and operates on a `MutationGraph`; a `lint_content` that reasons over a **block tree** cannot live
there — it belongs in `curriculum/` or a new layer-1 module registered in `LAYERS`.

---

## 2. How `preview_generation` assembles its payload — **confirmed, with one caveat**

[`server/preview.ts::previewGeneration`](backend/src/server/preview.ts:114) resolves the draft
model, then tries three resolvers in order and takes the first non-null — that ordering *is* the
dispatch, so no label vocabulary is duplicated:

```
documentSectionSubgraph  → previewOf: "section"    curriculum/documents.ts:423
documentSubgraph         → previewOf: "document"   curriculum/documents.ts:187
courseSubgraph           → previewOf: "course"     curriculum/courses.ts
```

**[`documentSectionSubgraph`](backend/src/curriculum/documents.ts:423) is exactly the resolution the
roadmap describes**, and it is more careful than the roadmap assumes:

- `routine` resolves **nearest-wins, document-first**: the section's own `usesRoutine`, then the
  sections it is nested inside (nearest first), then the owning TLM, then the covered curriculum's
  ancestry — reporting `resolvedFrom` and `resolvedFromScope`.
- `formatters` is every stack on the section's **own path** — its own, its parent sections', the
  TLM's doc-wide one. **Sections are walls** ([`ownFormatterIds`](backend/src/curriculum/documents.ts:343)):
  a sibling section's stack is deliberately excluded.

So: **WP4 Layer A should consume this, and the roadmap is right that it should not be rebuilt.**

The caveat: it returns **raw Learning-Commons nodes and edges** (projected through
[`curriculum/read-projection.ts::nodeOut`](backend/src/curriculum/read-projection.ts:217)), not an
ordered block tree. The distance between "here are the nodes and the formatter stack" and "here is an
ordered sequence of banners, speaking turns, bullets and image slots" is real, unwritten work — and
§6 below argues it is larger than the roadmap budgets for.

---

## 3. `fiche.py` and siblings — **not in this repo. WP4 is blocked, as the roadmap predicted.**

No `fiche.py`, `extraire.py`, `mesure.py`, `compte.py`, `longues.py`, `controle.py` or `verifier.py`
exists anywhere in the tree, and nothing references them by name. They must be obtained from Karimou.

**A second blocker the roadmap does not mention.** There is no rendering capability here at all:

- dependencies are `@modelcontextprotocol/sdk`, `express`, `firebase-admin`, `jose`, `mammoth`, `zod`
  — `mammoth` reads `.docx`, nothing **writes** one, and nothing renders PDF;
- the image is `node:22-slim` ([`backend/Dockerfile`](backend/Dockerfile)) with no Python and no
  LibreOffice.

So WP4 is not only "port the logic" — it is a deployment decision that has to be made first:

- **(a) port to Node** (`docx` npm for the file; a headless renderer for page counts), or
- **(b) keep the Python** and add it to the image / run it as a sidecar service.

(b) preserves `fiche.py` as the executable specification and avoids re-litigating the two expensive
bugs the roadmap describes (the Letter default, the cropped image bands). (a) keeps one runtime and
one language. **This choice gates WP4's schedule and belongs to Karimou, not to me** — but it should
be made before WP3 is designed, because "what the renderer can consume" depends on it.

---

## 4. Test story — good, but the fixtures are badly stale

`vitest`, 64 suites, `npm test` runs them all. No test touches real Firebase or Cloud Storage: a
**memory KG store** (`createMemoryKgStore` + `__setKgStoreForTest`) and a **fake StorageAdapter**
(`__setStorageForTest`) are injected by the shared harness at
[`src/__tests__/harness.ts`](backend/src/__tests__/harness.ts), seeded from committed graphs under
`backend/test/fixtures/<workspace>/<grade>/<subject>/knowledge_graph.json`. Importing
`src/__tests__/index.js` also registers the fixture contexts, so `activateContext` resolves without a
live store. There is a ready-made token bench at `src/__bench__/token-cost.test.ts`
(`BENCH_REPORT=… npx vitest run src/__bench__/token-cost.test.ts`).

**But the committed `ci/maths` fixture is not the live graph, and the gap is disqualifying for
WP4/WP5 golden files:**

| | fixture | live (published, slot b) |
|---|---:|---:|
| nodes | 456 | ~2,000 |
| `DocumentSection` | **0** | **1,096** |
| `covers` edges | 2 | 1,346 |
| `Lesson` | 84 | 60 |
| `FormatterSpec` | 6 | 21 |
| `TeachingLearningMaterial` | 2 | 2 (**different ones**) |

The fixture's TLMs are `45a42c07` "Guide de l'enseignant" and `a51f831c` "Outil de l'élève", both
covering the Course directly with no section spine. Live there are exactly two TLMs and
**`45a42c07` is not one of them**: they are `a51f831c` "Outil de l'élève" (**579 sections**) and
`041ec500` "Guide d'utilisation de l'outil de l'élève". The Course id differs too.

**Action before WP4:** `npm run export:kg-store -- senegal ci maths` and refresh
`test/fixtures/senegal/ci/maths/knowledge_graph.json`. Every golden-file test the roadmap specifies
is written against data this repo does not currently hold.

---

## 5. Can `FormatterSpec` carry arbitrary `properties`? — **Yes. WP3 needs no migration.**

`edit_nodes`' `properties` bag is declared `z.record(z.string(), z.unknown())`
([`server/recipes.ts:157`](backend/src/server/recipes.ts:157)) — values may be nested objects — and
each entry is written to `raw.<key>` with a **nested merge**
([`kg-recipes/edit-node.ts:98`](backend/src/kg-recipes/edit-node.ts:98)). The denylist,
`PROTECTED_RAW_PATHS` ([edit-node.ts:46](backend/src/kg-recipes/edit-node.ts:46)), covers LC identity
and the mirrored fields with dedicated arguments; **`render` is not protected**. So
`edit_nodes({ items: [{ nodeId, properties: { render: { page: {...}, type: {...} } } }] })` works
today and round-trips through `toRawEnvelope` → `nodeOut`. WP3 is purely additive.

Two things WP3 must still build, which the roadmap's §WP0.5 phrasing might let you skip:

1. **There is no value validation on the bag.** `validate` checks the bag is an object and that no
   key is protected — nothing more. The roadmap's requirement ("validate it at authoring time, like
   the profile `core` is validated; an invalid `render` bag is refused at `edit_nodes` time") is
   real work: a Zod schema keyed on `render`, checked in `editNode.validate`.
2. **`render` will be undiscoverable** unless it is added to `KIND_PROPERTIES`
   (`server/authoring.ts`), which `get_capabilities` publishes as `editable.batch.kindProperties` —
   that catalogue is how an authoring model learns which props a kind accepts.

---

## 6. What the live graph says that changes the roadmap

This is the section worth reading twice.

### 6a. The layout rules are already in the graph — as prose, per lesson, at volume

Every lesson-level `DocumentSection` in the live `Outil de l'élève` carries a
`metadata.assemblyGuide` of **2–8 KB of authored French**. A single 12-node `walk_graph` page was
trimmed to **4 nodes** by the byte budget because of them. They contain, per lesson: the page
budget and where the page break falls, the header line, which of the expert's activities were kept
or dropped and why, the answer key (`RÉPONSES … ★ = X, ▲ = O, ■ = –`), the illustration rules, and
the open arbitrations.

Three consequences:

- **It confirms design principle 2** — rules already live in the graph, not in code. Good.
- **It undercuts WP3's premise for WP4.** The roadmap's knob list (page size, leading, `maxChars`,
  `pageBreakCarrier`) is a *document-wide* vocabulary. But "la rupture de page tombe après JE
  RETIENS" is a **per-lesson** instruction living in that lesson's prose, and there are hundreds of
  them. A renderer driven only by `properties.render` will not reproduce these sheets. WP4's Layer A
  must hand the section's `assemblyGuide` prose to the model and let it produce the block tree;
  `render` supplies the geometry the model cannot invent (A4, 15.5 pt, 7.5 cm), not the structure.
  **I recommend saying this explicitly in WP3, so nobody builds a declarative renderer and discovers
  it at golden-file time.**
- **It makes two later work packages much cheaper than budgeted.** WP5's sign-balance rule is
  machine-checkable *from this text* (the answer key is written in a fixed form), and WP7c's
  decisions register has a source already in the graph — the `À trancher` / `À LUI FAIRE CONFIRMER`
  / `À VALIDER` lines sit inside these guides. The roadmap says those "live only in prose notes
  today"; they don't.

### 6b. `walk_document` is unusable on the live maths documents — a defect today

`walk_document(a51f831c)` returns **2,771,552 bytes** and is refused by the cap. The self-bounding in
[`documentSubgraph`](backend/src/curriculum/documents.ts:238) degrades only `curriculum`; `sections`
(579 entries, each carrying its assemblyGuide) and `document` always ride, and together they are 27×
the cap. The error's `hint` correctly routes to `walk_document_section`, so it fails safely — but the
whole-document read is dead on the real data. WP4 and WP6 must be section-at-a-time from the start,
and this is worth a fix in WP2 alongside the other projections.

### 6c. The manifest, not `get_capabilities`, is the biggest token cost

Measured with the repo's own bench:

```
MANIFEST (tools/list) — 63 tools    91,755 B  ≈ 24,799 tok   PAID EVERY TURN
  descriptions                      63,961 B  ≈ 17,287 tok   (69.7%)
  input schemas                     19,198 B  ≈  5,189 tok   (20.9%)
get_capabilities                    26,569 B  ≈  7,181 tok   once per session
get_graph_guide                     23,692 B  ≈  6,403 tok   once per session
```

The five most expensive tools alone (`add_nodes`, `edit_nodes`, `move_node`, `walk_graph`,
`delete_nodes`) cost **5,192 tokens every turn**. The roadmap's WP2b is right that
`get_capabilities` is ruinous as a preamble, but it is a 7.2k one-off; the manifest is 24.8k
recurring. **I suggest a WP2d: trim tool descriptions.** The prose in them is genuinely
load-bearing (it is where the safety rules and the vocabulary discipline live), so this is editing,
not deleting — but a 30% trim is worth more than all of WP2a+2b combined.

---

## 7. The roadmap's factual claims, checked

Measured against the live `senegal` catalog and the repo, on 2026-09-03.

| Claim | Verdict |
|---|---|
| `list_catalog` returns 63,125 characters | ✅ **exact**, to the digit (65,160 bytes UTF-8) |
| …"and is refused by the 100 KB cap" | ❌ **the server did not refuse it** — 65,160 B is under the 102,400 B cap. The *client* refused it on token budget. The tool is unusable either way, but the fix is not about the cap |
| 26 entries | ✅ — 16 routines, 8 formatters, 2 rubrics; 5 shared, 21 workspace |
| `detail:'names'` under 8 KB | ✅ achievable — the projection (id, name, kind, scope, materialCount, stepCount) measures **4,789 B**. The bulk today is `summary`, up to 3.4 KB on a single entry, so `names` must drop it |
| `get_capabilities` ≈ 8,000 tokens | ✅ measured **7,181** on the fixture |
| Annexe 7 weights sum to 80% | ✅ 20+15+10+15+10+10 |
| "enseignement explicite (30 min)" steps sum to 35 min | ✅ declared 30, steps sum 35 |
| `timeRequired` missing on 10 of 21 routines | ⚠ **11 of 16 routines** have ≥1 step with no `timeRequired`; 8 of 16 have it on *no* step. The denominator is 16 routines (26 entries total). The defect is proportionally worse than stated, and the duration is indeed carried in the entry *name* (`… — 30 min`) |
| CGP remediation points at a non-existent id; the real one is `edf2c696-…` | ✅ — and **there are three dangling references, not one**. The entry's summary cites `3e43c5d3-…` (should be `edf2c696-db65-4d14-a19d-8c43fc674061`), `b3f4d5bc-…` and `6931f41c-…` (probably `6313dea1-…`, "Je fais / Nous faisons / Tu fais"). All three are written as **truncated prefixes with an ellipsis**, so WP5's "every referenced id must resolve" rule has to match prefixes, not whole UUIDs |
| Both scopes named `…/_catalog/routines` | ✅ `_shared/_catalog/routines` and `senegal/_catalog/routines` |
| Annexe 7 shared / Annexe 8 workspace | ✅ |
| `formatter-art-style` shared, dependants workspace | ✅ `formatter-art-style` is shared; `02491108` (placeholders) and `4429c8e0` (représentation/inclusion) are workspace |
| Two id conventions coexist | ✅ 35 slug-shaped ids, 141 UUID-shaped, and two UUID families (the two shared routines are v5-shaped, the rest v4) |
| `check_draft`'s six rules | ✅ verbatim, `kg-store/lint.ts:253` |
| Response cap 102,400 B, `TLM_MAX_RESPONSE_BYTES`, `RESPONSE_TOO_LARGE` shape | ✅ all three |
| `preview_generation` → `create_preview_upload_url` only, segregated `previews/` prefix | ✅ enforced in `server/preview.ts`, gated to curator+approver, audited as a distinct `preview` event |

---

## 8. What I recommend changing in the roadmap

1. **WP0.3 → make the Python/Node decision explicit and put it before WP3.** WP4 is blocked on two
   things, not one: the scripts, and a runtime decision that no one has made.
2. **WP3: say that `render` carries geometry, not structure.** Per-lesson structure is prose on the
   section and always will be. Otherwise WP3's acceptance test ("both formatters expressible with no
   free-text escape hatch") will pass while WP4 still cannot render a sheet.
3. **Add WP2d — trim the tool manifest.** 24.8k tokens every turn, larger than every other efficiency
   item in the roadmap put together.
4. **Fold `walk_document`'s overflow into WP2.** It is a live defect and it blocks the whole-document
   path WP6b assumes.
5. **Refresh the fixtures from the live graph before writing any golden-file test** (WP4, WP5).
6. **WP7c is cheaper than budgeted** — the pending arbitrations are already in the graph, in the
   assemblyGuides. It is a scan, not a new register.
7. Correct the two small factual slips: the cap did not refuse `list_catalog`, and the
   `timeRequired` figure is 11 of 16.

## 9. Open questions for Karimou

1. **The Python scripts** — WP4 cannot start without them (roadmap §WP0.3).
2. **Render in Node, or a Python sidecar?** See §3.
3. **Which documents are "the ten published CI-maths teacher sheets"?** The live graph has no
   "Guide de l'enseignant" TLM — it has "Outil de l'élève" (579 sections) and "Guide d'utilisation de
   l'outil de l'élève". WP4's golden corpus needs the actual files and the node ids they came from.
4. **The open draft on `senegal/ci/maths`** (140 elements, edited today) — publish or discard?
5. **`4429c8e0` vs Annexe 8 sections A and B** (roadmap WP8, last bullet) — which is canonical? This
   one is a content decision I should not make.
