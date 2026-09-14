/*
 * Running the lint rules a formatter declares (kg-recipes/lint-rules.ts).
 *
 * A formatter governs a document: it hangs under a TeachingLearningMaterial
 * (a FormatterSpec under its Formatter under the TLM). So a `guide` rule reads
 * the assembly guides of that document and of every section beneath it, a
 * `content` rule the curriculum those sections cover, and a `page` rule the
 * lines of a page composed against a stack that carries the formatter. The
 * rule says what a line must look like; this says which lines, and reports
 * each break against the node that holds it, so the fix is an edit and not a
 * search.
 */
import type { LintFinding, MutationGraph, MutationNode } from "../kg-store/index.js";
import { lintRulesOf, lineBreaks, type LintRule } from "../kg-recipes/index.js";
import { displayName } from "../utils/index.js";
import type { Block, Cell } from "../render/index.js";

const CONTAINMENT = "hasPart";
const COVERS = "covers";
const TLM_LABEL = "TeachingLearningMaterial";
const SECTION_LABEL = "DocumentSection";
/** Every finding from a declared rule is prefixed, so it is told apart from the coded ones. */
export const DECLARED_PREFIX = "declared:";

const rawOf = (node: MutationNode): Record<string, unknown> => (node.properties?.raw as Record<string, unknown>) ?? {};
const metaOf = (node: MutationNode): Record<string, unknown> => (rawOf(node).metadata as Record<string, unknown>) ?? {};
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const titleOf = (node: MutationNode): string => displayName(str(rawOf(node).description)) || str(node.properties?.title) || node.id;
const labelsOf = (node: MutationNode): string[] => node.labels ?? [];

function byId(graph: MutationGraph): Map<string, MutationNode> {
  return new Map(graph.nodes.map((node) => [node.id, node]));
}

/** The document a formatter (or its spec) hangs under, climbing containment at most three steps. */
function documentOf(graph: MutationGraph, nodeId: string, nodes: Map<string, MutationNode>): MutationNode | null {
  let current = nodeId;
  for (let step = 0; step < 3; step++) {
    const parent = graph.edges.find((edge) => edge.type === CONTAINMENT && edge.to === current)?.from;
    if (!parent) return null;
    const node = nodes.get(parent);
    if (node && labelsOf(node).includes(TLM_LABEL)) return node;
    current = parent;
  }
  return null;
}

/** Every node under `rootId` along containment, root excluded. */
function descendants(graph: MutationGraph, rootId: string): string[] {
  const out: string[] = [];
  const queue = [rootId];
  const seen = new Set<string>([rootId]);
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const edge of graph.edges) {
      if (edge.type !== CONTAINMENT || edge.from !== id || seen.has(edge.to)) continue;
      seen.add(edge.to); out.push(edge.to); queue.push(edge.to);
    }
  }
  return out;
}

/** A finding against one node, quoting the line so the fix is an edit, not a search. */
function findingFor(rule: LintRule, node: MutationNode, line: string, reason: string): LintFinding {
  const excerpt = line.length > 90 ? `${line.slice(0, 87)}…` : line;
  return {
    rule: DECLARED_PREFIX + rule.id,
    severity: rule.severity ?? "warning",
    nodeId: node.id,
    title: titleOf(node),
    message: `${rule.message} — « ${excerpt} » (${reason}).`,
    fix: rule.fix ?? "Edit the line (edit_nodes), or retire the rule on the formatter if it is wrong.",
  };
}

/** The lines of a text, trimmed, blank ones dropped. */
const linesOf = (text: string): string[] => text.split("\n").map((line) => line.trim()).filter(Boolean);

/** Rules to skip on a node, from its `metadata.lintIgnore` — by the prefixed id or the bare one. */
function ignoredOn(node: MutationNode): Set<string> {
  const value = metaOf(node).lintIgnore;
  return new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
}

const silenced = (node: MutationNode, rule: LintRule): boolean => {
  const ignored = ignoredOn(node);
  return ignored.has(rule.id) || ignored.has(DECLARED_PREFIX + rule.id);
};

/*
 * The node a lint is asked about, when it is: a DocumentSection or the
 * document itself. The guide and content rules then read only that node and
 * what hangs under it — the page being composed, not the 374 sections beside
 * it. One rule about bullet length has over a thousand hits across a subject;
 * a composer checking one section needs the three on that section.
 */
export type DeclaredScope = { nodeId: string };

/** What a scope resolved to, reported back so a caller knows what was and was not read. */
export type DeclaredScopeResolved = { nodeId: string; document: string; sections: number };

/** The document a section or document node belongs to, climbing containment; the node itself when it is the document. */
function documentOfScope(graph: MutationGraph, nodeId: string, nodes: Map<string, MutationNode>): MutationNode | null {
  const own = nodes.get(nodeId);
  if (!own) return null;
  if (labelsOf(own).includes(TLM_LABEL)) return own;
  if (!labelsOf(own).includes(SECTION_LABEL)) return null;
  let current = nodeId;
  for (let step = 0; step < 8; step++) {
    const parent = graph.edges.find((edge) => edge.type === CONTAINMENT && edge.to === current)?.from;
    if (!parent) return null;
    const node = nodes.get(parent);
    if (node && labelsOf(node).includes(TLM_LABEL)) return node;
    current = parent;
  }
  return null;
}

/**
 * The guide and content rules of every formatter in the graph, run over what
 * each formatter governs — or, with a scope, over the one node asked about
 * and what hangs under it. Every rule that ran is listed too, so a caller can
 * say "checked against N declared rules" and not only "found nothing".
 */
export function lintDeclared(graph: MutationGraph, scope?: DeclaredScope): { findings: LintFinding[]; rulesRun: string[]; scope: DeclaredScopeResolved | null } {
  const nodes = byId(graph);
  const findings: LintFinding[] = [];
  const rulesRun = new Set<string>();

  // With a scope: the document the rules must govern, and the ids the
  // sections read are kept to (the scope node and everything under it).
  const scopeDocument = scope ? documentOfScope(graph, scope.nodeId, nodes) : null;
  if (scope && !scopeDocument) return { findings: [], rulesRun: [], scope: null };
  const within = scope ? new Set<string>([scope.nodeId, ...descendants(graph, scope.nodeId)]) : null;
  let sectionsRead = 0;

  for (const carrier of graph.nodes) {
    const rules = lintRulesOf(carrier)?.filter((rule) => rule.where !== "page");
    if (!rules || rules.length === 0) continue;
    const document = documentOf(graph, carrier.id, nodes);
    if (!document) continue;
    if (scopeDocument && document.id !== scopeDocument.id) continue;

    const underDocument = [document, ...descendants(graph, document.id).map((id) => nodes.get(id)!).filter((n) => n && labelsOf(n).includes(SECTION_LABEL))];
    const sections = within ? underDocument.filter((section) => within.has(section.id)) : underDocument;
    sectionsRead = Math.max(sectionsRead, sections.length);
    for (const rule of rules) {
      rulesRun.add(DECLARED_PREFIX + rule.id);
      const picked = rule.sections ? sections.filter((section) => new RegExp(rule.sections!, "u").test(titleOf(section))) : sections;

      if (rule.where === "guide") {
        for (const section of picked) {
          if (silenced(section, rule)) continue;
          for (const line of linesOf(str(metaOf(section).assemblyGuide))) {
            const reason = lineBreaks(rule, line);
            if (reason) findings.push(findingFor(rule, section, line, reason));
          }
        }
        continue;
      }

      // `content`: the curriculum the picked sections cover, and everything under it.
      const coveredIds = new Set<string>();
      for (const section of picked) {
        for (const edge of graph.edges) {
          if (edge.type !== COVERS || edge.from !== section.id) continue;
          coveredIds.add(edge.to);
          for (const id of descendants(graph, edge.to)) coveredIds.add(id);
        }
      }
      for (const id of coveredIds) {
        const node = nodes.get(id);
        if (!node || silenced(node, rule)) continue;
        for (const line of linesOf(str(rawOf(node).content))) {
          const reason = lineBreaks(rule, line);
          if (reason) findings.push(findingFor(rule, node, line, reason));
        }
      }
    }
  }
  return {
    findings,
    rulesRun: [...rulesRun],
    scope: scope && scopeDocument ? { nodeId: scope.nodeId, document: scopeDocument.id, sections: sectionsRead } : null,
  };
}

/** The page rules of a formatter stack, nearest last — every one applies. */
export function declaredPageRules(stack: Array<{ id: string; properties?: Record<string, unknown> }>): LintRule[] {
  return stack.flatMap((node) => (lintRulesOf(node) ?? []).filter((rule) => rule.where === "page"));
}

/** The printed text of every line of a tree, cells included, in reading order. */
function pageLines(blocks: readonly Block[]): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    if (block.kind === "line") out.push(block.runs.map((run) => ("text" in run ? run.text : "")).join("").trim());
    if (block.kind === "table") for (const row of block.rows) for (const cell of row as Cell[]) out.push(...pageLines(cell.blocks));
  }
  return out.filter(Boolean);
}

/** A composed page against the page rules its stack declares, reported against the scope node. */
export function lintDeclaredPage(rules: LintRule[], blocks: readonly Block[], scope: { id: string; title: string; ignore: Set<string> }): LintFinding[] {
  const findings: LintFinding[] = [];
  const lines = pageLines(blocks);
  for (const rule of rules) {
    if (scope.ignore.has(rule.id) || scope.ignore.has(DECLARED_PREFIX + rule.id)) continue;
    for (const line of lines) {
      const reason = lineBreaks(rule, line);
      if (!reason) continue;
      const excerpt = line.length > 90 ? `${line.slice(0, 87)}…` : line;
      findings.push({
        rule: DECLARED_PREFIX + rule.id, severity: rule.severity ?? "warning", nodeId: scope.id, title: "composed page",
        message: `${rule.message} — « ${excerpt} » (${reason}).`,
        fix: rule.fix ?? "Correct the line on the page, or in the graph if the graph is what is wrong.",
      });
    }
  }
  return findings;
}
