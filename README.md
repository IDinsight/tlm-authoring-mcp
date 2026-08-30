# senegal-mohebs-tlm-server

A remote **MCP server** ("Senegal Maths — TLM") that helps curriculum experts author **teaching & learning materials** — pupil manuals, teacher guides, lesson sheets — from a curriculum **knowledge graph**. It exposes MCP tools, not a UI: the server holds the graph, the authoring loop, the reusable pedagogy catalog and the document history; the calling LLM writes the actual `.docx`.

Work is always scoped to one **(workspace, grade, subject)** at a time, chosen with `set_context`. A **workspace** is the tenant that owns a set of graphs — it is the first segment of every namespace and every storage key, and **roles are granted per workspace**. Eight subjects across six workspaces are registered today (`senegal/ci/maths`, `senegal/ce1/reading`, `nigeria/primary-1-3/maths`, `rwanda/primary-1-3/maths`, `cbse/class-9-10/science`, `ghana/basic-1-3/english`, `ghana/basic-4-6/maths`, `madhi/class-1-5/maths`).

The knowledge graph lives **only** in a Firestore node/edge store, in raw *Learning Commons* (LC) ontology, behind a draft → review → publish curator loop. Generated `.docx` files and their history live in **Firebase Storage** (so the generating agent, the server, and you never need a shared disk). Auth is a Supabase JWT.

> **Going deeper:** the operational manual is [`docs/technical-reference/`](docs/technical-reference/); the architecture summary + working conventions are in [`CLAUDE.md`](CLAUDE.md); the production runbook is [`DEPLOY.md`](DEPLOY.md); the *why* behind each subsystem is in [`docs/design-notes/`](docs/design-notes/).

## Repo layout

| Package | What it is |
|---|---|
| [`backend/`](backend/) | The MCP server — its own `package.json`, `tsconfig.json`, `Dockerfile`. **Run every `npm` command from here.** |
| [`frontend/explorer/`](frontend/explorer/) | The read-only KG explorer (Vite + TS), served by Firebase Hosting against the server's `/kg` endpoint. |
| [`frontend/user-guide/`](frontend/user-guide/) | The expert-facing user guide (MkDocs), published to GitHub Pages by [`user-guide.yml`](.github/workflows/user-guide.yml). |
| [`docs/`](docs/) | Technical reference, design notes, and the canonical LC ontology reference. |

Paths written as `src/…`, `scripts/…`, `test/…`, `assets/…` below are relative to `backend/`.

## What lives where

| Thing | Location |
|---|---|
| Knowledge graph (curriculum, catalog, glossary) | **Firestore** node/edge store — the single source of truth (`import-kg` / `export-kg`) |
| Subject profile + authoring guide | **Firestore**, as a per-slot config cell that rides the same draft/published pointer (`get_profile` / `edit_profile`, `get_graph_guide`) |
| `terminology.json` glossary fallback, `GRAPH_GUIDE.md` seed source | **Local** `assets/<workspace>/<grade>/<subject>/` |
| Generated `.docx` + `history.json` | **Firebase Storage**, under `<workspace>/<grade>/<subject>/…` |
| Converted graphs staged for import | **Local** `imports/<workspace>/<grade>/<subject>/` (see [`backend/imports/README.md`](backend/imports/README.md)) |

Object hashing uses the GCS object **md5** from metadata — the server never hashes a local file, which removes the cross-host mismatch that used to break `log_generation`.

## Quickstart

```bash
cd backend
npm install
npm run build          # check-cycles (layering) + tsc → dist/
npm test               # vitest — no credentials needed (memory store + fake storage)
npm start              # stdio MCP server (dist/index.js)
npm run start:http     # HTTP MCP server (dist/http.js) — remote / Cloud Run
```

### Environment

**Required (both modes):** `SERVICE_ACCOUNT_KEY_PATH` *(or `SERVICE_ACCOUNT_KEY_JSON` where mounting a file is impractical)* · `FIREBASE_STORAGE_BUCKET`.

**Required in HTTP mode:** `SUPABASE_URL` · `SUPABASE_ANON_KEY` · `PUBLIC_URL`. The server refuses to start without `SUPABASE_URL` unless `ALLOW_UNAUTHENTICATED=1` — **never set that in production**. `TLM_SUPER_ADMINS` (comma-separated JWT `sub`s or emails) is the root of trust: it must be set before any workspace exists, because only a super admin can create the first one.

**Optional:** `TLM_WORKSPACE` / `TLM_GRADE` / `TLM_SUBJECT` (pre-select a context at startup) · `TLM_BUCKET_PREFIX` (namespace all storage under a prefix — match it in the CLI scripts) · `TLM_ASSETS_DIR` · `GEMINI_API_KEY` / `GEMINI_MODEL` (the `translate` tool) · `SUPABASE_SERVICE_ROLE_KEY` (enables `list_unaffiliated_users`) · `KG_EXPLORER_PUBLIC=1` (anonymous **published** explorer reads; it can never reach a draft) · `KG_ALLOWED_ORIGINS` · `TLM_ALLOW_SELF_APPROVE=0` (strict separation of duties) · `PORT` · the response-size caps `TLM_MAX_RESPONSE_BYTES` / `TLM_WALK_MAX_PAGE_BYTES` / `TLM_SUBTREE_MAX_BYTES` / `TLM_DOCUMENT_MAX_BYTES` · `TLM_CONFIRM_TTL_MS` / `TLM_CONFIRM_STORE_BYTES` · `TLM_DEBUG` / `TLM_TIMING`.

Full semantics: [technical reference → deployment](docs/technical-reference/deployment.md).

## The Firestore KG store + the curator loop

The graph lives in a generic Firestore node/edge store, **double-buffered**: two slots behind a pointer `{ publishedSlot, draftSlot }`. Reads and generation resolve to **published**; every edit stages onto the **draft**; `publish_draft` is an atomic pointer flip. Every mutation is **two-phase** — a dry-run returns a diff, warnings and an opaque `confirmationToken` and changes nothing; the confirm re-checks the token and applies to the draft only — and every mutation and denial lands in an append-only **audit**.

Roles are per workspace: **curator** may edit, apply and discard; **approver** also publishes; **admin** also manages members; an env-rooted **super_admin** spans every workspace. Published curriculum reads are **open** to anyone signed in — what membership buys is the workspace's live assets (its documents bucket, generation history, and the metered translator) and the draft.

Import a graph, or export it for backup/interchange:

```bash
npm run import:kg-store -- <workspace> <grade> <subject> knowledge_graph.json
```

```bash
npm run export:kg-store -- <workspace> <grade> <subject> out.json
```

Full lifecycle, verbs, integrity rules and audit: [technical reference → KG store](docs/technical-reference/store.md).

## Adding a new workspace

A workspace is a **tenant**: a short slug that becomes the first segment of every namespace and storage key it owns. Creating it is what lets people *enter* it with `set_context`; loading its curriculum is a separate step.

There are two paths, and they perform the same writes.

**1. Through MCP (super admin).** The normal path when the server is already deployed:

```
create_workspace(id: "kenya", displayName: "Kenya")
```

Then grant people roles — by email if they have never signed in (it becomes a pending invite claimed at first login):

```
add_member(workspace: "kenya", email: "someone@example.org", role: "curator")
```

For a whole organisation, `set_domain_rule(workspace, domain, role: "curator")` auto-admits anyone signing in with a verified address at that domain. It only applies to providers that vouch for the address (Google today) — a password signup at that domain still needs an invite. `list_members`, `invite_member` / `revoke_invite`, `remove_member` and `remove_domain_rule` round out the surface.

**2. From the CLI** — when you have Firebase credentials but no super-admin MCP session:

```bash
node scripts/create-workspace.mjs kenya "Kenya" --member <userId> --role admin --dry-run
```

Drop `--dry-run` to write for real. The CLI is its own trust boundary (it bypasses the MCP authz path, exactly like `import-kg`), and it still appends the audit record. Set the same `TLM_BUCKET_PREFIX` the server runs with, so the audit namespace lines up.

A new workspace is empty until you add at least one subject.

## Adding a new subject

A subject is **one graph plus one profile**, both keyed by `(workspace, grade, subject)`. The registry is keyed on all three because two tenants can own the "same" grade/subject with genuinely different graphs — Nigeria and Rwanda both sit at `primary-1-3/maths`.

**1. Get the graph into the canonical envelope.** `import-kg` consumes a raw Learning-Commons envelope: `{ nodes, relationships }`, where a node is `{ id, labels: [LClabel], properties: { …camelCase } }` and a relationship is `{ id, type, start, end, properties }`. If you are starting from an EIDU/CASE JSONL export (one node per line, one relationship per line, snake_case, heavy extraction provenance), convert it first:

```bash
node scripts/convert-eidu-jsonl.mjs nodes.jsonl relationships.jsonl imports/kenya/primary-1/maths/knowledge_graph.json
```

Stage converted graphs under `imports/<workspace>/<grade>/<subject>/` — deliberately *not* under `test/fixtures/`, so the test matrix does not pick them up. Check node/edge labels against [`docs/reference/learning-commons/`](docs/reference/learning-commons/) before importing; a non-canonical label parses into the wrong kind.

**2. Author a subject profile** under `src/adapters/profiles/<workspace>/<grade>-<subject>.ts`. A profile is **data, not code** — an `id` plus a parse descriptor — and the generic factory in `src/adapters/build.ts` turns it into the adapter. Most of the parse is already generic (a node's kind comes from its own canonical LC fields: `groupName` for groupings, `statementType` for standards, the `label` for content leaves), so a standards-only graph often needs nothing but the id:

```ts
export const RWANDA_MATHS_PROFILE: SubjectProfile = {
  id: "rwanda-maths/lc-graph-v1",
  parse: {},   // no ordinal field → sequence comes from traversal order
};
```

The knobs that exist are the genuine per-subject differences: `numberFrom` (`order` | `position` | `description` — where a unit's ordinal lives), `containerEdge` / `supportEdge` / `progressionEdge` / `dependencyEdge`, and a named `prune` strategy. The schema is `.strict()`: an unrecognised key is a hard refusal, not a silent ignore, so a typo can never look like it took effect.

**3. Register it** in `src/adapters/index.ts` under the `"<workspace>/<grade>/<subject>"` key. Two keys may point at the same profile when the graphs share a shape — the builder still stamps each with its own identity.

**4. Write the authoring guide** at `assets/<workspace>/<grade>/<subject>/GRAPH_GUIDE.md` — authored markdown that the authoring/generating LLM reads (via `get_graph_guide`) to interpret and modify the graph, including the subject's **coverage expectations in prose**. It ships as a data file, never a code literal, and is composed at read time with the shared [`assets/AUTHORING_CONVERSATION.md`](backend/assets/AUTHORING_CONVERSATION.md) so the conversation rules cannot drift across subjects. Optionally add `terminology.json` (the glossary fallback).

**5. Dry-run, then import.** The dry-run parses the graph against your profile in memory and writes nothing:

```bash
npm run import:kg-store -- kenya primary-1 maths imports/kenya/primary-1/maths/knowledge_graph.json --dry-run
```

Drop `--dry-run` to write. The import parses the graph, serialises it to the store (ids verbatim), writes the **subject-profile config cell** (`{ core, guide }`, taken from the in-repo literal + `GRAPH_GUIDE.md` unless you pass `--profile p.json`), and initialises the pointer. Re-importing an existing namespace needs `--replace-published`, which writes the currently-published slot in place, delta-only — without it the import lands on the non-published slot and readers see nothing change. It is refused while a draft is open.

**6. Deploy the code, then check it live.** The profile is code, so a data-only re-import is not enough: the running server must also carry the new profile module or `set_context` will refuse the namespace ("no subject adapter is registered"). Deploy via the [Deploy to Cloud Run](.github/workflows/deploy.yml) workflow, then `set_context(workspace, grade, subject)` and `namespace_stats` against the live server.

> **Note on where the profile really lives.** The in-repo literal is the *registration check* and the seed source. On a live server, `activateContext` builds the adapter from the namespace's **stored** config cell — the store is the source of truth. Edit a live profile or guide through `edit_profile` (curator-gated, two-phase, publishes with the graph). `scripts/write-profile.mjs` is the repair path for a cell too invalid to activate.

Fuller walkthrough: [technical reference → architecture & extending](docs/technical-reference/architecture-and-extending.md).

## The generation flow (in brief)

1. `set_context(workspace, grade, subject)` — pick what you're working on. `start_here` orients you: where you are, what your role allows, what is unfinished.
2. Read what you're generating — `walk_document` for a whole document, `walk_document_section` for a single piece — each returns the subtree plus the instructional **routines** and **formatters** that apply. `get_terminology` supplies the glossary.
3. Generate the `.docx`.
4. `create_upload_url(relPath)` → `PUT` the file to the signed URL (no large payloads through MCP).
5. `log_generation(nodeId, relPath, content)` — records what you produced against the **scope node** the document covers (md5 read from storage).
6. `evaluate_document` scores it against the evaluation rubrics attached to that document.

The outward-writing tools (`create_upload_url`, `log_generation`, `record_document_content`) are gated by a confirmation step. `preview_generation` closes the *editing* loop instead: it resolves from the **draft** slot and writes to a segregated `previews/` prefix, invisible to `reconcile` / `list_documents` and never touching history. Details: [technical reference → generation & storage](docs/technical-reference/generation-and-storage.md).

## Tools

The live surface is mirrored by `get_capabilities`; this is the map.

- **Orientation & context:** `ping`, `start_here`, `set_context`, `get_context`, `get_capabilities`, `namespace_stats`.
- **Graph reads (generic):** `walk_graph` (directional, filtered, paginated BFS — the traversal primitive), `find_node` (a name → node ids, with the path that tells two same-named nodes apart), `get_standards`, `export_graph_view`.
- **Generation reads:** `walk_document`, `walk_document_section`, `get_terminology`.
- **Authoring (role-gated):** `add_nodes`, `create_edges`, `edit_nodes`, `delete_nodes`, `delete_edges`, plus the two task verbs `create_document` and `add_section`.
- **Draft lifecycle (role-gated):** `diff_draft`, `check_draft` (mechanical wiring lint), `review_draft` (bundles the guide's expectations for the calling model to judge), `undo_last`, `request_review`, `publish_draft`, `discard_draft`, `read_audit`.
- **Subject profile & guide:** `get_profile`, `edit_profile`, `get_graph_guide`.
- **Catalog — reusable routines, formatters & rubrics:** `list_catalog`, `get_catalog_entry`, `add_to_catalog`, `duplicate_entry`, `use_routine`, `use_formatter`, `use_rubric`.
- **Glossary & translation:** `add_terms`, `edit_term`, `remove_terms`, `translate` (FR↔Wolof via Gemini, glossary-grounded).
- **Documents & generation output:** `list_documents`, `create_upload_url`, `create_download_url`, `get_document_text`, `record_document_content`, `log_generation`, `reconcile`, `evaluate_document`, `preview_generation`, `create_preview_upload_url`.
- **Workspaces (tenant admin):** `list_workspaces`, `create_workspace`, `add_member`, `remove_member`, `list_members`, `invite_member`, `revoke_invite`, `set_domain_rule`, `remove_domain_rule`, `list_unaffiliated_users`.

The connector also publishes four named French workflow **prompts** — *Créer un nouveau document*, *Appliquer un style*, *Créer une routine pédagogique*, *Préparer une relecture*. They are French because a prompt *is* the expert's first turn; every server-authored string is English and relayed in the expert's working language.

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — architecture summary, module layering, conventions (the working guide).
- [`docs/technical-reference/`](docs/technical-reference/) — the operational manual: [KG store & curator loop](docs/technical-reference/store.md) · [explorer](docs/technical-reference/explorer.md) · [generation & storage](docs/technical-reference/generation-and-storage.md) · [deployment](docs/technical-reference/deployment.md) · [architecture & extending](docs/technical-reference/architecture-and-extending.md).
- [`docs/reference/learning-commons/`](docs/reference/learning-commons/) — the canonical LC ontology (node data models, every relationship, enums). Check it before adding or retyping any node or edge.
- [`docs/design-notes/`](docs/design-notes/) — the *why* behind each subsystem. Each note carries a **Status** line; heed the "Historical / superseded" ones. Start with [graph-native authoring](docs/design-notes/graph-native-authoring.md) · [self-serve authoring](docs/design-notes/self-serve-authoring.md) · [authorable catalog](docs/design-notes/authorable-catalog.md) · [workspaces](docs/design-notes/workspaces.md) · [member onboarding](docs/design-notes/member-onboarding.md) · [KG mutations](docs/design-notes/kg-mutations/).
- [`DEPLOY.md`](DEPLOY.md) — production deployment runbook.
