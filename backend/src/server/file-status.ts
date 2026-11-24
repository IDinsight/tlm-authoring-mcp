/*
 * Module: server · tool group: file status
 *
 * `record_file_verdict` — a person approves a produced file, or sends it back.
 *
 * It is the only way a file reaches 'approved' or 'changes_requested'; the other
 * statuses (produced, replaced, unfiled) follow from recording files and are
 * never set by hand. Full rationale: docs/design-notes/file-status.md.
 */
import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { currentActor } from "../actor.js";
import { getActiveAdapter } from "../adapters/index.js";
import { authorize } from "../authz.js";
import { activeWorkspace } from "../context/index.js";
import { getKgStore, kgNamespace, nextAuditSeq, toAuditActor } from "../kg-store/index.js";
import { staleness } from "../render/index.js";
import { FILE_VERDICTS, getEntry, recordVerdicts, type FileVerdictResult } from "../storage/index.js";
import type { FileVerdict } from "../types.js";
import { buildConfirmEnvelope } from "../utils/index.js";
import { contextField, withContextOverrideResult, type WithContext } from "./context-override.js";
import { NAMESPACE_NOTE, describePaths, pathsOf, pathsShape, type PathsArgs } from "./documents.js";
import { auditFileEvent, currentFilePerson } from "./file-audit.js";
import { denyUnlessMember } from "./membership.js";
import { asJson, guarded, toolError, type ToolResult } from "./shared.js";
import { WRITES } from "./tool-effects.js";
import { WORKSPACE_ROLE_NOTE } from "./tool-notes.js";

function activeNamespace(): string {
  const adapter = getActiveAdapter();
  return kgNamespace(activeWorkspace(), adapter.grade, adapter.subject);
}

/**
 * Refuse an approval from anyone below approver, and leave a trace of the
 * attempt — the same shape and the same audit a refused publish leaves.
 */
async function denyUnlessApprover(namespace: string): Promise<ToolResult | null> {
  const actor = currentActor();
  const authz = authorize(actor, "approveDocuments", namespace);
  if (authz.ok) {
    return null;
  }

  const blockedAttempt = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    seq: nextAuditSeq(),
    actor: toAuditActor(actor),
    namespace,
    eventType: "blocked" as const,
    reason: `unauthorized: ${authz.reason}`,
  };
  // The refusal stands even if the trail write fails.
  await getKgStore().appendAudit(blockedAttempt).catch(() => undefined);

  return asJson({
    phase: "unauthorized",
    action: "approveDocuments",
    reason: authz.reason,
    message: "Approving a produced file needs the approver role in this workspace. You may still send it back: verdict 'changes_requested' with a note.",
  });
}

/**
 * The files about to be approved that quote curriculum which has changed since
 * they were produced. A warning, not a refusal: the approver may know the
 * change does not matter, but they should not approve without having been told.
 */
async function staleWarnings(relPaths: string[]): Promise<string[]> {
  const rawGraph = getActiveAdapter().model().rawGraph;
  const contentByNode = new Map<string, string>();
  for (const node of rawGraph?.nodes ?? []) {
    const content = (node.properties as Record<string, unknown> | undefined)?.content;
    if (typeof content === "string") {
      contentByNode.set(node.id, content);
    }
  }

  const warnings: string[] = [];
  for (const relPath of relPaths) {
    const entry = await getEntry(relPath);
    const state = staleness(entry?.sources, contentByNode);
    if (state.state !== "stale") {
      continue;
    }
    const moved = state.changed.length + state.removed.length;
    warnings.push(`'${relPath}' quotes curriculum that has changed since it was produced (${moved} of ${state.checked} source node(s)). check_stale names them; producing the file again is what brings it up to date.`);
  }
  return warnings;
}

function nextStepsAfterVerdict(verdict: FileVerdict): string[] {
  if (verdict === "approved") {
    return [
      "Approved. The approval is of these exact bytes: producing the file again, or recording new bytes under the same path, returns it to 'produced'.",
    ];
  }
  return [
    "Sent back. Make the change the note asks for in the curriculum or the page, produce the file again and record it: the new file becomes the current one, with no verdict yet.",
  ];
}

type VerdictArgs = PathsArgs & { verdict: FileVerdict; note?: string; confirm?: boolean };

/** Exported so tests drive the real logic without standing up the MCP server. */
export async function recordFileVerdict(args: VerdictArgs): Promise<ToolResult> {
  const namespace = activeNamespace();

  // Inside the caller's context override, so the role is checked against the
  // namespace the verdict will be written in — see context-override.ts.
  const notMember = await denyUnlessMember("writeDocuments", namespace);
  if (notMember) {
    return notMember;
  }

  const paths = pathsOf(args);
  if ("error" in paths) {
    return paths.error;
  }

  const note = args.note?.trim() || undefined;
  if (args.verdict === "changes_requested" && !note) {
    return toolError("VALIDATION_ERROR", "Sending a file back needs a `note` saying what must change — without it the person producing the next version has nothing to act on.");
  }

  if (args.verdict === "approved") {
    const notApprover = await denyUnlessApprover(namespace);
    if (notApprover) {
      return notApprover;
    }
  }

  // Checked BEFORE asking for confirmation: a person should never be asked to
  // approve something the server is about to refuse.
  const verdictInput = { relPaths: paths.list, verdict: args.verdict, by: currentFilePerson(), note };
  const plan = await recordVerdicts({ ...verdictInput, dryRun: true });
  if ("refused" in plan) {
    return asJson({
      namespace,
      phase: "refused",
      message: "No verdict was recorded on any file: at least one of them cannot take one.",
      refused: plan.refused,
    });
  }

  if (!args.confirm) {
    const filesNamed = describePaths(paths.list, "the verdict", "verdicts");
    const action = `record '${args.verdict}' — ${filesNamed} — in namespace '${namespace}', in your name, on the live file records (no draft; a later verdict replaces it)`;
    const warnings = args.verdict === "approved" ? await staleWarnings(paths.list) : [];
    return asJson({
      namespace,
      ...buildConfirmEnvelope(action),
      files: plan.recorded,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  }

  const done = await recordVerdicts(verdictInput);
  if ("refused" in done) {
    // A file changed between the check above and the write — rare, and the
    // answer is the same as if it had been caught the first time.
    return asJson({ namespace, phase: "refused", message: "No verdict was recorded on any file.", refused: done.refused });
  }

  await auditVerdicts(namespace, args.verdict, done.recorded, note);

  return asJson({
    namespace,
    verdict: args.verdict,
    by: verdictInput.by.email ?? verdictInput.by.id,
    ...(note ? { note } : {}),
    files: done.recorded,
    nextSteps: nextStepsAfterVerdict(args.verdict),
  });
}

async function auditVerdicts(namespace: string, verdict: FileVerdict, files: FileVerdictResult[], note: string | undefined): Promise<void> {
  for (const file of files) {
    await auditFileEvent(namespace, {
      fileEvent: verdict,
      filePath: file.relPath,
      fileMd5: file.md5,
      note,
    });
  }
}

export function registerFileStatusTools(server: McpServer) {
  server.registerTool(
    "record_file_verdict",
    {
      title: "Approve a produced file, or send it back",
      annotations: WRITES,
      description:
        "Record a PERSON's verdict on a produced file: `verdict:'approved'` (this is the file to use — APPROVERS only) or `'changes_requested'` (send it back — any member; `note` is required and says what must change). " +
        "Name the file by `relPath`, or several with `relPaths` under ONE confirmation — the four files of a lesson. " +
        "Only the CURRENT file of a lesson, document and language takes a verdict: a 'replaced' or 'unfiled' one is refused, naming the file to use instead, and so is a file whose bytes in the bucket are no longer the ones recorded. " +
        "All or nothing: if one file is refused, none is recorded. The verdict is tied to those exact bytes — recording new bytes under the same path returns the file to 'produced'. " +
        "Relay the verdict the person GAVE; never decide it for them, and never approve because a check passed. " +
        "REQUIRES CONFIRMATION — without confirm:true you get a needsConfirmation notice listing each file and its status before and after, plus `warnings` when a file quotes curriculum that has changed since; show it to the person, then call again with confirm:true. " +
        "Writes LIVE to the file records (no draft; a later verdict replaces this one) and is audited in the person's name. " +
        WORKSPACE_ROLE_NOTE + " " + NAMESPACE_NOTE,
      inputSchema: {
        ...pathsShape,
        verdict: z.enum(FILE_VERDICTS as [FileVerdict, ...FileVerdict[]]),
        note: z.string().max(2000).optional().describe("What must change (required for 'changes_requested'), or an optional remark on an approval."),
        confirm: z.boolean().optional(),
        ...contextField,
      },
    },
    guarded(async (args: VerdictArgs & WithContext) =>
      withContextOverrideResult(args.context, () => recordFileVerdict(args))),
  );
}
