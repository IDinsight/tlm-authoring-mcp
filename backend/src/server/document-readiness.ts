/*
 * Tool: check_document — is a document ready to be produced?
 *
 * The one-place answer to a question that used to be found piecemeal (a render
 * refusing, a thin review, a wiring lint). It reports and blocks nothing
 * (curriculum/readiness.ts); each gap names the verb that closes it.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { asJson, guarded } from "./shared.js";
import { getActiveAdapter } from "../adapters/index.js";
import { activeWorkspace } from "../context/index.js";
import { kgNamespace } from "../kg-store/index.js";
import { documentReadiness, resolveRef, type FoundNode } from "../curriculum/index.js";
import { readActiveGraphWithSlot } from "./catalog.js";
import { withContextOverride, contextField, type WithContext } from "./context-override.js";
import { resolveDraftModel, denyIfNotDraftReader } from "./preview.js";

const DOCUMENT_LABELS = ["TeachingLearningMaterial"];

type CheckDocumentArgs = WithContext & {
  document?: string;   // the document, by name (or id)
};

function activeNamespace(): string {
  const adapter = getActiveAdapter();
  return kgNamespace(activeWorkspace(), adapter.grade, adapter.subject);
}

async function checkResolved(a: CheckDocumentArgs): Promise<Record<string, unknown>> {
  const ns = activeNamespace();
  const denied = await denyIfNotDraftReader(ns);
  if (denied) return denied;
  if (!a.document) return { error: "`document` is required: the name of the document to check (namespace_stats lists the document roots)." };

  const { graph } = await readActiveGraphWithSlot(ns);
  const resolved = resolveRef(graph, a.document, { labels: DOCUMENT_LABELS });
  if (!resolved.ok) {
    return resolved.reason === "none"
      ? { error: `Nothing matches « ${a.document} » among the documents. namespace_stats lists the document roots by name.` }
      : { needsChoice: true, message: `Several documents match « ${a.document} »: ask which, quoting each candidate's path, then call again with that candidate's id.`, candidates: resolved.candidates as FoundNode[] };
  }

  const draft = await resolveDraftModel(ns);
  const model = draft?.model ?? getActiveAdapter().model();
  const readFrom = draft ? "draft" : "published";

  const report = documentReadiness(model, resolved.id);
  if (!report) return { error: `'${resolved.id}' is not a document in the ${readFrom} graph.` };

  const missing = report.checks.filter((c) => c.status === "missing");
  return {
    namespace: ns,
    readFrom,
    ...report,
    summary: report.ready
      ? `« ${report.document.title} » can be produced: it covers curriculum, has sections, a formatter and layout settings.${report.checks.some((c) => c.status === "info") ? " The info lines are optional pieces it does not have yet." : ""}`
      : `« ${report.document.title} » cannot be produced yet: ${missing.map((c) => c.id).join(", ")} missing. Each line names the verb that closes it.`,
  };
}

export async function runCheckDocument(a: CheckDocumentArgs): Promise<Record<string, unknown>> {
  return withContextOverride(a.context, () => checkResolved(a)) as Promise<Record<string, unknown>>;
}

export function registerDocumentReadinessTools(server: McpServer) {
  server.registerTool(
    "check_document",
    {
      title: "Is this document ready to be produced?",
      description:
        "ONE report for a document, by NAME: does it cover curriculum, does it have sections, a formatter, layout settings (`render`) the renderer and the page check need, page templates (`layout`) for compose_section, an evaluation grid, a routine. Each line is ok / missing / info, and a gap names the verb that closes it (create_document, add_section, use_formatter, edit_nodes properties.render or properties.layout, use_rubric, use_routine). " +
        "`ready:true` means the document CAN be produced — it covers something, has sections, a formatter and layout settings; the info lines are optional pieces. It reports and blocks nothing: whether to produce without a grid or without templates is the person's call. Reads the graph's shape only, so it holds for any document in any workspace. " +
        "Reads the DRAFT when one is open, PUBLISHED otherwise (`readFrom`). Run it after composing a document and before producing it. Curators and approvers only.",
      inputSchema: {
        document: z.string().optional(),
        ...contextField,
      },
    },
    guarded(async (a: CheckDocumentArgs) => asJson(await runCheckDocument(a))),
  );
}
