/*
 * Module: server · tool group: structural check (check_draft)
 *
 * The mechanical half of "is my draft ready?" — a WIRING lint reported in plain
 * French (docs/design-notes/self-serve-authoring.md, phase 1). Its sibling is
 * review_draft, which hands the guide's PROSE expectations to the calling model
 * to judge. Two tools, deliberately:
 *
 *   check_draft   — server-decidable, mechanical, the same for every subject.
 *   review_draft  — a judgment the model makes from the subject's guide.
 *
 * Present them to the expert as one moment ("let's look at your draft"), not as
 * two tools to remember. The rules themselves live in kg-store/lint.ts, because
 * the publish dry-run runs them too.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "node:crypto";
import { asJson, guarded } from "./shared.js";
import { getActiveAdapter } from "../adapters/index.js";
import { activeWorkspace } from "../context/index.js";
import {
  getKgStore, kgNamespace, lintGraph, toAuditActor, diffGraphs,
  type LintFinding, type MutationGraph, type StoredNode, type StoredEdge, type Slot,
} from "../kg-store/index.js";
import { authorize } from "../authz.js";
import { currentActor } from "../actor.js";

function activeNamespace(): string {
  const adapter = getActiveAdapter();
  return kgNamespace(activeWorkspace(), adapter.grade, adapter.subject);
}

// Drop the storage-level slot tag so the lint sees a plain graph (the same
// stripping the mutation framework does when it loads a slot).
const stripSlot = <T extends { slot: Slot }>(row: T): Omit<T, "slot"> => {
  const { slot: _slot, ...rest } = row;
  return rest;
};
const asGraph = (nodes: StoredNode[], edges: StoredEdge[]): MutationGraph =>
  ({ nodes: nodes.map(stripSlot), edges: edges.map(stripSlot) });

// A whole published graph can carry a long tail of inherited loose ends; the
// response stays readable by showing the first slice and counting the rest.
const MAX_FINDINGS = 50;

// One French sentence summarising the result, so the model can read the verdict
// aloud without composing it (and without inventing a number).
function summarise(findings: LintFinding[], checking: "draft" | "published"): string {
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  const infos = findings.length - warnings;
  const what = checking === "draft" ? "Le brouillon" : "La version publiée";
  if (findings.length === 0) return `${what} ne présente aucun problème de branchement : tout est relié.`;
  const parts = [
    warnings > 0 ? `${warnings} point(s) à corriger` : null,
    infos > 0 ? `${infos} point(s) à vérifier` : null,
  ].filter(Boolean).join(" et ");
  return `${what} présente ${parts}.`;
}

/**
 * Run the wiring lint over the open draft (or published, when no draft is open).
 * Read-only. Exported so tests drive the real logic.
 *
 * Findings on the WHOLE graph are returned, each tagged with whether this draft
 * is responsible for it (`inThisDraft`) — an expert wants to see the loose ends
 * in front of them, but should be able to tell their own from inherited ones.
 */
export async function checkDraft(): Promise<Record<string, unknown>> {
  const namespace = activeNamespace();
  const store = getKgStore();
  const pointer = await store.readPointer(namespace);
  if (!pointer) return { error: `Aucun graphe en base pour '${namespace}'. Importez-le d'abord.` };

  let target = pointer.publishedSlot;
  let checking: "draft" | "published" = "published";
  if (pointer.draftSlot) {
    // A draft is pre-publish work in progress — same tier as diff_draft.
    const actor = currentActor();
    const authz = authorize(actor, "readDraft", namespace);
    if (!authz.ok) {
      await store.appendAudit({
        id: randomUUID(), ts: new Date().toISOString(), actor: toAuditActor(actor),
        namespace, eventType: "blocked", reason: `unauthorized: ${authz.reason}`,
      });
      return { phase: "unauthorized", action: "readDraft", reason: authz.reason };
    }
    target = pointer.draftSlot;
    checking = "draft";
  }

  const [nodes, edges] = await Promise.all([
    store.listNodes(namespace, target),
    store.listEdges(namespace, target),
  ]);
  const graph = asGraph(nodes, edges);
  const findings = lintGraph(graph);

  // Which findings this draft is responsible for: the nodes it added or changed.
  // Only the published side needs reading again — we already hold the draft.
  const ownIds = checking === "draft" ? await draftNodeIds(namespace, pointer.publishedSlot, graph) : new Set<string>();
  const shown = findings.slice(0, MAX_FINDINGS);

  return {
    namespace,
    checking,
    summary: summarise(findings, checking),
    counts: {
      warnings: findings.filter((finding) => finding.severity === "warning").length,
      infos: findings.filter((finding) => finding.severity === "info").length,
      inThisDraft: findings.filter((finding) => ownIds.has(finding.nodeId)).length,
    },
    ...(findings.length > shown.length
      ? { truncated: findings.length, truncatedNote: `${findings.length} points au total ; les ${MAX_FINDINGS} premiers sont listés (avertissements d'abord).` }
      : {}),
    findings: shown.map((finding) => ({ ...finding, inThisDraft: ownIds.has(finding.nodeId) })),
    instruction:
      "Rapportez ces points à l'utilisateur en français, dans ses mots (« document », « section », « objectif »), sans jargon technique ni identifiants. " +
      "Chaque point porte un `fix` : proposez-le comme prochaine action. Ce sont des avertissements de BRANCHEMENT (ce qui est relié à quoi), jamais un jugement pédagogique — pour la couverture du programme, utilisez review_draft. Rien ici n'empêche de publier.",
  };
}

// The nodes the open draft added or changed vs published — used only to tag a
// finding as this draft's doing. Takes the draft graph already in hand so a check
// costs one extra read (published), not three.
async function draftNodeIds(namespace: string, publishedSlot: Slot, draft: MutationGraph): Promise<Set<string>> {
  const store = getKgStore();
  const [nodes, edges] = await Promise.all([
    store.listNodes(namespace, publishedSlot),
    store.listEdges(namespace, publishedSlot),
  ]);
  const diff = diffGraphs(asGraph(nodes, edges), draft);
  return new Set([...diff.nodes.added, ...diff.nodes.changed].map((entry) => entry.id));
}

export function registerCheckTools(server: McpServer) {
  server.registerTool(
    "check_draft",
    {
      title: "Check the draft's wiring",
      description:
        "Structural check of the current DRAFT (or of published, when no draft is open) — the MECHANICAL problems that fail silently today: a document attached to no curriculum (it would generate empty), a document with no formatter, a section outside any document, a routine no lesson uses, a node connected to nothing. Read-only, changes nothing, blocks nothing. " +
        "Findings come back in FRENCH, each with a `message` (what is wrong) and a `fix` (what to do), plus `inThisDraft` telling you whether the current draft caused it or it was already there. " +
        "This checks WIRING, never pedagogy: for whether the graph covers what the subject should teach, call review_draft, which reads the subject guide's expectations. Run both before publish_draft and present them to the user as one review, not two tools. The same wiring warnings also ride publish_draft's dry-run, scoped to what the draft touched. Reading an open draft is curator/approver-gated.",
      inputSchema: {},
    },
    guarded(async () => asJson(await checkDraft())),
  );
}
