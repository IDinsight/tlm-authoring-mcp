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
import { lintContent, lintableRules, CONTENT_RULES, resolvableIds, ignoredRules, lintPage, PAGE_RULES, formatterStackFor, picturesFor, type PageInput } from "../curriculum/index.js";
import { validateDocumentTree, resolveRenderSpec } from "../render/index.js";
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

export type LintContentArgs = {
  scope?: "subject" | "catalog" | "all";
  rules?: string[];
  slot?: Slot | "draft" | "published";
  /*
   * A COMPOSED PAGE to check as well as the graph — the same block tree
   * render_document takes, plus the node it was composed for.
   *
   * The page rules need the geometry that governs the tree, and that is not the
   * caller's to supply: it is the merged `render` bag of the formatter stack on
   * `nodeId`'s own path, which the server resolves. So the caller sends what it
   * made and the server brings what it will be judged against.
   */
  document?: unknown;
  nodeId?: string;
};

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
  // reference resolves instead of being reported as broken. `resolvableIds`
  // counts each node's `identifier` too, which is how a catalog clone answers
  // to the id of the subject node it was cloned from.
  const knownIds = new Set<string>([
    ...resolvableIds(subject.nodes),
    ...catalogs.flatMap((graph) => [...resolvableIds(graph.nodes)]),
  ]);

  const checked: Array<{ where: string; graph: MutationGraph }> = [];
  if (scope === "subject" || scope === "all") {
    checked.push({ where: namespace, graph: subject });
  }
  if (scope === "catalog" || scope === "all") {
    catalogNamespaces.forEach((ns, index) => checked.push({ where: ns, graph: catalogs[index] }));
  }

  const graphFindings = checked.flatMap(({ where, graph }) =>
    lintContent({ graph, knownIds }, { rules: args.rules }).map((finding) => ({ ...finding, where })));

  // The page half, only when a caller sent a page. It reports its own problems
  // separately from a refusal to check: "I found nothing" and "I could not look"
  // are different answers and a composer must not read one as the other.
  const page = args.document !== undefined
    ? await lintComposedPage(args, subject, namespace)
    : null;
  const findings = [...graphFindings, ...(page && "findings" in page ? page.findings : [])];

  const ranPageRules = Boolean(page && "findings" in page);
  return {
    findings,
    count: findings.length,
    checked: checked.map(({ where, graph }) => ({ where, nodes: graph.nodes.length })),
    rulesRun: [
      ...lintableRules().map((rule) => rule.id),
      ...(ranPageRules ? PAGE_RULES.map((rule) => rule.id) : []),
    ],
    ...(page && "error" in page ? { page } : {}),
    ...(ranPageRules ? { page: (page as { checked: unknown }).checked } : {}),
    // What is NOT checked, so the gap stays visible rather than assumed closed.
    // The page rules are pending only while no page was sent — they run now.
    rulesPending: [
      ...CONTENT_RULES.filter((rule) => rule.requires !== "graph").map((rule) => ({ id: rule.id, needs: rule.requires, summary: rule.summary })),
      ...(ranPageRules ? [] : PAGE_RULES.map((rule) => ({ id: rule.id, needs: "a composed page — pass `document` + `nodeId`", summary: rule.summary }))),
    ],
    // The note says what was found; the PAGE hint rides both branches, because a
    // caller with findings in front of them is exactly who is reading it, and
    // burying "the page rules did not run" in the all-clear branch is how a
    // caller concludes everything was checked.
    note: [
      findings.length === 0
        ? `No contradictions found in the content checked${ranPageRules ? ", the composed page included" : ""}. This checks CONSISTENCY only — check_draft covers wiring and review_draft covers coverage; run all three before publishing.`
        : "Each finding is a statement that contradicts another — in the authored data, or between the page you composed and the formatter geometry that governs it. Relay them in the expert's own language, with what to do about each. None of them blocks a publish.",
      ...(ranPageRules
        ? []
        : ["The PAGE rules did NOT run, so nothing here says anything about a composed page: pass `document` (the block tree you composed) + `nodeId` (the section it is for) to check one against the geometry that will lay it out."]),
    ].join(" "),
  };
}

/*
 * Check one composed page against the geometry that will lay it out.
 *
 * Two things must line up before a rule can say anything, and each failure is
 * reported as itself rather than as an empty result:
 *
 *   • the tree must be a VALID block tree — the same validation render_document
 *     applies, reused rather than re-implemented, so a page that would be
 *     refused at render time is refused here in the same words;
 *   • the scope node must resolve a formatter stack carrying `render` geometry.
 *     A stack with none is the known live state of both subjects, and it is a
 *     REFUSAL, not a pass: with no limits to check against every rule would
 *     return nothing, which reads exactly like a clean page.
 */
async function lintComposedPage(
  args: LintContentArgs, subject: MutationGraph, namespace: string,
): Promise<{ findings: LintFinding[]; checked: Record<string, unknown> } | { error: string }> {
  if (!args.nodeId) {
    return { error: "Checking a `document` needs `nodeId` too — the node it was composed for. That is what resolves the formatter stack the page is judged against; without it there is no geometry to check." };
  }

  const treeErrors = validateDocumentTree(args.document);
  if (treeErrors.length > 0) {
    return { error: `That is not a valid block tree, so no page rule could read it: ${treeErrors.slice(0, 5).join("; ")}${treeErrors.length > 5 ? `; +${treeErrors.length - 5} more` : ""}.` };
  }

  const model = getActiveAdapter().model();
  const stack = formatterStackFor(model, args.nodeId);
  if (stack === null) {
    return { error: `No node '${args.nodeId}' in the active graph, or it is neither a DocumentSection nor a TeachingLearningMaterial — those are what carry a formatter stack. Find the section with find_node or walk_document.` };
  }

  const resolved = resolveRenderSpec(stack);
  if (!resolved.ok) {
    return { error: `The formatter stack on '${args.nodeId}' does not validate, so the page cannot be checked against it: ${resolved.errors.slice(0, 5).join("; ")}. Fix the formatter's \`render\` bag first (edit_nodes), then re-run.` };
  }
  if (resolved.from.length === 0) {
    return {
      error:
        `No formatter on '${args.nodeId}'s stack carries a \`render\` bag, so there is no geometry to check this page against. ` +
        `This is a REFUSAL, not a pass: with no declared limits every page rule would find nothing, which is indistinguishable from a clean page. ` +
        `Author the geometry on the applicable formatter (its \`render\` key) and re-run — render_document refuses for the same reason.`,
    };
  }

  const scopeNode = subject.nodes.find((node) => node.id === args.nodeId);
  // Which formatters the verdict actually used, and from which slot.
  //
  // Said out loud because render_document resolves its geometry from the DRAFT
  // and this reads PUBLISHED, like the rest of lint_content. With no open draft
  // those are the same bag. With one open they can differ, and then a clean lint
  // would be a clean bill on geometry the render is not going to use — so the
  // caller is told, rather than left to assume the two agree.
  const draftOpen = Boolean((await getKgStore().readPointer(namespace))?.draftSlot);
  return {
    findings: lintPage({
      tree: args.document as PageInput["tree"],
      spec: resolved.spec,
      scopeId: args.nodeId,
      ignore: ignoredRules(scopeNode),
      // The pictures attached to what this page covers — so the two picture
      // rules can say whether the page and the graph agree on what it carries.
      attached: (picturesFor(model, args.nodeId) ?? []).map((picture) => ({ id: picture.id, name: picture.name })),
    }).map((finding) => ({ ...finding, where: namespace })),
    checked: {
      nodeId: args.nodeId,
      geometryFrom: resolved.from,
      geometrySlot: "published",
      blocks: (args.document as PageInput["tree"]).blocks.length,
      ...(draftOpen
        ? {
            warning:
              "A draft is open. This checked the page against the PUBLISHED formatter geometry; render_document uses the draft's. If the draft changes a formatter's `render` bag, re-check after publishing — or treat render_document's own refusal as the authority.",
          }
        : {}),
    },
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
        "PASS A COMPOSED PAGE and it checks that too: `document` (the block tree, exactly as render_document takes it) plus `nodeId` (the DocumentSection or TLM it was composed for, which is what resolves the formatter stack it will be laid out with). The page rules ask whether the page contradicts its own geometry — a `style` no formatter defines, a line over the `maxChars` its style declares, more pictures than images.maxPerSection allows, a picture missing from the document's own `media` — and whether it agrees with the graph on its pictures: one placed that is not attached to the covered curriculum (attach_image), one attached that the page leaves out. Every one of those RENDERS SUCCESSFULLY and wrongly: an undefined style silently becomes body text, and an unresolvable picture silently becomes the document's FIRST picture. Run it before render_document, not after. " +
        "The thirty-odd control points a particular fiche is checked against — speech-colour purity, answer labels, no placeholder left in clear — are SUBJECT knowledge and stay in that subject's guide, where a curator changes them without a deploy. A rule here only ever asks a question the DATA answers. " +
        "`rulesPending` lists what did not run and why — the page rules appear there until you send a page, so read it rather than assuming everything was checked. Read-only.",
      inputSchema: {
        scope: z.enum(["subject", "catalog", "all"]).optional(),
        rules: z.array(z.string()).optional(),
        document: z
          .unknown()
          .optional()
          .describe("A composed page to check as well as the graph — the same { blocks, media } block tree render_document takes. Needs `nodeId`."),
        nodeId: z
          .string()
          .optional()
          .describe("The DocumentSection or TeachingLearningMaterial `document` was composed for. It is what resolves the formatter stack the page is judged against, so a page cannot be checked without it."),
      },
    },
    guarded(async (a: LintContentArgs) => asJson(await runLintContent(a))),
  );
}
