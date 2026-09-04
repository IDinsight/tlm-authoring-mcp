/*
 * The BODY of the capabilities report — one builder per section.
 *
 * `get_capabilities` answers "what can this caller do right now", and the answer
 * runs to ~26 KB across sixteen areas: the edit verbs, the draft lifecycle, the
 * catalog, the read tools, the safety rules, and so on. Assembled inline it was
 * a single 450-line function, so checking one advertised field — does `catalog`
 * still name the right gate? — meant scrolling past fifteen unrelated ones.
 *
 * Each section is a plain function of what it actually depends on, so it can be
 * read, changed and reviewed on its own. capabilities.ts calls them in order and
 * does nothing else with the results but name them.
 *
 * THE MIRROR RULE APPLIES TO EVERY BUILDER HERE: a section reports what another
 * module enforces, and never decides anything itself. Gated flags come from the
 * `actions` map (which is one authorize() call per action), lists come from the
 * registry that owns them (RECIPES, STRUCTURAL_RULES, CATALOG_WRITE_VERBS,
 * CONTENT_RULES), and schema-derived keys come off the schema. A value computed
 * here rather than mirrored is a copy that will drift — the hand-kept catalog
 * verb list went stale twice before it became CATALOG_WRITE_VERBS.
 */
import { CONFIRMATION_RULE } from "./shared.js";
import { activeWorkspace } from "../context/index.js";
import { STRUCTURAL_RULES } from "../kg-store/index.js";
import { RECIPES, SHARED_CATALOG_NAMESPACE, catalogNamespace, renderSpecSchema } from "../kg-recipes/index.js";
import { documentSchema } from "../render/index.js";
import { lintableRules, CONTENT_RULES } from "../curriculum/index.js";
import { KIND_PROPERTIES } from "./authoring.js";
import { CATALOG_WRITE_VERBS } from "./catalog-target.js";

/*
 * The gate flags every section mirrors: capability name → may this caller do it.
 * Built by capabilities.ts from one authorize() call per action, so a builder
 * that reads `actions.canPublish` is quoting the real gate rather than deciding.
 */
export type Actions = Record<string, boolean>;

// The top-level groups `render` accepts, read straight off the schema that
// enforces them — a hand-kept list here would be a copy that goes stale the
// first time a knob is added.
const RENDER_SPEC_GROUPS = Object.keys(renderSpecSchema.shape).sort();

// The top level of the block tree, read off the schema for the same reason.
const DOCUMENT_TREE_KEYS = Object.keys(documentSchema.shape).sort();

/*
 * A MIRROR of the generic recipe registry (edit_nodes / move_node).
 * Rendered straight from RECIPES so what Claude discovers cannot drift from what
 * is built. Node CREATION is add_nodes (see `batch`).
 */
export function recipesSection() {
  return {
    available: true,
    note: "Generic composite mutations over canonical LC: one intent → one diff → one confirmation token → one atomic draft write → one audit event. edit_nodes edits one node's content / position / title in place — or many nodes' in one batch (it replaced the single-node edit_node); move_node re-parents one node along one containment axis, leaving its other axis intact. Node creation is add_nodes (see editable.batch).",
    list: RECIPES.map((r) => ({ name: r.name, summary: r.summary, params: r.params })),
  };
}

// Takes the built `recipes` section because it embeds it: the edit surface is
// the batch verbs AND the generic recipes, reported as one block.
export function editableSection(recipes: ReturnType<typeof recipesSection>) {
  return {
    scope: "batched node/edge authoring + generic recipes",
    note:
      "Nodes are created via `add_nodes` (one or many — see `batch`, with the per-kind property catalog in `batch.kindProperties`); edges via `create_edges` (one or many); deletions via delete_edges / delete_nodes (see `structural.verbs`); a node's content / position / title are edited in place via `edit_nodes` (one node or many), and a node is re-parented via `move_node` (both under `recipes`).",
    structural: {
      verbs: ["create_edges", "delete_edges", "delete_nodes"],
      // delete_nodes ALWAYS cascades the dependent subtree; the dry-run warns
      // with the full set and nothing is removed until confirm — no force flag.
      cascade: "always-with-warning",
      note:
        "create_edges adds one edge or many (usesRoutine / buildsTowards / relatesTo / hasDependency / an extra hasEducationalAlignment); edge id is deterministic (`<type>:<from>-><to>`), duplicate detection spans the batch AND the draft, and edge-type LEGALITY across labels is not enforced (deferred to human review at publish). It replaced the single create_edge. " +
        "delete_edges removes one edge or many by id in one atomic batch (all-or-nothing). " +
        "delete_nodes removes one node or many — each AND its dependent subtree (children, their children, …) plus every incident edge — in one atomic batch; the cascade spans all the ids at once, the dry-run diff shows the full set that will vanish and WARNS with it, and nothing is removed until you confirm, so seeing the cascade is the safety (no force flag). " +
        "To CREATE a node, use `add_nodes`, not create_edges.",
    },
    recipes,
    // The two TASK verbs — the ONLY wrappers over the primitives, and each earns
    // its place by enforcing a multi-element invariant a primitive can silently
    // violate (self-serve-authoring.md, D3). They are not the retired typed adds:
    // those were facades over one addNode call with no invariant of their own.
    documents: {
      tools: ["create_document", "add_section"],
      // Both accept a NAME where an id would go, and return candidates on ambiguity.
      resolvesNames: true,
      invariants: {
        create_document: "mints the TeachingLearningMaterial AND its `covers` edge together — a TLM without one is a valid write and a broken document that generates empty",
        add_section: "wires BOTH of a section's axes together — `hasPart` from whatever holds the section (the document, or a section of it: sections nest) and `covers` to the curriculum (omit `covers` only for front matter, or for a section that just groups the sections beneath it)",
      },
      note:
        "create_document / add_section replace the add_nodes + create_edges pair for authoring a document. Use them for anything document-shaped; add_nodes stays the tool for curriculum nodes, where `alignTo` already carries the equivalent invariant atomically.",
    },
    // The batched writes and their response/idempotency controls, advertised so
    // callers can feature-detect returnMode + idempotencyKey and look up the
    // per-kind property vocabulary the retired typed adds used to document.
    batch: {
      tools: ["add_nodes", "create_edges", "delete_edges", "delete_nodes"],
      params: ["returnMode", "idempotencyKey"],
      returnModes: ["summary", "full"],
      defaultReturnMode: "summary",
      idempotencyTtlHours: 24,
      // kind → the canonical LC props that kind accepts in an add_nodes item's
      // `properties` bag. add_nodes is THE node-creation tool (one or many); the
      // per-label typed adds were retired in favour of it.
      kindProperties: KIND_PROPERTIES,
      note:
        "add_nodes creates one node or many; create_edges wires many edges — each a whole batch as ONE atomic draft edit (one diff, one token, one audit record). add_nodes REPLACED the per-label typed adds (add_lesson/add_material/…): pass `kind` (the LC label) + a `properties` bag; `kindProperties` lists what each kind accepts. returnMode defaults to 'summary' — a compact `counts` object instead of the full diff (~200 KB for an 84-item batch); pass 'full' to also get the diff. idempotencyKey (a client-chosen UUID) makes a RETRIED confirm a safe replay (same key + same payload → the first apply's summary with replayed:true, no double-apply/audit; different payload → IDEMPOTENCY_KEY_MISMATCH). Keys are namespace-scoped and expire after 24h; omit for strict single-use tokens.",
    },
    // The formatter's DECLARATIVE half. A FormatterSpec's `content` stays prose —
    // it is what the authoring model reads — and `render` carries the values a
    // renderer needs, validated at authoring time so a mistyped knob is refused
    // here rather than silently ignored on the page.
    render: {
      property: "render",
      appliesTo: ["Formatter", "FormatterSpec"],
      writtenWith: ["add_nodes", "edit_nodes"],
      groups: RENDER_SPEC_GROUPS,
      validatedAt: "authoring",
      strict: true,
      note:
        "`render` is the machine-readable half of a formatter, written through the same `properties` bag as any other raw prop (whole: {\"render\": {…}}; one branch: {\"render.page.marginsCm\": {…}}). Every group and every field is OPTIONAL — silence means 'this formatter does not govern that', never zero — but UNKNOWN KEYS ARE REFUSED, because a typo in a declarative bag is invisible at authoring time and ignored at render time. It carries GEOMETRY AND STYLE (page, type, block styles, image sizes, where a page break is carried, which line prefixes print, how the languages are laid out, what yields when a page overflows). It does NOT carry STRUCTURE: which blocks appear in what order, and where a particular lesson breaks its page, is authored per section in that section's own assembly guidance — a schema holding it would be describing one document type. `language.strategy` covers both shapes in use: 'inline' (both languages on one line, separated) and 'per-file' (one file per language, lines routed by prefix).",
    },
    coverage: {
      // Coverage is no longer coded rules on the adapter — it is the subject's
      // expectations authored as PROSE in the graph guide, reviewed on demand.
      // check_draft is its MECHANICAL sibling and must never grow coverage rules
      // (self-serve-authoring.md, D4) — it checks wiring, this checks pedagogy.
      tool: "review_draft",
      structuralCheck: "check_draft",
      note:
        "Coverage/completeness is now authored as prose in the subject's graph guide (get_graph_guide) and checked on demand by review_draft — a read-only pre-publish pass that hands the guide's expectations + a structural snapshot to the model to reason over. The old deterministic coded coverage rules (empty chapter, one bilan, …) were retired; edits and diff_draft no longer emit automatic coverage warnings. Completeness is a review step, never a block.",
    },
  };
}

/*
 * The draft promotion / discard / undo tools and their response
 * controls, advertised so callers can feature-detect returnMode (mirrors
 * editable.batch). The role gates live in actions.canPublish /
 * actions.canDiscardDraft — this block is about response SHAPE, not authz.
 */
export function lifecycleSection() {
  return {
    tools: ["publish_draft", "discard_draft", "undo_last", "request_review"],
    params: ["returnMode"],
    returnModes: ["summary", "full"],
    defaultReturnMode: "summary",
    note:
      "publish_draft promotes the draft to live; discard_draft throws it away. Both are two-phase (dry-run → confirmationToken → confirm). returnMode defaults to 'summary' — a compact `counts` object (plus `warnings`, verbatim, on publish) instead of the whole-draft `diff`, which is 200+ KB on a large draft and can overflow the token cap and hide the confirmationToken; pass 'full' to also attach the diff (and any staged profileDiff). To inspect the full diff before promoting, call diff_draft — it is the diff endpoint; publish_draft/discard_draft return mutation summaries. Coverage warnings are preserved in BOTH modes: an approver must see them before publishing. undo_last is the per-EDIT counterpart to discard_draft: it takes back only the most recent staged edit (replaying that edit's recorded diff backwards) and leaves the rest of the draft standing, peeling back one edit per call. It is an ordinary draft edit — gated by actions.canEditDraft, not canDiscardDraft — and it refuses rather than merges when a later edit touched the same node. request_review marks the open draft FINISHED and waiting for someone to read it — the curator→approver handoff that otherwise happens outside the system. It notifies nobody: an approver sees it in start_here (`waitingOn`) and on diff_draft (`reviewRequested`). It is a single call (no confirm — no curriculum changes), curator+, recorded in the audit trail, cleared automatically by publish/discard, and taken back with withdraw:true.",
  };
}

/*
 * Structural rules and confirm expectation. structural
 * is imported from validate.ts so a rule description change is one file.
 */
export function rulesSection() {
  return {
    structural: [...STRUCTURAL_RULES],
    confirmation:
      "Every write is two-phase: call the tool once without confirm to get a diff and a confirmationToken (no state change), then call again with confirm:true and the token to actually apply. Publish/discard tokens are checked against the current draft state — if the draft moved since the dry-run, the confirm is rejected. " +
      "WHAT THE TWO-PHASE STEP IS AND IS NOT: it guarantees that nothing changes until a second, deliberate call quoting a token bound to the exact diff you were shown — it does NOT prove a human approved. " + CONFIRMATION_RULE + " Anything the dry-run hands over, you could hand back. The gate is therefore YOUR cooperation: show the user the diff, in their language, and get an explicit yes before you confirm. What does not depend on your cooperation is identity (roles are read from a signed token you cannot forge), reversibility (a graph edit stages to a draft — undo_last takes one back, discard_draft drops them all, and nothing reaches generation until an approver publishes), and the audit trail (every apply and every denial is recorded with who did it). Weigh a write by which of those it has: the writes with NO draft behind them are publish_draft, the catalog writes (the `catalog` argument and add_to_catalog), the glossary writes, and the document/history writes — those are live the moment they are confirmed.",
  };
}

/*
 * Advertise the draft-resolved preview generation surface, so
 * Claude can proactively offer "want to see what this edit generates before
 * publishing?". `available` mirrors the same readDraft gate the tool enforces;
 * `hasDraft` says whether there is anything to preview right now.
 */
export function previewSection(actions: Actions, draftExists: boolean) {
  return {
    available: actions.canPreview,
    hasDraft: draftExists,
    tools: ["preview_generation", "create_preview_upload_url"],
    note:
      "preview_generation resolves the generation context from the UNPUBLISHED draft (not published), scoped to whichever piece you name — a DocumentSection (one slot of a document), a TeachingLearningMaterial (a whole document), or a Course (its containment subtree), reported back as `previewOf` — so you can generate a PREVIEW of the material a staged edit would produce before publishing, at the size of the thing that changed rather than a whole chapter. It closes the loop with the dry-run: dry-run shows the graph DIFF, preview shows the resulting MATERIAL. Read-only on the draft (no graph change), curator + approver only. Preview .docx output goes through create_preview_upload_url to a SEGREGATED previews/ prefix with short-lived, clearly-labelled URLs — it never touches the canonical documents bucket, list_documents, or log_generation. With no draft open, preview_generation returns a clear 'no draft to preview' notice. Draft-vs-published output comparison is a deferred follow-on.",
  };
}

/*
 * The block tree render_document takes. The counterpart to
 * `editable.render`: that half says what a page LOOKS like, this one says
 * what is ON it. Keys come off the schema that enforces them, never a list
 * kept by hand here.
 */
export function documentSection(actions: Actions) {
  return {
    available: actions.canPreview,
    tools: ["render_document", "propose_from_document", "check_stale"],
    keys: DOCUMENT_TREE_KEYS,
    blockKinds: ["table", "line", "spacer"],
    validatedAt: "render",
    strict: true,
    note:
      "The block tree is what YOU compose and render_document lays out. `blocks` is an ordered list of: `table` ({rows: Cell[][]}, where a Cell is {blocks, style?, span?} — cells hold BLOCKS, so a banner and a grid of pictures are the same construct and tables nest), `line` ({runs, variant?, style?}, where a run is {text, style?} or {image: {media, role, aspectRatio, float?}}), and `spacer` ({sizePt, leadingPt}). Optional `media` carries the pictures as {name, data} with data base64. " +
      "IT CARRIES NO GEOMETRY — no colour, no point size, no centimetre. A block names a `style` and a picture names a `role`, both defined by the formatter's `render`; a page break says only `pageBreak:'before'` and `pagination.pageBreakCarrier` decides whether that is written as a paragraph property or a paragraph of its own. That split is the point: structure varies per lesson and is yours, geometry is the formatter's and is the same for every page it governs. " +
      "UNKNOWN KEYS ARE REFUSED and nothing renders when the tree is invalid; the response names the path. Output is a preview: segregated prefix, short-lived URL, never list_documents or log_generation. " +
      "ONE FILE PER LANGUAGE when the formatter's `language.strategy` is 'per-file' — tag a line with a `variant` and it prints only in that variant's file, leave it untagged (or mark the variant `inAllFiles`) and it prints in every one. `translateInto` derives a language the tree does not carry, grounded in the subject glossary. " +
      "`measure:true` lays each file out and COUNTS ITS PAGES — measured on the render, never estimated from the source; with `budget.maxPages` declared each file also reports `fits`. It needs a layout engine in the deployment and reports `available:false` where there is none, rather than guessing. " +
      "THE LOOP CLOSES BOTH WAYS: a block may carry `anchor`, the graph node it came from, which the renderer writes into the file as a Word content control — invisible on the page, preserved when a person edits around it. `propose_from_document` reads a corrected .docx back and returns proposed edits, plus `editItems` in the shape edit_nodes takes. It PROPOSES and never writes; a vanished line is reported rather than deleted (a deliberate cut and an editing slip look identical in a Word file), and new text with no anchor is reported without a parent rather than filed by position. " +
      "AND IT SAYS WHEN A DOCUMENT HAS GONE OUT OF DATE: each produced file records the nodes it drew from and their wording at the time (read out of its own anchors, not declared), so `check_stale` reports per document — editing one lesson flags the files covering that lesson and nothing else. A file that records no sources is UNKNOWN, never current.",
  };
}

/*
 * Advertise the approver-only, read-only audit reader (#16), so
 * Claude can offer "want to review who changed what?" to an approver.
 * `available` mirrors the SAME readAudit gate the tool enforces (via
 * actions.canReadAudit → authorize(actor, "readAudit", ns)) — it cannot drift.
 */
export function auditSection(actions: Actions) {
  return {
    available: actions.canReadAudit,
    tool: "read_audit",
    note:
      "read_audit is a filtered, paginated, READ-ONLY view of the append-only audit log for THIS namespace, newest-first. APPROVERS ONLY (same tier as publish); curators / no-role are blocked and the blocked read is itself audited. It cannot alter, redact, or reorder any record. Namespace-scoped: to review another namespace, set_context to it (there is no namespace argument). Filters: actor, action, outcome (applied|blocked), nodeId, since/until. Modes: 'summary' (compact, no before/after — the default) and 'detail' (full before/after; also for a specific auditId). Pagination via limit (default 25, max 100) + an opaque cursor. Each call appends ONE lightweight 'read' event (actor + query + timestamp + count) — never a before/after — so 'who reviewed history' stays answerable. It is deliberately a reader, not analytics.",
  };
}

/*
 * The workspace's LIVE assets. This is where the open-reads
 * policy stops: anyone signed in may enter a workspace and read its published
 * curriculum, but the produced .docx, the generation history and the metered
 * translator are members-only. Both flags mirror the SAME authorize() calls
 * the tools enforce (actions.canReadDocuments / canWriteDocuments), so they
 * cannot drift.
 */
export function documentsSection(actions: Actions) {
  return {
    canRead: actions.canReadDocuments,
    canWrite: actions.canWriteDocuments,
    canTranslate: actions.canTranslate,
    readTools: ["reconcile", "list_documents", "create_download_url", "get_document_text"],
    writeTools: ["create_upload_url", "log_generation", "record_document_content"],
    note:
      "The published CURRICULUM is open — no membership is needed to set_context into a workspace and read its graph (walk_graph, get_standards, find_node, namespace_stats, walk_document, get_graph_guide), matching the public KG explorer that already serves the same data. Its DOCUMENTS are not: signed URLs to produced .docx, the generation history, and the Gemini-backed `translate` all require a ROLE in this workspace (any role — curator is enough). The write tools additionally write LIVE with no draft and no undo, which is why they are held at membership rather than left open with the reads. A non-member gets a `phase:'unauthorized'` payload naming what they'd need, and the refusal is audited.",
  };
}

/*
 * Advertise the reusable-spec catalog (both scopes). `browse`
 * (list_catalog) is an ungated read; `canUse` (use_routine) COPIES an entry onto a
 * lesson, so it mirrors the SAME apply gate any draft edit enforces
 * (actions.canEditDraft → authorize(actor, "apply", ns)) and cannot drift.
 */
export function catalogSection(actions: Actions) {
  return {
    browse: true,
    canUse: actions.canEditDraft,
    canAdd: actions.canPublish,
    // Editing an entry IN PLACE (the write verbs' `catalog` argument). Gated by the
    // PUBLISH policy rather than the apply one, exactly like canAdd: a catalog write
    // applies AND publishes in the same step, so approver+ is what actually decides.
    canEditEntries: actions.canPublish,
    // Rendered from the routing module's own list, never a copy — a hand-kept array
    // here went stale twice (it missed the deletes in #178 and move_node in #200).
    editVerbs: CATALOG_WRITE_VERBS,
    scopes: { shared: SHARED_CATALOG_NAMESPACE, workspace: catalogNamespace(activeWorkspace()) },
    tools: ["list_catalog", "get_catalog_entry", "use_routine", "use_formatter", "use_rubric", "add_to_catalog", "duplicate_entry"],
    canDuplicate: actions.canPublish,
    resources: ["catalog://{scope}/{id}"],
    // How list_catalog is narrowed. The whole library in full is ~63 KB, so
    // `names` is the default and detail is asked for.
    listCatalog: {
      params: ["kind", "scope", "detail", "limit", "cursor"],
      details: ["names", "full"],
      defaultDetail: "names",
      defaults: { limit: 50 },
      maxLimit: 200,
    },
    // Where each kind of entry ATTACHES when applied — mirrors useRoutine / useFormatter / useRubric.
    applies: {
      routine: "Lesson, via usesRoutine",
      formatter: "TeachingLearningMaterial (the document), via hasPart",
      rubric: "TeachingLearningMaterial (the document), via hasPart",
    },
    note:
      "The catalog is a library of reusable instructional routines, formatters (house-style specs) and rubrics (evaluation grids), read across TWO scopes: the cross-tenant SHARED library and the active workspace's own. list_catalog browses both — each entry tagged scope (shared|workspace) + kind (routine|formatter|rubric) — an ungated read; get_catalog_entry reads ONE entry's FULL authored spec (the step/formatter Material content list_catalog only counts). The same full spec is also served as an MCP resource (catalog://{scope}/{id}) for clients with a resource browser; the tool exists so it works everywhere. use_routine / use_formatter APPLY an entry (from either scope) by COPYING it: the entry's whole subtree is cloned with fresh ids into the active subject's DRAFT, so the copy is independent and later edits to the library entry do not reach it. They attach differently — use_routine links a routine to a Lesson via usesRoutine; use_formatter relabels the copy to the document layer (Formatter/FormatterSpec) and hangs it under the document's TeachingLearningMaterial via hasPart (pass the TLM id, or a Course to resolve its TLM); use_rubric does the same one level deeper (Rubric/RubricSection/RubricCriterion), attaching the evaluation grid that evaluate_document then scores the produced document against. Formatting and evaluation are both properties of the DOCUMENT, not the curriculum, so neither rides a Course's usesRoutine edge. add_to_catalog is the write INVERSE: it clones a routine/formatter you authored in the active subject (an InstructionalRoutine + its steps/materials) INTO a catalog and PUBLISHES it live in one gated step — to your own workspace's library, or (super_admin only) the shared library or any workspace (omit targetWorkspace to get the choices). Because it publishes, it needs APPROVER+ in the destination workspace, or super_admin for the shared library (authorize(actor, 'publish', catalogNs) — the same policy publish_draft enforces, so it cannot drift). use_routine/use_formatter and add_to_catalog are all two-phase (dry-run returns diff + confirmationToken + a minted old→new id-map; confirm re-checks the token); the copies apply to the active draft, add_to_catalog applies-and-publishes the catalog. To CORRECT an entry already in a library (rather than file a new one), pass `catalog` to the generic write verbs — " + CATALOG_WRITE_VERBS.join(" / ") + " accept 'workspace', 'shared', or a workspace id and then write to that library instead of the active subject. delete_nodes with `catalog` is how an entry is RETIRED: name the entry id and its steps/Materials come along in the cascade — and it needs ADMIN in the destination workspace, one tier above the approver an ordinary catalog write needs, because it publishes immediately (no draft, no undo_last) on an entry other workspaces may be using. Its dry-run carries `irreversible:true` + a warning to read to the user, and the confirmed response carries `recovery` naming the audit record that holds the deleted subtree in full. It carries add_to_catalog's two differences: the destination gate (super_admin to cross into another workspace's or the shared library) and applies-and-publishes on confirm, so `catalog` must be re-sent on the confirm. Copies already made from an entry are independent and do NOT pick the correction up — fix those in the subject graph separately. Seed a catalog namespace to populate it; it lists [] until then.",
  };
}

/*
 * The generic read tools for exploring the graph. Both are
 * ungated reads; walk_graph's slot:"draft" mode is the one part that needs a
 * role, so `canWalkDraft` mirrors the SAME draft-read gate diff_draft enforces
 * (actions.canReadDraft) and cannot drift.
 */
export function discoverySection(actions: Actions) {
  return {
    tools: ["walk_graph", "walk_document", "walk_document_section", "find_node", "namespace_stats", "export_graph_view"],
    canWalkDraft: actions.canReadDraft,
    // Name → id resolution. It exists because a human never has an id to give
    // and this client renders no completion dropdown, so the SERVER resolves
    // what the expert types (self-serve-authoring.md, D9).
    findNode: {
      params: ["query", "queries", "labels", "limit", "slot"],
      defaults: { limit: 10 },
      // `queries` resolves a whole list against ONE graph load; its `unresolved`
      // names every entry that did not land on exactly one node.
      batch: "pass `queries: string[]` instead of `query` — results are keyed by query string",
      // Several equally-good matches is normal (two Courses each hold a
      // "Chapitre 5"), so the answer is candidates, never a pick.
      ambiguity: "returns `ambiguous:true` + every match with its containment `path` — ask the user which, do not guess",
    },
    walkGraph: {
      params: ["fromId", "direction", "edgeTypes", "nodeTypes", "maxDepth", "includeEdges", "limit", "cursor", "slot"],
      defaults: { limit: 50, maxDepth: 3 },
      maxLimit: 500,
      // Two independent overflow flags callers should branch on.
      pagination: "nextCursor + truncatedByLimit (more nodes remain) vs truncated (depth cap) vs truncatedBySize (byte budget trimmed the page — see hint)",
    },
    walkDocument: {
      params: ["tlmId", "slot"],
      // How the curriculum-to-render was resolved from the TLM.
      scopes: ["sections", "course", "none"],
      // A whole-Course curriculum too big to inline comes back self-bounded — the
      // small parts (guide/spine/document) still ride; only `curriculum` degrades.
      overflow: "self-bounded — an oversized curriculum returns { tooLarge, counts, message } routing to walk_document_section (spine) or walk_graph (Course fallback)",
    },
    walkDocumentSection: {
      params: ["sectionId", "slot"],
      // Anchored on the DocumentSection — the document↔curriculum binding — so the
      // routine resolves nearest-wins document-first: the section's own usesRoutine,
      // else the sections it is nested in, else the owning TLM's, else the covered
      // curriculum's ancestry.
      routineResolution: "nearest-wins, document-first (section → the sections it is nested in, nearest first → owning TLM → covered curriculum's ancestry)",
    },
    exportGraphView: {
      params: ["fromId", "maxDepth", "detail"],
      defaults: { maxDepth: 4, detail: false },
      maxDepth: 12,
      // A slice too big to fit the response cap comes back as { tooLarge, counts, message }.
      overflow: "self-bounded — oversized detailed slice auto-drops detail; a still-too-big slice returns { tooLarge, message }",
    },
    note:
      "walk_graph is the single generic traversal: a directional (out/in/both), edge- and label-filtered, PAGINATED BFS from any node — use it to discover the framework root, a course subtree, a standards spine, anything. It replaced get_course. Page with limit (default 50, max 500) + nextCursor; do not raise the limit to fit a big result. includeEdges defaults to FALSE — opt in only when you need the edges. truncatedByLimit means more nodes remain on further pages; truncated means the depth cap hid deeper nodes; truncatedBySize means a response BYTE budget trimmed the page below `limit` (raising limit won't help — set includeEdges:false and narrow nodeTypes, then page via cursor; the `hint` field says so). slot:'published' (default) reads live; slot:'draft' inspects UNPUBLISHED staged edits (curator/approver only). walk_document is the document-side counterpart: given a TeachingLearningMaterial (TLM) root it returns that document's assemblyGuide, its Formatter/FormatterSpec rendering stack, its DocumentSection spine (in reading order, each section naming the `parent` it hangs under — sections nest), and the curriculum it renders (resolved by section spine or a TLM→covers→Course fallback — `scope` says which), so generation targets the document, not the raw curriculum. walk_document_section is the PER-PIECE generation entry, anchored on ONE DocumentSection — the node that already IS the document↔curriculum binding (it hangs under exactly one TLM and covers its curriculum), so it is the unit generation produces a document from, section by section: it returns the owning document, the curriculum the section renders, the routine that applies (nearest-wins, document-first — the section's own usesRoutine, else that of the sections it is nested in, else the owning TLM's, else the covered curriculum's ancestry, so a document-specific routine finally has a home), and the formatters (every stack on the section's own path: its own, its parent sections', and the TLM's doc-wide one). find_node turns a NAME into ids (« le chapitre 5 » → the matching nodes, accent- and case-insensitive, each with its containment path): it is how an id is obtained, so a user is never asked for one; when several match it says `ambiguous` and you ask which. namespace_stats is a cheap, argument-free orientation snapshot (node/edge counts, roots, draft state) — run it FIRST to see the shape of the graph before writing a walk; its `roots` (each with id + labels + description) surfaces the Course content roots AND the TLM document roots, so it replaced list_courses. export_graph_view returns a SELF-CONTAINED scoped slice (the containment subtree of a node) in the explorer's DisplayGraph shape — feed it to a self-contained HTML artifact to render the same interactive tree the live explorer shows; published slot only, self-bounded to the response cap.",
  };
}

/*
 * The subject profile as authored config (phase 2b). `canEdit`
 * mirrors the SAME apply gate any draft edit enforces (actions.canEditDraft →
 * authorize(actor, "apply", ns)) and cannot drift.
 */
export function profileSection(actions: Actions) {
  return {
    source: "store",
    editable: true,
    canEdit: actions.canEditDraft,
    tools: ["get_profile", "get_graph_guide", "edit_profile", "review_draft"],
    note:
      "The subject profile is a { core, guide } record: the machine `core` (config that drives parsing) plus an authored `guide` markdown the authoring/generating LLM reads to interpret and modify the graph (phase 2c — reads consume only the core; the guide never sits on the read hot path). It is AUTHORED DATA in the store's config cell: get_profile reads the record, get_graph_guide reads just the guide markdown (call it before you walk/edit the graph), and edit_profile replaces the record through the two-phase draft/publish loop — the core validated against its schema and the guide length-checked at authoring time, so a change needs no redeploy. It rides the SAME draft as curriculum edits — diff_draft/publish_draft surface a staged profile change as `profileDiff`. review_draft is a read-only pre-publish check that bundles the guide's coverage expectations with a subject-agnostic structural snapshot for the model to reason over.",
  };
}

/*
 * The mechanical wiring lint. `available` mirrors the SAME draft-read
 * gate check_draft enforces (actions.canReadDraft) when a draft is open; with no
 * draft it reads published and is open to anyone who can read.
 */
export function checksSection(actions: Actions) {
  return {
    tool: "check_draft",
    // The three checkers, and the line between them. Stated here because the
    // commonest mistake is to run one and believe the draft is checked.
    checkers: {
      check_draft: "WIRING — is it connected? Mechanical, subject-agnostic.",
      lint_content: "CONSISTENCY — do the authored statements contradict each other? A declared total against the sum of its parts, a cited id that resolves to nothing, declared values against the prose beside them.",
      review_draft: "COVERAGE — does it teach what the subject guide expects? A judgement the model makes, not the server.",
    },
    contentLint: {
      tool: "lint_content",
      rules: lintableRules().map((rule) => ({ id: rule.id, summary: rule.summary })),
      // What cannot run yet, so a caller does not assume everything is checked.
      pending: CONTENT_RULES.filter((rule) => rule.requires !== "graph").map((rule) => ({ id: rule.id, needs: rule.requires })),
      scopes: ["subject", "catalog", "all"],
      defaultScope: "all",
      suppression: "metadata.lintIgnore: [\"rule-id\"] on the node silences one rule there — data, so it needs no deploy",
    },
    availableOnDraft: actions.canReadDraft,
    // The rules, named so a caller can anticipate them. They are WIRING only —
    // "is this connected?" — never a judgment about what the subject teaches.
    rules: [
      "document-covers-nothing", "document-has-no-formatter",
      "section-covers-nothing", "section-outside-document",
      "routine-unused", "isolated-node",
    ],
    // The payload is English; the model relays it in the expert's working language.
    reportedIn: "the user's working language (payload is English)",
    note:
      "check_draft reports the MECHANICAL failures that are otherwise silent: a document covering no curriculum (it would generate empty), a document with no formatter, a section outside any document, a routine nothing uses, a node connected to nothing. Findings are French, each with a `fix`, and tagged `inThisDraft`. The same warnings ride publish_draft's dry-run as `checks`, scoped to the nodes the draft touched — they never block. Its sibling is review_draft, which judges COVERAGE from the guide's prose; the split is deliberate and check_draft must never grow a coverage rule.",
  };
}

/*
 * The in-product help surface (self-serve-authoring.md, phase 2).
 * All of it is authored TEXT — no gate to mirror — so this block advertises what
 * exists rather than what the caller may do.
 */
export function guidanceSection() {
  return {
    tools: ["start_here", "get_graph_guide"],
    prompts: ["creer-document", "appliquer-style", "creer-routine", "preparer-relecture"],
    // Every write response carries the steps that usually follow it.
    nextStepsOnWrites: true,
    language: "French",
    note:
      "start_here answers 'where am I and what should I do next' for a PERSON (this tool answers 'what is possible' for a machine): active context or the list to choose from, the caller's role in plain terms, whether a draft is open, the unfinished work, and suggested next moves — and it works before set_context. The connector also publishes named workflow PROMPTS a client can surface as a menu (créer un document, appliquer un style, créer une routine, préparer une relecture). Every write response carries `nextSteps`, the sequence that usually follows. Language rule for all of it: these payloads are English, but they are for a PERSON — relay them in the expert's own working language, the one this subject's curriculum and guide are written in (French for Senegal, English for the EIDU frameworks). Vocabulary rule: speak the expert's words — document, section, chapter, objective — never TLM/SFI/hasPart, and never ask a user for a node id (use find_node).",
  };
}
