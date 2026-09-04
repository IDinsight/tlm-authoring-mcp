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
 *   rules.confirmation   ← CONFIRMATION_RULE            (from shared.ts, the gate)
 *
 * Any calculation of "who can do what" done here would be a copy that could
 * drift. The mirror-property test asserts every actions.* value matches
 * what authorize() returns for the same (actor, action, namespace).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { asJson, guarded } from "./shared.js";
import { getActiveAdapter } from "../adapters/index.js";
import { activeWorkspace } from "../context/index.js";
import { currentActor } from "../actor.js";
import { authorize, effectiveRole, type AuthAction } from "../authz.js";
import { kgNamespace, getKgStore } from "../kg-store/index.js";
import {
  type Actions,
  recipesSection, editableSection, lifecycleSection, rulesSection, guidanceSection,
  previewSection, documentSection, auditSection, documentsSection, catalogSection,
  discoverySection, profileSection, checksSection,
} from "./capabilities-sections.js";

// The actions this server has today. Kept as a const-tuple so the response
// shape is stable and the mirror-property test can iterate over the same set
// the tool reports.
const CAPABILITY_ACTIONS = [
  "canReadGenerate",  // published curriculum reads are ungated — no membership, no authorize() call
  "canReadDraft",     // #9's diff_draft
  "canPreview",       // preview_generation (draft-resolved) — same tier as readDraft
  "canEditDraft",     // the apply gate for every draft edit (recipes / structural / typed adds)
  "canDiscardDraft",  // #9's discard_draft
  "canPublish",       // #9's publish_draft
  "canReadAudit",     // #16's read_audit — approver-only, same tier as publish
  "canReadDocuments", // the bucket + history reads — members only, though the curriculum is open
  "canWriteDocuments",// create_upload_url / log_generation / record_document_content — live, no undo
  "canTranslate",     // the Gemini-backed translator — members only (it is metered)
] as const;

// Map each capability action to the underlying authz action name, when
// authorize() is what gates it. `canReadGenerate` has no gate — the published
// curriculum is open to everyone, members and non-members alike.
const CAPABILITY_TO_AUTHZ: Record<Exclude<typeof CAPABILITY_ACTIONS[number], "canReadGenerate">, AuthAction> = {
  canReadDraft: "readDraft",
  canPreview: "readDraft",   // previewing reads the unpublished draft — same trust tier
  canEditDraft: "apply",
  canDiscardDraft: "discard",
  canPublish: "publish",
  canReadAudit: "readAudit",  // reviewing the append-only trail — approver-only
  canReadDocuments: "readDocuments",
  canWriteDocuments: "writeDocuments",
  canTranslate: "translate",
};

// Flatten the per-block {allowed, tools} groups into the sorted, de-duplicated
// list of tools the caller may call. A tool named in two groups (a read that is
// also listed under its feature) is kept when ANY group allows it.
function collectPermittedVerbs(groups: Array<{ allowed: boolean; tools: readonly string[] }>): string[] {
  const permitted = new Set<string>();
  for (const group of groups) {
    if (!group.allowed) {
      continue;
    }
    for (const tool of group.tools) {
      permitted.add(tool);
    }
  }
  return [...permitted].sort();
}

// The inner logic, exported so tests can drive it without spinning up an
// McpServer. `registerCapabilityTools` just wraps this in the MCP tool
// envelope. It always builds the WHOLE report; what a CALLER sees is chosen by
// projectCapabilities below, so a section can never report something the full
// report does not (the mirror property holds for every projection of it).
export async function buildCapabilitiesReport(): Promise<Record<string, unknown>> {
  const adapter = getActiveAdapter();
  const namespace = kgNamespace(activeWorkspace(), adapter.grade, adapter.subject);
  const actor = currentActor();

  // ── actions: one call per gated action to authorize(). Reads are
  // ungated — always true. Zero role-mapping logic lives here.
  const actions: Actions = {
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

  // ── The body. Each section is built by its own function in
  // capabilities-sections.ts; the ones taking `actions` are mirroring a gate,
  // never deciding one. Read this list as the report's table of contents.
  const recipes = recipesSection();
  const editable = editableSection(recipes);
  const lifecycle = lifecycleSection();
  const rules = rulesSection();
  const guidance = guidanceSection();
  const preview = previewSection(actions, draftExists);
  const document = documentSection(actions);
  const audit = auditSection(actions);
  const documents = documentsSection(actions);
  const catalog = catalogSection(actions);
  const discovery = discoverySection(actions);
  const profile = profileSection(actions);
  const checks = checksSection(actions);

  // ── verbs: the flat list of tools this caller may actually call right now.
  // Each group pairs a block's OWN tool list with the gate that block already
  // reports, so a tool added to a block is picked up here without a second list
  // to keep in sync. It is a projection of `actions`, never a new judgement.
  const permittedVerbs = collectPermittedVerbs([
    { allowed: true, tools: discovery.tools },
    { allowed: true, tools: guidance.tools },
    { allowed: true, tools: [checks.tool, editable.coverage.tool, ...profile.tools] },
    { allowed: actions.canEditDraft, tools: [...editable.batch.tools, ...editable.structural.verbs, ...editable.documents.tools, ...recipes.list.map((recipe) => recipe.name)] },
    { allowed: actions.canEditDraft, tools: ["use_routine", "use_formatter", "use_rubric"] },
    { allowed: true, tools: ["list_catalog", "get_catalog_entry"] },
    { allowed: actions.canPublish, tools: ["add_to_catalog", "duplicate_entry"] },
    { allowed: actions.canReadDraft, tools: ["diff_draft"] },
    { allowed: actions.canDiscardDraft, tools: ["discard_draft"] },
    { allowed: actions.canPublish, tools: ["publish_draft"] },
    { allowed: actions.canEditDraft, tools: ["undo_last", "request_review"] },
    { allowed: actions.canPreview, tools: preview.tools },
    { allowed: document.available, tools: document.tools },
    { allowed: actions.canReadAudit, tools: [audit.tool] },
    { allowed: actions.canReadDocuments, tools: documents.readTools },
    { allowed: actions.canWriteDocuments, tools: documents.writeTools },
    { allowed: actions.canTranslate, tools: ["translate"] },
  ]);

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
    verbs: permittedVerbs,
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
    document,
    audit,
    catalog,
    documents,
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
// ── The response projection (WP2a's sibling: WP2b) ───────────────────────────
// The whole report is ~26.5 KB / ~7,200 tokens, and it is called at the start of
// nearly every session. It is excellent documentation and ruinous as a preamble,
// so the DEFAULT is a digest — who you are, where you are, what you may call —
// and the detail for one area is asked for by name. Nothing is unreachable: the
// sections below partition the full report.

// The blocks a caller can ask for. Each name is a key of the full report, so
// `section` cannot name something that does not exist.
export const CAPABILITY_SECTIONS = [
  "discovery", "guidance", "editable", "checks", "lifecycle",
  "profile", "preview", "document", "audit", "catalog", "documents", "rules", "responseCap",
] as const;

export type CapabilitySection = typeof CAPABILITY_SECTIONS[number];

// The digest's own keys — the orientation a caller needs before it knows which
// section to ask for.
const DIGEST_KEYS = ["actor", "context", "actions", "draft", "verbs"] as const;

/**
 * Project the full report down to what the caller asked for: one named section,
 * or (by default) the digest plus the list of sections available.
 *
 * An unknown section name is answered with the digest and the valid names rather
 * than an error — the caller can act on that in one turn.
 */
export function projectCapabilities(report: Record<string, unknown>, section?: string): Record<string, unknown> {
  const digest = Object.fromEntries(DIGEST_KEYS.map((key) => [key, report[key]]));

  const isKnownSection = CAPABILITY_SECTIONS.includes(section as CapabilitySection);
  if (section !== undefined && isKnownSection) {
    return { ...digest, section, [section]: report[section] };
  }

  return {
    ...digest,
    sections: [...CAPABILITY_SECTIONS],
    ...(section !== undefined
      ? { note: `'${section}' is not a section of this report. Call again with one of \`sections\`.` }
      : {}),
    note2: "Digest only. `verbs` is every tool you may call right now; `actions` is why. For the detail on one area — its tools, defaults, limits and rules — call again with section:'<name>' from `sections`.",
  };
}

export function registerCapabilityTools(server: McpServer) {
  server.registerTool(
    "get_capabilities",
    {
      title: "What can I do right now?",
      description:
        "Report — for the authenticated caller and the active grade/subject — who they are, which actions they may perform, whether a draft is open, and the flat list of tools they may call (`verbs`). Read-only, safe for unknown callers (a truthful read-only shape, not an error). Every field derives from the functions that actually ENFORCE the behaviour, so it cannot diverge from what the other tools will let you do. " +
        "Returns a DIGEST by default (~2 KB). The full report is ~26 KB, so the per-area detail is asked for: pass `section` — one of discovery, guidance, editable, checks, lifecycle, profile, preview, audit, catalog, documents, rules, responseCap — to get that area's tools, defaults, limits and rules. `sections` in the digest lists them.",
      inputSchema: { section: z.string().optional() },
    },
    guarded(async (a: { section?: string }) => {
      const report = await buildCapabilitiesReport();
      return asJson(projectCapabilities(report, a.section));
    }),
  );
}
