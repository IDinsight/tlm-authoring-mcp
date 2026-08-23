/*
 * Layer: app · module: server
 *
 * Front door of the server module: assemble the MCP server from the tool groups.
 * The tool groups are the only layer that reads the active adapter (via
 * getActiveAdapter) and dispatches to it, so the service modules stay unaware
 * of the adapter layer.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerContextTools } from "./context.js";
import { registerWorkspaceTools } from "./workspaces.js";
import { registerCurriculumTools } from "./curriculum.js";
import { registerTranslationTools } from "./translation.js";
import { registerGlossaryTools } from "./glossary.js";
import { registerGraphTools } from "./graph.js";
import { registerPreviewTools } from "./preview.js";
import { registerDocumentTools } from "./documents.js";
import { registerLifecycleTools } from "./lifecycle.js";
import { registerStructuralTools } from "./structural.js";
import { registerRecipeTools } from "./recipes.js";
import { registerAuthoringTools } from "./authoring.js";
import { registerProfileTools } from "./profile.js";
import { registerCatalogTools, registerCatalogResources } from "./catalog.js";
import { registerEvaluationTools } from "./evaluate.js";
import { registerCapabilityTools } from "./capabilities.js";
import { registerAuditTools } from "./audit.js";
import { registerHealthTools } from "./health.js";
import { registerStartHereTools } from "./start-here.js";
import { registerCheckTools } from "./check.js";
import { registerDocumentAuthoringTools } from "./document-authoring.js";
import { registerAuthoringPrompts } from "./prompts.js";
import { registerUndoTools } from "./undo.js";
import { registerReviewTools } from "./review.js";

export function buildServer(): McpServer {
  const server = new McpServer({ name: "tlm-authoring-server", title: "Teaching & Learning Materials authoring", version: "0.4.0" });
  registerHealthTools(server);       // ping (no datastore — transport liveness probe)
  registerStartHereTools(server);    // start_here (French orientation: where am I, what can I do, what is unfinished)
  registerContextTools(server);      // set_context, get_context
  registerWorkspaceTools(server);    // list_workspaces, create_workspace, add/remove/list_member (tenant admin)
  registerCurriculumTools(server);   // get_standards (generic node reader), terminology
  registerTranslationTools(server);  // translate (FR↔Wolof via Gemini, glossary-grounded)
  registerGlossaryTools(server);     // add_terms, edit_term, remove_terms (workspace bilingual lexicon)
  registerGraphTools(server);        // walk_graph (generic BFS traversal), namespace_stats (orientation snapshot)
  registerPreviewTools(server);      // preview_generation, create_preview_upload_url (draft-resolved, isolated from published)
  registerDocumentTools(server);     // reconcile, upload/download, record/log
  registerLifecycleTools(server);    // diff_draft, publish_draft, discard_draft
  registerUndoTools(server);         // undo_last (take back ONE staged edit — the per-edit counterpart to discard_draft)
  registerReviewTools(server);       // request_review (the curator→approver handoff, derived from the audit trail)
  registerCheckTools(server);        // check_draft (structural WIRING lint in French — review_draft's mechanical sibling)
  registerStructuralTools(server);   // create_edges, delete_edges, delete_nodes (edge + deletion verbs)
  registerRecipeTools(server);       // edit_node (content / position / title edits — replaced reposition + set_content)
  registerAuthoringTools(server);    // add_nodes (the single node-creation tool — one or many; replaced the per-label typed adds)
  registerDocumentAuthoringTools(server); // create_document, add_section (task verbs that enforce a multi-element invariant a primitive can silently violate)
  registerProfileTools(server);      // get_profile, edit_profile (subject profile as authored config — phase 2b)
  registerCatalogTools(server);      // list_catalog, get_catalog_entry, use_routine, use_formatter, use_rubric (catalog — browse + copy a routine onto a Lesson / a formatter or evaluation rubric under a document TLM)
  registerEvaluationTools(server);   // evaluate_document (score a generated document against the rubrics attached to it — the document-side review_draft)
  registerCatalogResources(server);  // catalog://{scope}/{id} — browse entries as resources, each with its full authored spec (D5)
  registerCapabilityTools(server);   // get_capabilities (read-only mirror of what the caller can do)
  registerAuditTools(server);        // read_audit (approver-only, read-only reader over the append-only audit log)
  registerAuthoringPrompts(server);  // the named French workflows a client surfaces as a menu (Rung 4)
  return server;
}
