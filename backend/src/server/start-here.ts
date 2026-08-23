/*
 * Module: server · tool group: orientation (start_here)
 *
 * Rung 2 of the in-product guidance (docs/design-notes/self-serve-authoring.md).
 * get_capabilities answers "what is POSSIBLE" for a machine; nothing answered
 * "what should I do NEXT" for a person. This does, in French, in one
 * argument-free call: where you are, what you may do, what is half-finished, and
 * the two or three things worth doing now.
 *
 * It is a READ over state we already keep — the context list, the caller's role,
 * the draft pointer, and the wiring lint. No new bookkeeping, so it cannot go
 * stale.
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
  curator: ["modifier le contenu (les changements restent en brouillon)", "annuler le brouillon"],
  approver: ["modifier le contenu", "annuler le brouillon", "publier (rendre les changements visibles)"],
  admin: ["modifier et publier", "gérer les membres de l'espace de travail"],
  super_admin: ["tout faire, dans tous les espaces de travail"],
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
    "document-sans-contenu": (n) => `${n} document(s) ne sont rattachés à aucun contenu du programme — ils seraient produits vides.`,
    "document-sans-mise-en-forme": (n) => `${n} document(s) n'ont aucune règle de mise en forme.`,
    "section-hors-document": (n) => `${n} section(s) n'appartiennent à aucun document.`,
    "routine-inutilisee": (n) => `${n} routine(s) pédagogique(s) ne sont utilisées par aucune leçon.`,
    "noeud-isole": (n) => `${n} élément(s) ne sont reliés à rien.`,
    "section-sans-contenu": (n) => `${n} section(s) ne couvrent aucun contenu (normal pour une page de garde ou un sommaire).`,
  };
  return [...byRule.entries()]
    .map(([rule, group]) => (phrasing[rule] ?? ((n: number) => `${n} point(s) à vérifier (${rule}).`))(group.length));
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
      etape: "choisir-le-sujet",
      message: "Aucun programme n'est encore sélectionné. Demandez à l'utilisateur sur quel niveau et quelle matière il veut travailler, puis appelez set_context.",
      disponibles: available,
      suggestions: ["Choisir un programme parmi `disponibles` (set_context)."],
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
    "Lire le guide du sujet pour parler comme lui : get_graph_guide.",
    "Voir de quoi le programme est fait : namespace_stats.",
    "Retrouver un chapitre ou un document par son NOM (jamais par identifiant) : find_node.",
    ...(draftOpen
      ? [
          "Un brouillon est ouvert : voir ce qu'il change (diff_draft), vérifier les branchements (check_draft), puis publier (publish_draft).",
        ]
      : []),
    ...(findings.length > 0 ? ["Reprendre le travail inachevé listé dans `inacheve`."] : []),
  ];

  return {
    etape: "pret",
    contexte: { espace: workspace, niveau: adapter.grade, matiere: adapter.subject },
    role: role ?? null,
    droits: role ? ROLE_POWERS[role] : ["lire et générer, mais pas modifier — demandez un rôle à un administrateur de l'espace"],
    brouillon: draftOpen ? "un brouillon est ouvert (vos changements ne sont pas encore publiés)" : "aucun brouillon en cours",
    inacheve: unfinished(findings),
    suggestions,
    instruction:
      "Présentez ceci à l'utilisateur en français simple, comme un point de situation : où il en est, ce qu'il peut faire, ce qui reste en suspens. " +
      "Parlez son vocabulaire — « document », « section », « chapitre », « objectif » — jamais TLM, SFI, hasPart ou identifiant. Proposez ensuite une ou deux actions, et laissez-le choisir.",
  };
}

export function registerStartHereTools(server: McpServer) {
  server.registerTool(
    "start_here",
    {
      title: "Where am I, and what should I do next?",
      description:
        "Argument-free ORIENTATION for a human author, answered in French: the active workspace/grade/subject (or the list to choose from when none is set), the role the caller holds and what it lets them do, whether a draft is open, the UNFINISHED work in the graph (documents attached to nothing, sections outside a document, unused routines), and two or three suggested next moves. " +
        "Call it at the start of a session, or whenever the user asks « qu'est-ce que je peux faire ? » / « où j'en suis ? ». Where get_capabilities answers what is POSSIBLE (for a machine), this answers what to do NEXT (for a person). Read-only, no context required, changes nothing.",
      inputSchema: {},
    },
    // NOT wrapped in guarded(): answering with no active context is the point.
    async () => asJson(await startHere()),
  );
}
