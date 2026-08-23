/*
 * Module: server · tool group: orientation (start_here)
 *
 * Rung 2 of the in-product guidance (docs/design-notes/self-serve-authoring.md).
 * get_capabilities answers "what is POSSIBLE" for a machine; nothing answered
 * "what should I do NEXT" for a person. This does, in one argument-free call:
 * where you are, what you may do, what is half-finished, and the two or three
 * things worth doing now.
 *
 * It is a READ over state we already keep — the context list, the caller's role,
 * the draft pointer, and the wiring lint. No new bookkeeping, so it cannot go
 * stale.
 *
 * LANGUAGE: the payload is English, like every other server-authored string
 * here, and `instruction` tells the model to deliver it in the EXPERT'S
 * language. One deployment serves six workspaces — Senegal works in French, the
 * EIDU frameworks in English — so the server cannot pick; the subject guide
 * names the working language, and the model relays.
 *
 * Everything it says is phrased as description, not as orders to the assistant:
 * `suggestions` are the moves available, for the model to offer the expert.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asJson } from "./shared.js";
import { accessibleContexts } from "./context.js";
import { getActiveAdapter } from "../adapters/index.js";
import { activeWorkspace, getActiveContext } from "../context/index.js";
import { getKgStore, kgNamespace, lintGraph, type LintFinding, type MutationGraph, type Slot, type StoredEdge, type StoredNode } from "../kg-store/index.js";
import { currentActor } from "../actor.js";
import { effectiveRole } from "../authz.js";
import type { EffectiveRole } from "../actor.js";

// What each role may do, in the expert's terms — never the internal action names.
const ROLE_POWERS: Record<EffectiveRole, string[]> = {
  curator: ["change the content (changes stay in a draft)", "take back the last change", "discard the draft"],
  approver: ["change the content", "take back the last change", "discard the draft", "publish (make changes visible)"],
  admin: ["change and publish", "manage the workspace's members"],
  super_admin: ["do anything, in every workspace"],
};

const stripSlot = <T extends { slot: Slot }>(row: T): Omit<T, "slot"> => {
  const { slot: _slot, ...rest } = row;
  return rest;
};
const asGraph = (nodes: StoredNode[], edges: StoredEdge[]): MutationGraph =>
  ({ nodes: nodes.map(stripSlot), edges: edges.map(stripSlot) });

// The half-finished work, as sentences an expert recognises. Built from the same
// wiring lint check_draft reports, grouped so a long tail reads as one line.
function unfinished(findings: LintFinding[]): string[] {
  const byRule = new Map<string, LintFinding[]>();
  for (const finding of findings) {
    byRule.set(finding.rule, [...(byRule.get(finding.rule) ?? []), finding]);
  }
  const phrasing: Record<string, (count: number) => string> = {
    "document-covers-nothing": (n) => `${n} document(s) are attached to no curriculum content — they would be produced empty.`,
    "document-has-no-formatter": (n) => `${n} document(s) have no layout rules.`,
    "section-outside-document": (n) => `${n} section(s) belong to no document.`,
    "routine-unused": (n) => `${n} instructional routine(s) are used by no lesson.`,
    "isolated-node": (n) => `${n} element(s) are connected to nothing.`,
    "section-covers-nothing": (n) => `${n} section(s) cover no content (normal for a cover page or a table of contents).`,
  };
  return [...byRule.entries()]
    .map(([rule, group]) => (phrasing[rule] ?? ((n: number) => `${n} point(s) to check (${rule}).`))(group.length));
}

/**
 * Where the expert is, what they may do, and what is unfinished. Read-only.
 * Exported so tests drive the real logic.
 *
 * Deliberately answers with NO active context too — "you haven't chosen a
 * subject yet, here are yours" is the most useful thing a first call can say.
 */
export async function startHere(): Promise<Record<string, unknown>> {
  const active = getActiveContext();
  const available = accessibleContexts();

  if (!active) {
    return {
      step: "choose-a-subject",
      message: "No curriculum is selected yet. Ask the user which grade and subject they want to work on, then call set_context.",
      available,
      suggestions: ["Choose a curriculum from `available` (set_context)."],
    };
  }

  const adapter = getActiveAdapter();
  const workspace = activeWorkspace();
  const namespace = kgNamespace(workspace, adapter.grade, adapter.subject);
  const role = effectiveRole(currentActor(), workspace);

  const store = getKgStore();
  const pointer = await store.readPointer(namespace);
  const slot = pointer?.draftSlot ?? pointer?.publishedSlot;
  const [nodes, edges] = slot
    ? await Promise.all([store.listNodes(namespace, slot), store.listEdges(namespace, slot)])
    : [[], []];
  const findings = lintGraph(asGraph(nodes, edges)).filter((finding) => finding.severity === "warning");

  const draftOpen = Boolean(pointer?.draftSlot);
  const suggestions = [
    "Read the subject's guide so you speak its language: get_graph_guide.",
    "See what the curriculum is made of: namespace_stats.",
    "Find a chapter or a document by its NAME (never by identifier): find_node.",
    ...(draftOpen
      ? [
          "A draft is open: see what it changes (diff_draft), check its wiring (check_draft), then publish (publish_draft).",
          "One edit went wrong? undo_last takes back just the last one; discard_draft throws the whole draft away.",
        ]
      : []),
    ...(findings.length > 0 ? ["Pick up the unfinished work listed in `unfinished`."] : []),
  ];

  return {
    step: "ready",
    context: { workspace, grade: adapter.grade, subject: adapter.subject },
    role: role ?? null,
    allowedTo: role ? ROLE_POWERS[role] : ["read and generate, but not change anything — ask a workspace administrator for a role"],
    draft: draftOpen ? "a draft is open (your changes are not published yet)" : "no draft in progress",
    unfinished: unfinished(findings),
    suggestions,
    instruction:
      "Deliver this to the user as a situation report — where they are, what they can do, what is still outstanding — IN THEIR OWN LANGUAGE: the one this subject's curriculum and guide are written in (French for Senegal, English for the EIDU frameworks), or whichever they are writing to you in. " +
      "Use their words — document, section, chapter, objective — never TLM, SFI, hasPart, or an identifier. Then offer one or two actions and let them choose.",
  };
}

export function registerStartHereTools(server: McpServer) {
  server.registerTool(
    "start_here",
    {
      title: "Where am I, and what should I do next?",
      description:
        "Argument-free ORIENTATION for a human author: the active workspace/grade/subject (or the list to choose from when none is set), the role the caller holds and what it lets them do, whether a draft is open, the UNFINISHED work in the graph (documents attached to nothing, sections outside a document, unused routines), and two or three suggested next moves. " +
        "Call it at the start of a session, or whenever the user asks \"what can I do?\" / \"where did I leave off?\" (in any language). Where get_capabilities answers what is POSSIBLE (for a machine), this answers what to do NEXT (for a person) — so relay it in the user's own language, which the subject's guide names. Read-only, no context required, changes nothing.",
      inputSchema: {},
    },
    // NOT wrapped in guarded(): answering with no active context is the point.
    async () => asJson(await startHere()),
  );
}
