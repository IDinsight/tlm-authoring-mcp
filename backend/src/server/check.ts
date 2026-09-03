/*
 * Module: server · tool group: structural check (check_draft)
 *
 * The mechanical half of "is my draft ready?" — a WIRING lint
 * (docs/design-notes/self-serve-authoring.md, phase 1). Its sibling is
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
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { asJson, guarded } from "./shared.js";
import { getActiveAdapter } from "../adapters/index.js";
import { activeWorkspace } from "../context/index.js";
import {
  getKgStore, kgNamespace, lintGraph, toAuditActor, diffGraphs,
  type LintFinding, type MutationGraph, type StoredNode, type StoredEdge, type Slot, nextAuditSeq,} from "../kg-store/index.js";
import { lintContent, lintableRules, CONTENT_RULES } from "../curriculum/index.js";
import { readCatalog } from "./catalog.js";
import { SHARED_CATALOG_NAMESPACE, catalogNamespace } from "../kg-recipes/index.js";
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

// One sentence summarising the result, so the model can relay the verdict
// without composing it (and without inventing a number).
function summarise(findings: LintFinding[], checking: "draft" | "published"): string {
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  const infos = findings.length - warnings;
  const what = checking === "draft" ? "The draft" : "The published version";
  if (findings.length === 0) return `${what} has no wiring problems: everything is connected.`;
  const parts = [
    warnings > 0 ? `${warnings} point(s) to fix` : null,
    infos > 0 ? `${infos} point(s) to check` : null,
  ].filter(Boolean).join(" and ");
  return `${what} has ${parts}.`;
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
  if (!pointer) return { error: `No graph in the store for '${namespace}'. Import it first.` };

  let target = pointer.publishedSlot;
  let checking: "draft" | "published" = "published";
  if (pointer.draftSlot) {
    // A draft is pre-publish work in progress — same tier as diff_draft.
    const actor = currentActor();
    const authz = authorize(actor, "readDraft", namespace);
    if (!authz.ok) {
      await store.appendAudit({
        id: randomUUID(), ts: new Date().toISOString(), seq: nextAuditSeq(), actor: toAuditActor(actor),
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
      ? { truncated: findings.length, truncatedNote: `${findings.length} points in total; the first ${MAX_FINDINGS} are listed (warnings first).` }
      : {}),
    findings: shown.map((finding) => ({ ...finding, inThisDraft: ownIds.has(finding.nodeId) })),
    instruction:
      "Report these points to the user IN THEIR OWN LANGUAGE — the one this subject's curriculum and guide are written in (French for Senegal, English for the EIDU frameworks) — and in their words (document, section, objective), with no technical jargon and no identifiers. " +
      "Each point carries a `fix`: offer it as the next action. These are WIRING warnings (what is connected to what), never a pedagogical judgement — for curriculum coverage use review_draft. Nothing here prevents publishing.",
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
        "Each finding carries a `message` (what is wrong), a `fix` (what to do), and `inThisDraft` (whether the current draft caused it or it was already there). Relay them in the USER'S language — the one the subject's guide is written in — not verbatim. " +
        "This checks WIRING, never pedagogy: for whether the graph covers what the subject should teach, call review_draft, which reads the subject guide's expectations. Run both before publish_draft and present them to the user as one review, not two tools. The same wiring warnings also ride publish_draft's dry-run, scoped to what the draft touched. Reading an open draft is curator/approver-gated.",
      inputSchema: {},
    },
    guarded(async () => asJson(await checkDraft())),
  );
}

// ── lint_content ──────────────────────────────────────────────────────────────
// The third checker. check_draft asks "is it connected?", review_draft "does it
// teach what the guide expects?", this one "does what is written contradict
// itself?" — a total that disagrees with its parts, a cited id that resolves to
// nothing, declared values that contradict the prose beside them.
//
// It reads the CATALOG as well as the active subject, because that is where the
// reusable routines and grids live and where the live defects are. References
// are resolved against BOTH, so a catalog entry citing a subject node is not
// reported as dangling.

export type LintContentArgs = { scope?: "subject" | "catalog" | "all"; rules?: string[]; slot?: Slot | "draft" | "published" };

// The core, exported so tests drive the real logic (the shape every tool group
// here uses).
export async function runLintContent(args: LintContentArgs = {}): Promise<Record<string, unknown>> {
  const scope = args.scope ?? "all";
  const namespace = activeNamespace();
  const store = getKgStore();

  // Read the subject's published graph, plus both catalog libraries.
  const pointer = await store.readPointer(namespace);
  const subject: MutationGraph = pointer
    ? asGraph(await store.listNodes(namespace, pointer.publishedSlot), await store.listEdges(namespace, pointer.publishedSlot))
    : { nodes: [], edges: [] };

  const catalogNamespaces = [SHARED_CATALOG_NAMESPACE, catalogNamespace(activeWorkspace())]
    .filter((ns, index, all) => all.indexOf(ns) === index);
  const catalogs = await Promise.all(catalogNamespaces.map((ns) => readCatalog(ns)));

  // Everything that exists anywhere the caller can see — so a cross-library
  // reference resolves instead of being reported as broken.
  const knownIds = new Set<string>([
    ...subject.nodes.map((node) => node.id),
    ...catalogs.flatMap((graph) => graph.nodes.map((node) => node.id)),
  ]);

  const checked: Array<{ where: string; graph: MutationGraph }> = [];
  if (scope === "subject" || scope === "all") {
    checked.push({ where: namespace, graph: subject });
  }
  if (scope === "catalog" || scope === "all") {
    catalogNamespaces.forEach((ns, index) => checked.push({ where: ns, graph: catalogs[index] }));
  }

  const findings = checked.flatMap(({ where, graph }) =>
    lintContent({ graph, knownIds }, { rules: args.rules }).map((finding) => ({ ...finding, where })));

  return {
    findings,
    count: findings.length,
    checked: checked.map(({ where, graph }) => ({ where, nodes: graph.nodes.length })),
    rulesRun: lintableRules().map((rule) => rule.id),
    // What is NOT checked yet, so the gap is visible rather than assumed closed.
    rulesPending: CONTENT_RULES.filter((rule) => rule.requires !== "graph").map((rule) => ({ id: rule.id, needs: rule.requires, summary: rule.summary })),
    note:
      findings.length === 0
        ? "No contradictions found in the content checked. This checks CONSISTENCY only — check_draft covers wiring and review_draft covers coverage; run all three before publishing."
        : "Each finding is a statement in the authored data that contradicts another statement in it. Relay them in the expert's own language, with what to do about each. None of them blocks a publish.",
  };
}

export function registerContentLintTools(server: McpServer) {
  server.registerTool(
    "lint_content",
    {
      title: "Check authored content for contradictions",
      description:
        "The CONSISTENCY checker — the third beside check_draft (wiring) and review_draft (coverage). It reports statements in the authored data that contradict each other: a routine whose declared duration disagrees with the sum of its steps, a routine that times itself but not its steps, a weighted grid whose sections do not total 100%, an id cited in prose that resolves to nothing, and a formatter whose declared `render` values disagree with its own prose. " +
        "It reads the active subject AND both catalog libraries by default (`scope`: 'subject' | 'catalog' | 'all'), resolving references across both so a cross-library citation is not reported as broken. Narrow with `rules`. " +
        "Each finding carries the rule, the node, what is wrong and what to do — English, like every payload here; relay them in the expert's language. Nothing blocks a publish. A finding that is deliberate is silenced ON THE NODE with metadata.lintIgnore: [\"rule-id\"], which needs no deploy. " +
        "`rulesPending` lists the rules that cannot run yet because they need a rendered page — read it rather than assuming everything is checked. Read-only.",
      inputSchema: {
        scope: z.enum(["subject", "catalog", "all"]).optional(),
        rules: z.array(z.string()).optional(),
      },
    },
    guarded(async (a: LintContentArgs) => asJson(await runLintContent(a))),
  );
}
