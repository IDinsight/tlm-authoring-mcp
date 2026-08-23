/*
 * Module: server · tool group: get_capabilities
 *
 * A read-only mirror of what the current caller can do RIGHT NOW: role,
 * allowed actions, whether a draft exists, what's editable, and the safety
 * rules in force. Never a second source of truth — every field is sourced
 * from the module that ACTUALLY enforces or defines it:
 *
 *   actor.role           ← currentActor()               (from #1's verified JWT)
 *   actions.*            ← authorize(actor, X, ns)      (from #8, the real gate)
 *   draft.exists         ← store.readPointer()           (from #4)
 *   draft.createdBy      ← store.listAudit()             (from #7)
 *   editable.recipes     ← RECIPES                       (the generic edit verbs)
 *   rules.structural     ← STRUCTURAL_RULES              (from #6)
 *
 * Any calculation of "who can do what" done here would be a copy that could
 * drift. The mirror-property test asserts every actions.* value matches
 * what authorize() returns for the same (actor, action, namespace).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asJson, guarded } from "./shared.js";
import { getActiveAdapter } from "../adapters/index.js";
import { activeWorkspace } from "../context/index.js";
import { currentActor } from "../actor.js";
import { authorize, effectiveRole, type AuthAction } from "../authz.js";
import {
  kgNamespace, getKgStore, STRUCTURAL_RULES,
} from "../kg-store/index.js";
import { RECIPES, SHARED_CATALOG_NAMESPACE, catalogNamespace } from "../kg-recipes/index.js";
import { KIND_PROPERTIES } from "./authoring.js";

// The five actions this server has today. Kept as a const-tuple so the
// response shape is stable and the mirror-property test can iterate over
// the same set the tool reports.
const CAPABILITY_ACTIONS = [
  "canReadGenerate",  // reads and generation are ungated (no authorize() call needed)
  "canReadDraft",     // #9's diff_draft
  "canPreview",       // preview_generation (draft-resolved) — same tier as readDraft
  "canEditDraft",     // the apply gate for every draft edit (recipes / structural / typed adds)
  "canDiscardDraft",  // #9's discard_draft
  "canPublish",       // #9's publish_draft
  "canReadAudit",     // #16's read_audit — approver-only, same tier as publish
] as const;

// Map each capability action to the underlying authz action name, when
// authorize() is what gates it. `canReadGenerate` has no gate — reads are
// open to unknown actors too.
const CAPABILITY_TO_AUTHZ: Record<Exclude<typeof CAPABILITY_ACTIONS[number], "canReadGenerate">, AuthAction> = {
  canReadDraft: "readDraft",
  canPreview: "readDraft",   // previewing reads the unpublished draft — same trust tier
  canEditDraft: "apply",
  canDiscardDraft: "discard",
  canPublish: "publish",
  canReadAudit: "readAudit",  // reviewing the append-only trail — approver-only
};

// The inner logic, exported so tests can drive it without spinning up an
// McpServer. `registerCapabilityTools` just wraps this in the MCP tool
// envelope.
export async function buildCapabilitiesReport(): Promise<Record<string, unknown>> {
  const adapter = getActiveAdapter();
  const namespace = kgNamespace(activeWorkspace(), adapter.grade, adapter.subject);
  const actor = currentActor();

  // ── actions: one call per gated action to authorize(). Reads are
  // ungated — always true. Zero role-mapping logic lives here.
  const actions: Record<string, boolean> = {
    canReadGenerate: true,
  };
  for (const [cap, authAction] of Object.entries(CAPABILITY_TO_AUTHZ)) {
    actions[cap] = authorize(actor, authAction, namespace).ok;
  }

  // ── draft: pointer says exists/not. If it exists, the most recent
  // createDraft audit record names its creator (from #7).
  const store = getKgStore();
  const pointer = await store.readPointer(namespace);
  const draftExists = !!pointer?.draftSlot;
  let createdBy: { id: string; email: string | null; role: string | null; ts: string } | undefined;
  if (draftExists) {
    const [mostRecentCreate] = await store.listAudit({ namespace, eventType: "createDraft", limit: 1 });
    if (mostRecentCreate) {
      createdBy = {
        id: mostRecentCreate.actor.id,
        email: mostRecentCreate.actor.email,
        role: mostRecentCreate.actor.role,
        ts: mostRecentCreate.ts,
      };
    }
  }

  // ── editable: the edit surface. `typedAdds` are the typed node-creation
  // tools; `structural` describes the four raw verbs a curator has for growing /
  // connecting / detaching / pruning the graph (they observe the current graph's
  // vocabulary rather than a schema).
  // ── recipes: a MIRROR of the generic recipe registry (reposition / set_content).
  // Rendered straight from RECIPES so what Claude discovers cannot drift from what
  // is built. Node CREATION is the typed authoring tools (see `typedAdds`).
  const recipes = {
    available: true,
    note: "Generic composite mutations over canonical LC: one intent → one diff → one confirmation token → one atomic draft write → one audit event. edit_node edits a node's content / position / title in place (it replaced set_content + reposition and added title editing). Node creation is add_nodes (see editable.batch); re-parenting is move_node.",
    list: RECIPES.map((r) => ({ name: r.name, summary: r.summary, params: r.params })),
  };

  const editable = {
    scope: "batched node/edge authoring + generic recipes",
    note:
      "Nodes are created via `add_nodes` (one or many — see `batch`, with the per-kind property catalog in `batch.kindProperties`); edges via `create_edges` (one or many); deletions via delete_edges / delete_nodes (see `structural.verbs`); a node's content / position / title are edited in place via `edit_node` (see `recipes`).",
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
        add_section: "wires BOTH of a section's axes together — `hasPart` from the document and `covers` to the curriculum (omit `covers` only for front matter)",
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

  // ── lifecycle: the draft promotion / discard / undo tools and their response
  // controls, advertised so callers can feature-detect returnMode (mirrors
  // editable.batch). The role gates live in actions.canPublish /
  // actions.canDiscardDraft — this block is about response SHAPE, not authz.
  const lifecycle = {
    tools: ["publish_draft", "discard_draft", "undo_last"],
    params: ["returnMode"],
    returnModes: ["summary", "full"],
    defaultReturnMode: "summary",
    note:
      "publish_draft promotes the draft to live; discard_draft throws it away. Both are two-phase (dry-run → confirmationToken → confirm). returnMode defaults to 'summary' — a compact `counts` object (plus `warnings`, verbatim, on publish) instead of the whole-draft `diff`, which is 200+ KB on a large draft and can overflow the token cap and hide the confirmationToken; pass 'full' to also attach the diff (and any staged profileDiff). To inspect the full diff before promoting, call diff_draft — it is the diff endpoint; publish_draft/discard_draft return mutation summaries. Coverage warnings are preserved in BOTH modes: an approver must see them before publishing. undo_last is the per-EDIT counterpart to discard_draft: it takes back only the most recent staged edit (replaying that edit's recorded diff backwards) and leaves the rest of the draft standing, peeling back one edit per call. It is an ordinary draft edit — gated by actions.canEditDraft, not canDiscardDraft — and it refuses rather than merges when a later edit touched the same node.",
  };

  // ── rules: structural rules and confirm expectation. structural
  // is imported from validate.ts so a rule description change is one file.
  const rules = {
    structural: [...STRUCTURAL_RULES],
    confirmation:
      "Every write is two-phase: call the tool once without confirm to get a diff and a confirmationToken (no state change), then call again with confirm:true and the token to actually apply. Publish/discard tokens are checked against the current draft state — if the draft moved since the dry-run, the confirm is rejected.",
  };

  // ── preview: advertise the draft-resolved preview generation surface, so
  // Claude can proactively offer "want to see what this edit generates before
  // publishing?". `available` mirrors the same readDraft gate the tool enforces;
  // `hasDraft` says whether there is anything to preview right now.
  const preview = {
    available: actions.canPreview,
    hasDraft: draftExists,
    tools: ["preview_generation", "create_preview_upload_url"],
    note:
      "preview_generation resolves the generation context from the UNPUBLISHED draft (not published), scoped to whichever piece you name — a DocumentSection (one slot of a document), a TeachingLearningMaterial (a whole document), or a Course (its containment subtree), reported back as `previewOf` — so you can generate a PREVIEW of the material a staged edit would produce before publishing, at the size of the thing that changed rather than a whole chapter. It closes the loop with the dry-run: dry-run shows the graph DIFF, preview shows the resulting MATERIAL. Read-only on the draft (no graph change), curator + approver only. Preview .docx output goes through create_preview_upload_url to a SEGREGATED previews/ prefix with short-lived, clearly-labelled URLs — it never touches the canonical documents bucket, list_documents, or log_generation. With no draft open, preview_generation returns a clear 'no draft to preview' notice. Draft-vs-published output comparison is a deferred follow-on.",
  };

  // ── audit: advertise the approver-only, read-only audit reader (#16), so
  // Claude can offer "want to review who changed what?" to an approver.
  // `available` mirrors the SAME readAudit gate the tool enforces (via
  // actions.canReadAudit → authorize(actor, "readAudit", ns)) — it cannot drift.
  const audit = {
    available: actions.canReadAudit,
    tool: "read_audit",
    note:
      "read_audit is a filtered, paginated, READ-ONLY view of the append-only audit log for THIS namespace, newest-first. APPROVERS ONLY (same tier as publish); curators / no-role are blocked and the blocked read is itself audited. It cannot alter, redact, or reorder any record. Namespace-scoped: to review another namespace, set_context to it (there is no namespace argument). Filters: actor, action, outcome (applied|blocked), nodeId, since/until. Modes: 'summary' (compact, no before/after — the default) and 'detail' (full before/after; also for a specific auditId). Pagination via limit (default 25, max 100) + an opaque cursor. Each call appends ONE lightweight 'read' event (actor + query + timestamp + count) — never a before/after — so 'who reviewed history' stays answerable. It is deliberately a reader, not analytics.",
  };

  // ── catalog: advertise the reusable-spec catalog (both scopes). `browse`
  // (list_catalog) is an ungated read; `canUse` (use_routine) COPIES an entry onto a
  // lesson, so it mirrors the SAME apply gate any draft edit enforces
  // (actions.canEditDraft → authorize(actor, "apply", ns)) and cannot drift.
  const catalog = {
    browse: true,
    canUse: actions.canEditDraft,
    canAdd: actions.canPublish,
    // Editing an entry IN PLACE (the write verbs' `catalog` argument). Gated by the
    // PUBLISH policy rather than the apply one, exactly like canAdd: a catalog write
    // applies AND publishes in the same step, so approver+ is what actually decides.
    canEditEntries: actions.canPublish,
    editVerbs: ["edit_node", "add_nodes", "create_edges"],
    scopes: { shared: SHARED_CATALOG_NAMESPACE, workspace: catalogNamespace(activeWorkspace()) },
    tools: ["list_catalog", "get_catalog_entry", "use_routine", "use_formatter", "use_rubric", "add_to_catalog", "duplicate_entry"],
    canDuplicate: actions.canPublish,
    resources: ["catalog://{scope}/{id}"],
    // Where each kind of entry ATTACHES when applied — mirrors useRoutine / useFormatter / useRubric.
    applies: {
      routine: "Lesson, via usesRoutine",
      formatter: "TeachingLearningMaterial (the document), via hasPart",
      rubric: "TeachingLearningMaterial (the document), via hasPart",
    },
    note:
      "The catalog is a library of reusable instructional routines, formatters (house-style specs) and rubrics (evaluation grids), read across TWO scopes: the cross-tenant SHARED library and the active workspace's own. list_catalog browses both — each entry tagged scope (shared|workspace) + kind (routine|formatter|rubric) — an ungated read; get_catalog_entry reads ONE entry's FULL authored spec (the step/formatter Material content list_catalog only counts). The same full spec is also served as an MCP resource (catalog://{scope}/{id}) for clients with a resource browser; the tool exists so it works everywhere. use_routine / use_formatter APPLY an entry (from either scope) by COPYING it: the entry's whole subtree is cloned with fresh ids into the active subject's DRAFT, so the copy is independent and later edits to the library entry do not reach it. They attach differently — use_routine links a routine to a Lesson via usesRoutine; use_formatter relabels the copy to the document layer (Formatter/FormatterSpec) and hangs it under the document's TeachingLearningMaterial via hasPart (pass the TLM id, or a Course to resolve its TLM); use_rubric does the same one level deeper (Rubric/RubricSection/RubricCriterion), attaching the evaluation grid that evaluate_document then scores the produced document against. Formatting and evaluation are both properties of the DOCUMENT, not the curriculum, so neither rides a Course's usesRoutine edge. add_to_catalog is the write INVERSE: it clones a routine/formatter you authored in the active subject (an InstructionalRoutine + its steps/materials) INTO a catalog and PUBLISHES it live in one gated step — to your own workspace's library, or (super_admin only) the shared library or any workspace (omit targetWorkspace to get the choices). Because it publishes, it needs APPROVER+ in the destination workspace, or super_admin for the shared library (authorize(actor, 'publish', catalogNs) — the same policy publish_draft enforces, so it cannot drift). use_routine/use_formatter and add_to_catalog are all two-phase (dry-run returns diff + confirmationToken + a minted old→new id-map; confirm re-checks the token); the copies apply to the active draft, add_to_catalog applies-and-publishes the catalog. To CORRECT an entry already in a library (rather than file a new one), pass `catalog` to the generic write verbs — edit_node / add_nodes / create_edges / delete_nodes / delete_edges accept 'workspace', 'shared', or a workspace id and then write to that library instead of the active subject. delete_nodes with `catalog` is how an entry is RETIRED: name the entry id and its steps/Materials come along in the cascade. It carries add_to_catalog's two differences: the destination gate (super_admin to cross into another workspace's or the shared library) and applies-and-publishes on confirm, so `catalog` must be re-sent on the confirm. Copies already made from an entry are independent and do NOT pick the correction up — fix those in the subject graph separately. Seed a catalog namespace to populate it; it lists [] until then.",
  };

  // ── discovery: the generic read tools for exploring the graph. Both are
  // ungated reads; walk_graph's slot:"draft" mode is the one part that needs a
  // role, so `canWalkDraft` mirrors the SAME draft-read gate diff_draft enforces
  // (actions.canReadDraft) and cannot drift.
  const discovery = {
    tools: ["walk_graph", "walk_document", "walk_document_section", "find_node", "namespace_stats", "export_graph_view"],
    canWalkDraft: actions.canReadDraft,
    // Name → id resolution. It exists because a human never has an id to give
    // and this client renders no completion dropdown, so the SERVER resolves
    // what the expert types (self-serve-authoring.md, D9).
    findNode: {
      params: ["query", "labels", "limit", "slot"],
      defaults: { limit: 10 },
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
      // else the owning TLM's, else the covered curriculum's ancestry.
      routineResolution: "nearest-wins, document-first (section → owning TLM → covered curriculum's ancestry)",
    },
    exportGraphView: {
      params: ["fromId", "maxDepth", "detail"],
      defaults: { maxDepth: 4, detail: false },
      maxDepth: 12,
      // A slice too big to fit the response cap comes back as { tooLarge, counts, message }.
      overflow: "self-bounded — oversized detailed slice auto-drops detail; a still-too-big slice returns { tooLarge, message }",
    },
    note:
      "walk_graph is the single generic traversal: a directional (out/in/both), edge- and label-filtered, PAGINATED BFS from any node — use it to discover the framework root, a course subtree, a standards spine, anything. It replaced get_course. Page with limit (default 50, max 500) + nextCursor; do not raise the limit to fit a big result. truncatedByLimit means more nodes remain on further pages; truncated means the depth cap hid deeper nodes; truncatedBySize means a response BYTE budget trimmed the page below `limit` (raising limit won't help — set includeEdges:false and narrow nodeTypes, then page via cursor; the `hint` field says so). slot:'published' (default) reads live; slot:'draft' inspects UNPUBLISHED staged edits (curator/approver only). walk_document is the document-side counterpart: given a TeachingLearningMaterial (TLM) root it returns that document's assemblyGuide, its Formatter/FormatterSpec rendering stack, its DocumentSection spine, and the curriculum it renders (resolved by section spine or a TLM→covers→Course fallback — `scope` says which), so generation targets the document, not the raw curriculum. walk_document_section is the PER-PIECE generation entry, anchored on ONE DocumentSection — the node that already IS the document↔curriculum binding (it hangs under exactly one TLM and covers its curriculum), so it is the unit generation produces a document from, section by section: it returns the owning document, the curriculum the section renders, the routine that applies (nearest-wins, document-first — the section's own usesRoutine, else the owning TLM's, else the covered curriculum's ancestry, so a document-specific routine finally has a home), and the formatters (the TLM's doc-wide stack unioned with the section's own). find_node turns a NAME into ids (« le chapitre 5 » → the matching nodes, accent- and case-insensitive, each with its containment path): it is how an id is obtained, so a user is never asked for one; when several match it says `ambiguous` and you ask which. namespace_stats is a cheap, argument-free orientation snapshot (node/edge counts, roots, draft state) — run it FIRST to see the shape of the graph before writing a walk; its `roots` (each with id + labels + description) surfaces the Course content roots AND the TLM document roots, so it replaced list_courses. export_graph_view returns a SELF-CONTAINED scoped slice (the containment subtree of a node) in the explorer's DisplayGraph shape — feed it to a self-contained HTML artifact to render the same interactive tree the live explorer shows; published slot only, self-bounded to the response cap.",
  };

  // ── profile: the subject profile as authored config (phase 2b). `canEdit`
  // mirrors the SAME apply gate any draft edit enforces (actions.canEditDraft →
  // authorize(actor, "apply", ns)) and cannot drift.
  const profile = {
    source: "store",
    editable: true,
    canEdit: actions.canEditDraft,
    tools: ["get_profile", "get_graph_guide", "edit_profile", "review_draft"],
    note:
      "The subject profile is a { core, guide } record: the machine `core` (config that drives parsing) plus an authored `guide` markdown the authoring/generating LLM reads to interpret and modify the graph (phase 2c — reads consume only the core; the guide never sits on the read hot path). It is AUTHORED DATA in the store's config cell: get_profile reads the record, get_graph_guide reads just the guide markdown (call it before you walk/edit the graph), and edit_profile replaces the record through the two-phase draft/publish loop — the core validated against its schema and the guide length-checked at authoring time, so a change needs no redeploy. It rides the SAME draft as curriculum edits — diff_draft/publish_draft surface a staged profile change as `profileDiff`. review_draft is a read-only pre-publish check that bundles the guide's coverage expectations with a subject-agnostic structural snapshot for the model to reason over.",
  };

  // ── checks: the mechanical wiring lint. `available` mirrors the SAME draft-read
  // gate check_draft enforces (actions.canReadDraft) when a draft is open; with no
  // draft it reads published and is open to anyone who can read.
  const checks = {
    tool: "check_draft",
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

  // ── guidance: the in-product help surface (self-serve-authoring.md, phase 2).
  // All of it is authored TEXT — no gate to mirror — so this block advertises what
  // exists rather than what the caller may do.
  const guidance = {
    tools: ["start_here", "get_graph_guide"],
    prompts: ["creer-document", "appliquer-style", "creer-routine", "preparer-relecture"],
    // Every write response carries the steps that usually follow it.
    nextStepsOnWrites: true,
    language: "French",
    note:
      "start_here answers 'where am I and what should I do next' for a PERSON (this tool answers 'what is possible' for a machine): active context or the list to choose from, the caller's role in plain terms, whether a draft is open, the unfinished work, and suggested next moves — and it works before set_context. The connector also publishes named workflow PROMPTS a client can surface as a menu (créer un document, appliquer un style, créer une routine, préparer une relecture). Every write response carries `nextSteps`, the sequence that usually follows. Language rule for all of it: these payloads are English, but they are for a PERSON — relay them in the expert's own working language, the one this subject's curriculum and guide are written in (French for Senegal, English for the EIDU frameworks). Vocabulary rule: speak the expert's words — document, section, chapter, objective — never TLM/SFI/hasPart, and never ask a user for a node id (use find_node).",
  };

  return {
    actor: {
      id: actor.id,
      isKnown: !actor.unknown,
      role: actor.role ?? null,          // legacy global claim (may be null)
      superAdmin: !!actor.superAdmin,
      effectiveRole: effectiveRole(actor, activeWorkspace()) ?? null, // role in THIS workspace
    },
    context: {
      workspace: activeWorkspace(),
      grade: adapter.grade,
      subject: adapter.subject,
      namespace,
    },
    actions,
    draft: {
      exists: draftExists,
      createdBy,
    },
    discovery,
    guidance,
    editable,
    checks,
    lifecycle,
    profile,
    preview,
    audit,
    catalog,
    rules,
    // The universal response-size backstop every tool passes through: a payload
    // over the cap is replaced by a small RESPONSE_TOO_LARGE envelope (isError).
    // Advertised so a caller can feature-detect it and knows to paginate/narrow.
    responseCap: {
      maxBytes: Number(process.env.TLM_MAX_RESPONSE_BYTES) > 0 ? Number(process.env.TLM_MAX_RESPONSE_BYTES) : 100 * 1024,
      overflowCode: "RESPONSE_TOO_LARGE",
      envVar: "TLM_MAX_RESPONSE_BYTES",
      note: "Every tool response is capped. Well-behaved reads paginate (walk_graph, get_document_text, list_documents, read_audit, diff_draft limit) and never approach it; an oversized response returns { error: { code: 'RESPONSE_TOO_LARGE', bytes, cap }, shape, hint } instead of the payload.",
    },
  };
}

export function registerCapabilityTools(server: McpServer) {
  server.registerTool(
    "get_capabilities",
    {
      title: "What can I do right now?",
      description:
        "Report — for the currently-authenticated caller and the active grade/subject — the caller's role, exactly which write actions they may perform, whether a draft is currently open, and what wording keys are editable in the pilot. Read-only, no state change, safe for unknown callers (returns a truthful 'read/generate only' shape rather than erroring). Every field is derived from the same functions that actually ENFORCE the behavior — so this tool cannot diverge from what other tools will actually let you do.",
      inputSchema: {},
    },
    guarded(async () => asJson(await buildCapabilitiesReport())),
  );
}
