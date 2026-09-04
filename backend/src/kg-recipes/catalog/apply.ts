/*
 * The four catalog MUTATIONS: attaching an entry, and filing one back.
 *
 * `useRoutine` links a cloned routine to a Lesson via `usesRoutine`.
 * `useFormatter` and `useRubric` relabel the clone to the DOCUMENT layer
 * (Formatter/FormatterSpec, Rubric/RubricSection/RubricCriterion) and hang it
 * under the document's TeachingLearningMaterial via `hasPart` — because which
 * house style and which evaluation grid govern a document are properties of the
 * DOCUMENT, not of the curriculum, so neither rides a Course's `usesRoutine`
 * edge. `addCatalogEntry` is the inverse: it files an entry you authored back
 * INTO a library.
 *
 * Each per-kind `relabel*` sits beside the mutation that uses it, because the
 * relabelling IS that mutation's distinguishing step — the clone and the attach
 * are identical across all three.
 */
import { edgeId, type GraphMutation, type MutationEdge, type MutationGraph, type MutationNode } from "../../kg-store/index.js";
import { displayName } from "../../utils/index.js";
import {
  CATALOG_ROOT_ID, CONTAINMENT, ROUTINE_LABEL, MATERIAL_LABEL, ROUTINE_ROLE, MATERIAL_ROLE,
  FORMATTER_LABEL, FORMATTER_SPEC_LABEL, TLM_LABEL,
  RUBRIC_LABEL, RUBRIC_SECTION_LABEL, RUBRIC_CRITERION_LABEL, ROUTINE_USERS,
  labelsOf, isRoutine, isMaterial, rawOf, metaOf, kindOf, indexContainment,
  type CatalogKind,
} from "./entries.js";
import { subtreeIds, type ClonedSubtree } from "./clone.js";

// The mutation that lands a copied routine in the active subject's draft: it appends
// the pre-cloned subtree (built by cloneRoutineSubtree against the catalog namespace,
// passed in because apply() sees only the active base graph) and links the target
// lesson to the clone's entry via `usesRoutine`.
export type UseRoutineArgs = {
  namespace: string;
  targetId: string;             // the Lesson/Course/Activity that will use the routine
  clonedNodes: MutationNode[];
  clonedEdges: MutationEdge[];
  newEntryId: string;           // the cloned entry's id (a usesRoutine target)
};

const nodeById = (graph: MutationGraph, id: string) => graph.nodes.find((n) => n.id === id);

export const useRoutine: GraphMutation<UseRoutineArgs> = {
  name: "useRoutine",
  describe: (args) => `copy a catalog routine onto '${args.targetId}'`,
  validate: (base, _after, args) => {
    const errors: string[] = [];
    const target = nodeById(base, args.targetId);
    if (!target) errors.push(`use_routine: target '${args.targetId}' does not exist in the draft.`);
    else if (!(target.labels ?? []).some((l) => ROUTINE_USERS.has(l))) errors.push(`use_routine: '${args.targetId}' is a ${(target.labels ?? []).join("/") || "node"} — a routine attaches to a Lesson, Course, or Activity.`);
    if (!args.clonedNodes.some((n) => n.id === args.newEntryId)) errors.push(`use_routine: the cloned entry '${args.newEntryId}' is missing from the copied subtree (retry).`);
    for (const n of args.clonedNodes) if (nodeById(base, n.id)) errors.push(`use_routine: copied id '${n.id}' already exists in the draft (retry).`);
    return { errors, warnings: [] };
  },
  apply: (base, args) => {
    // apply() runs before validate() on the dry-run, so a bad target must return
    // base (→ clean "blocked" from validate) rather than produce a dangling edge.
    if (!nodeById(base, args.targetId)) return base;
    const link: MutationEdge = { id: edgeId("usesRoutine", args.targetId, args.newEntryId), type: "usesRoutine", from: args.targetId, to: args.newEntryId, namespace: args.namespace, properties: {} };
    return { nodes: [...base.nodes, ...args.clonedNodes], edges: [...base.edges, ...args.clonedEdges, link] };
  },
};

// ── use_formatter: copy a formatter under a document (TLM) ────────────────────
// The formatter counterpart to useRoutine. Where a routine is copied verbatim and
// linked to a Lesson via `usesRoutine`, a formatter is RELABELLED to the document
// layer and hung under a TeachingLearningMaterial via `hasPart` — the shape the
// Phase-4 migration produces (scripts/migrate-tlm-documents.mjs, Steps A + D), so a
// formatter applied today matches one migrated from the old usesRoutine stopgap.

// Drop the kind-signalling metadata tags a catalog entry carried (`catalogKind` /
// `role:"formatter"`) — once relabelled, the LC label carries the kind. Returns a
// fresh raw bag (metadata copied, not mutated) so the source catalog node is never
// touched; an emptied metadata bag is dropped so the relabelled node stays
// canonical-clean. A rubric's `weight` / `scale` survive: they are content, not tags.
// Mirrors migrate-tlm-documents.mjs::dropKindTags.
function withoutKindTags(raw: Record<string, unknown>): Record<string, unknown> {
  const next = { ...raw };
  const metadata = next.metadata as Record<string, unknown> | undefined;
  if (metadata) {
    const trimmed = { ...metadata };
    delete trimmed.catalogKind;
    delete trimmed.role;
    if (Object.keys(trimmed).length === 0) delete next.metadata;
    else next.metadata = trimmed;
  }
  return next;
}

// Turn a freshly-cloned formatter subtree into the document-layer shape a TLM holds:
// relabel the cloned entry → `Formatter` and its direct hasPart Material children →
// `FormatterSpec`, dropping each one's kind tags. Content is untouched. The clone's
// nodes are replaced with relabelled copies (properties copied, so the catalog source
// is never mutated); edges / idMap / newEntryId pass through unchanged. This mirrors
// the live-data migration's Step A relabel.
export function relabelClonedFormatter(clone: ClonedSubtree): ClonedSubtree {
  const specIds = new Set(
    clone.edges
      .filter((e) => e.type === CONTAINMENT && e.from === clone.newEntryId)
      .map((e) => e.to),
  );
  const nodes = clone.nodes.map((node) => {
    const isEntry = node.id === clone.newEntryId;
    const isSpec = specIds.has(node.id) && isMaterial(node);
    if (!isEntry && !isSpec) return node;
    const label = isEntry ? FORMATTER_LABEL : FORMATTER_SPEC_LABEL;
    return {
      ...node,
      type: label,
      labels: [label],
      properties: { ...(node.properties ?? {}), raw: withoutKindTags(rawOf(node)) },
    };
  });
  return { ...clone, nodes };
}

// The mutation that lands a copied FORMATTER under a document: it appends the
// pre-cloned + relabelled Formatter/FormatterSpec subtree (built by cloneRoutineSubtree
// then relabelClonedFormatter against the catalog, passed in because apply() sees only
// the active base graph) and links the target TeachingLearningMaterial to the clone's
// Formatter via `hasPart` — the document's rendering-stack axis. The write mirror of
// the migration's Step D (TLM ─hasPart→ Formatter, never Course ─usesRoutine→).
export type UseFormatterArgs = {
  namespace: string;
  tlmId: string;                // the TeachingLearningMaterial the formatter attaches under
  clonedNodes: MutationNode[];
  clonedEdges: MutationEdge[];
  newFormatterId: string;       // the cloned entry, relabelled to Formatter (the hasPart target)
};

// The checks use_formatter and use_rubric share: the target is an existing
// TeachingLearningMaterial, and the pre-built clone is intact and not already in the
// draft. `tool`/`noun` name the caller so the message reads as that tool's own, e.g.
// ("use_rubric", "rubric").
function validateDocumentAttachment(
  base: MutationGraph,
  args: { tlmId: string; clonedNodes: MutationNode[] },
  attachedId: string,
  tool: string,
  noun: string,
): string[] {
  const errors: string[] = [];
  const target = nodeById(base, args.tlmId);
  if (!target) {
    errors.push(`${tool}: document '${args.tlmId}' does not exist in the draft.`);
  } else if (!(target.labels ?? []).includes(TLM_LABEL)) {
    const labels = (target.labels ?? []).join("/") || "node";
    errors.push(`${tool}: '${args.tlmId}' is a ${labels} — a ${noun} attaches under a ${TLM_LABEL} (the document). Pass a TLM id, or a Course to resolve its TLM.`);
  }
  if (!args.clonedNodes.some((n) => n.id === attachedId)) {
    errors.push(`${tool}: the cloned ${noun} '${attachedId}' is missing from the copied subtree (retry).`);
  }
  for (const node of args.clonedNodes) {
    if (nodeById(base, node.id)) errors.push(`${tool}: copied id '${node.id}' already exists in the draft (retry).`);
  }
  return errors;
}

// Append the cloned subtree and hang its root under the document via `hasPart`.
// apply() runs before validate() on the dry-run, so a missing document must return
// base (→ a clean "blocked" from validate) rather than produce a dangling edge.
function attachUnderDocument(
  base: MutationGraph,
  args: { namespace: string; tlmId: string; clonedNodes: MutationNode[]; clonedEdges: MutationEdge[] },
  attachedId: string,
): MutationGraph {
  if (!nodeById(base, args.tlmId)) return base;
  const link: MutationEdge = {
    id: edgeId(CONTAINMENT, args.tlmId, attachedId),
    type: CONTAINMENT, from: args.tlmId, to: attachedId,
    namespace: args.namespace, properties: {},
  };
  return { nodes: [...base.nodes, ...args.clonedNodes], edges: [...base.edges, ...args.clonedEdges, link] };
}

export const useFormatter: GraphMutation<UseFormatterArgs> = {
  name: "useFormatter",
  describe: (args) => `copy a catalog formatter under document '${args.tlmId}'`,
  validate: (base, _after, args) => ({ errors: validateDocumentAttachment(base, args, args.newFormatterId, "use_formatter", "formatter"), warnings: [] }),
  apply: (base, args) => attachUnderDocument(base, args, args.newFormatterId),
};

// ── use_rubric: copy an evaluation grid under a document (TLM) ────────────────
// The third apply verb, alongside useRoutine (→ a Lesson) and useFormatter (→ a
// document). A RUBRIC is the grid a document is judged against — Annexe 8's approval
// checklist, Annexe 7's scored grid — so it attaches where a formatter does, under the
// TeachingLearningMaterial via `hasPart`: both are properties of the DOCUMENT, not of
// the curriculum. Attaching it is what makes "which grid governs this document"
// graph data instead of convention, and it is what evaluate_document reads.

// Turn a freshly-cloned rubric subtree into the document-layer shape: the entry →
// `Rubric`, its section children → `RubricSection`, their Material leaves →
// `RubricCriterion`, each with its catalog kind tags dropped. Content, weights and
// scale are untouched. Mirrors relabelClonedFormatter, one level deeper.
export function relabelClonedRubric(clone: ClonedSubtree): ClonedSubtree {
  const childIdsOf = (parentId: string): string[] =>
    clone.edges.filter((e) => e.type === CONTAINMENT && e.from === parentId).map((e) => e.to);

  const sectionIds = new Set(childIdsOf(clone.newEntryId));
  const criterionIds = new Set<string>();
  for (const sectionId of sectionIds) {
    for (const criterionId of childIdsOf(sectionId)) criterionIds.add(criterionId);
  }

  // null = leave this node alone (anything deeper than criteria, or a stray non-Material).
  const labelFor = (node: MutationNode): string | null => {
    if (node.id === clone.newEntryId) return RUBRIC_LABEL;
    if (sectionIds.has(node.id)) return RUBRIC_SECTION_LABEL;
    if (criterionIds.has(node.id) && isMaterial(node)) return RUBRIC_CRITERION_LABEL;
    return null;
  };

  const nodes = clone.nodes.map((node) => {
    const label = labelFor(node);
    if (!label) return node;
    return {
      ...node,
      type: label,
      labels: [label],
      properties: { ...(node.properties ?? {}), raw: withoutKindTags(rawOf(node)) },
    };
  });
  return { ...clone, nodes };
}

export type UseRubricArgs = {
  namespace: string;
  tlmId: string;                // the TeachingLearningMaterial the rubric judges
  clonedNodes: MutationNode[];
  clonedEdges: MutationEdge[];
  newRubricId: string;          // the cloned entry, relabelled to Rubric (the hasPart target)
};

export const useRubric: GraphMutation<UseRubricArgs> = {
  name: "useRubric",
  describe: (args) => `copy a catalog rubric under document '${args.tlmId}'`,
  validate: (base, _after, args) => ({ errors: validateDocumentAttachment(base, args, args.newRubricId, "use_rubric", "rubric"), warnings: [] }),
  apply: (base, args) => attachUnderDocument(base, args, args.newRubricId),
};

// ── Filing a copy BACK into a catalog ────────────────────────────────────────
// The inverse of relabelClonedFormatter / relabelClonedRubric. A copy that was
// relabelled to the document layer on its way OUT of the library has to be relabelled
// on its way back IN — otherwise it lands in the catalog as a `Formatter`, and
// listCatalogEntries skips it (that read only lists InstructionalRoutine entries), so
// the entry is filed but invisible.
//
// This is what makes a catalog entry recoverable from the graph copy alone: the
// content rides along in the clone, byte for byte, and is never retyped.

// Each document-layer ENTRY label, and how its subtree maps back to catalog shape.
// A routine has no entry here — it is stored as InstructionalRoutine either way.
const CATALOG_SHAPE_BY_ENTRY_LABEL: Record<string, { kind: CatalogKind; childLabels: Record<string, string> }> = {
  [FORMATTER_LABEL]: {
    kind: "formatter",
    childLabels: { [FORMATTER_SPEC_LABEL]: MATERIAL_LABEL },
  },
  [RUBRIC_LABEL]: {
    kind: "rubric",
    childLabels: { [RUBRIC_SECTION_LABEL]: ROUTINE_LABEL, [RUBRIC_CRITERION_LABEL]: MATERIAL_LABEL },
  },
};

// Restore the metadata the catalog reads: every node gets its `role` back, and the
// ENTRY also gets the `catalogKind` that tells list_catalog which kind it is. The
// inverse of withoutKindTags, which strips both on the way out.
function withCatalogKindTags(raw: Record<string, unknown>, role: string, catalogKind?: CatalogKind): Record<string, unknown> {
  const metadata: Record<string, unknown> = { ...((raw.metadata as Record<string, unknown>) ?? {}), role };
  if (catalogKind) { metadata.catalogKind = catalogKind; }
  return { ...raw, metadata };
}

// Turn a cloned subtree into CATALOG shape, whatever shape it currently has:
//   Formatter/FormatterSpec              → InstructionalRoutine + Material
//   Rubric/RubricSection/RubricCriterion → InstructionalRoutine + InstructionalRoutine + Material
//   InstructionalRoutine/Material        → unchanged (a routine is already catalog shape)
// Content and every other raw prop are untouched; only labels and the kind tags move.
export function relabelForCatalog(clone: ClonedSubtree): ClonedSubtree {
  const entry = clone.nodes.find((node) => node.id === clone.newEntryId);
  const entryLabel = labelsOf(entry)[0] ?? "";
  const shape = CATALOG_SHAPE_BY_ENTRY_LABEL[entryLabel];
  if (!shape) { return clone; }

  const nodes = clone.nodes.map((node) => {
    const isEntry = node.id === clone.newEntryId;
    const label = isEntry ? ROUTINE_LABEL : shape.childLabels[labelsOf(node)[0] ?? ""];
    if (!label) { return node; }

    const role = label === MATERIAL_LABEL ? MATERIAL_ROLE : ROUTINE_ROLE;
    return {
      ...node,
      type: label,
      labels: [label],
      properties: { ...(node.properties ?? {}), raw: withCatalogKindTags(rawOf(node), role, isEntry ? shape.kind : undefined) },
    };
  });
  return { ...clone, nodes };
}

// ── add_to_catalog: publish an authored entry INTO a catalog ─────────────────
// The inverse of useRoutine. useRoutine copies a library entry OUT onto a lesson;
// this copies an entry IN — a routine/formatter subtree authored in a subject
// graph, cloned (fresh ids, via cloneRoutineSubtree) into a catalog namespace and
// filed under that library's root container by `hasPart`, so list_catalog/use_*
// then surface it. The subtree is cloned by the tool (apply() sees only the target
// catalog's base), exactly as useRoutine takes its clone pre-built.

// The catalog's root container in `graph`: the fixed CATALOG_ROOT_ID when present
// (how every seeded library is built), else the routine that is nobody's hasPart
// child. null for a catalog with no container — the caller reports "seed first".
export function catalogRootId(graph: MutationGraph): string | null {
  if (graph.nodes.some((n) => n.id === CATALOG_ROOT_ID)) return CATALOG_ROOT_ID;
  const { hasRoutineParent } = indexContainment(graph);
  return graph.nodes.find((n) => isRoutine(n) && !hasRoutineParent.has(n.id))?.id ?? null;
}

export type AddCatalogEntryArgs = {
  namespace: string;            // the CATALOG namespace being written
  clonedNodes: MutationNode[];  // the entry subtree, fresh ids, already namespaced to the catalog
  clonedEdges: MutationEdge[];
  newEntryId: string;           // the cloned entry's id (filed under the catalog root)
};

export const addCatalogEntry: GraphMutation<AddCatalogEntryArgs> = {
  name: "addCatalogEntry",
  describe: (args) => `add a catalog entry (${args.newEntryId}) to library '${args.namespace}'`,
  validate: (base, _after, args) => {
    const errors: string[] = [];
    if (!catalogRootId(base)) errors.push(`add_to_catalog: '${args.namespace}' has no catalog root container to file under — seed the catalog first.`);
    if (!args.clonedNodes.some((n) => n.id === args.newEntryId)) errors.push(`add_to_catalog: the cloned entry '${args.newEntryId}' is missing from the copied subtree (retry).`);
    for (const n of args.clonedNodes) if (nodeById(base, n.id)) errors.push(`add_to_catalog: copied id '${n.id}' already exists in the catalog (retry).`);
    return { errors, warnings: [] };
  },
  apply: (base, args) => {
    const rootId = catalogRootId(base);
    if (!rootId) return base; // no container → clean "blocked" from validate
    const link: MutationEdge = { id: edgeId(CONTAINMENT, rootId, args.newEntryId), type: CONTAINMENT, from: rootId, to: args.newEntryId, namespace: args.namespace, properties: {} };
    return { nodes: [...base.nodes, ...args.clonedNodes], edges: [...base.edges, ...args.clonedEdges, link] };
  },
};
