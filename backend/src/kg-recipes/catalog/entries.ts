/*
 * What a catalog ENTRY is, and how to read one.
 *
 * The identity half: where a catalog lives (`catalogNamespace`), the LC labels
 * and roles each kind is built from, the `CatalogEntry` projection `list_catalog`
 * returns, and `renderCatalogEntry` — the full authored spec `get_catalog_entry`
 * and the `catalog://` resource serve.
 *
 * A note on reading entry PROSE: an entry's text lives in its description body,
 * and a clone keeps its SOURCE node's id in `identifier` — both matter when
 * resolving what an entry says and what it came from.
 *
 * Read-only. Nothing here mutates a graph; copying lives in clone.ts, seeding in
 * seed.ts, and the mutations that attach an entry to content in apply.ts.
 */
import { kgNamespace, type MutationEdge, type MutationGraph, type MutationNode } from "../../kg-store/index.js";
import { displayName, descriptionBody } from "../../utils/index.js";

// The catalog namespace for a given scope. The third segment is historically
// "routines" (the catalog began routine-only); it now holds BOTH kinds, keyed by
// each entry's `kind`. Kept as-is so the already-seeded shared library isn't orphaned.
export const catalogNamespace = (workspace: string): string => kgNamespace(workspace, "_catalog", "routines");

// The reserved workspace that owns the cross-tenant shared library.
export const SHARED_CATALOG_WORKSPACE = "_shared";
export const SHARED_CATALOG_NAMESPACE = catalogNamespace(SHARED_CATALOG_WORKSPACE);

// The catalog's root container id — fixed so a re-seed overwrites the same node
// (deterministic, idempotent) rather than minting a second root.
export const CATALOG_ROOT_ID = "catalog-root";

export const ROUTINE_LABEL = "InstructionalRoutine";
export const MATERIAL_LABEL = "Material";
export const CONTAINMENT = "hasPart";

// The `metadata.role` tags a catalog entry's nodes carry. Stripped when a copy leaves
// the library (withoutKindTags) and restored when one is filed back in.
export const ROUTINE_ROLE = "instructional-routine";
export const MATERIAL_ROLE = "instructional-routine-material";

// The document-layer labels a formatter takes on when applied (Phase 4): the entry
// becomes a `Formatter`, its rule-bearing Material children `FormatterSpec`, and it
// hangs under a `TeachingLearningMaterial`. See docs/design-notes/teaching-learning-materials.md.
export const FORMATTER_LABEL = "Formatter";
export const FORMATTER_SPEC_LABEL = "FormatterSpec";
export const TLM_LABEL = "TeachingLearningMaterial";

// The document-layer labels a RUBRIC takes on when applied — an evaluation grid
// (Annexe 8's approval checklist, Annexe 7's scored grid) hung under the document it
// judges. Three levels, because a grid is sections of criteria: Rubric ─hasPart→
// RubricSection ─hasPart→ RubricCriterion. Non-canonical, like the rest of the
// document layer. See docs/design-notes/evaluation-rubrics.md.
export const RUBRIC_LABEL = "Rubric";
export const RUBRIC_SECTION_LABEL = "RubricSection";
export const RUBRIC_CRITERION_LABEL = "RubricCriterion";

// The labels a `usesRoutine` edge may originate from (canonical LC) — the valid
// targets of use_routine. A formatter no longer rides usesRoutine (it hangs under a
// TeachingLearningMaterial via hasPart — see useFormatter), so this is routines only.
export const ROUTINE_USERS = new Set(["Lesson", "Course", "Activity"]);

export type CatalogScope = "shared" | "workspace";
export type CatalogKind = "routine" | "formatter" | "rubric";

// One catalog entry as listed to a browsing curator — the entry's identity, its
// kind, which scope it came from, plus a shallow outline (its steps) so the pick is
// informed without reading materials.
// One Material node under an entry: the id `edit_nodes` takes, plus its display name.
// These ids are surfaced HERE because a catalog cannot be traversed — walk_graph
// reads a parsed CurriculumModel and a catalog namespace has no subject profile to
// parse it with, so list_catalog / get_catalog_entry are the ONLY place a curator
// can learn which node holds a given spec's text.
export type CatalogMaterial = { id: string; name: string };

export type CatalogEntry = {
  id: string;
  kind: CatalogKind;
  scope: CatalogScope;          // which library this entry lives in (drives edit rights)
  name: string;                 // the entry's title (raw.description)
  summary: string;              // cross-cutting rules (raw.metadata.summary), "" when absent
  scale?: string;               // a RUBRIC's scoring scale, e.g. "0-4" or "oui-non"
  // A rubric's SECTIONS list here too — same shape as a routine's steps, with the
  // section's `weight` ("20%") in place of a step's `timeRequired`.
  steps: Array<{ id: string; name: string; order: number; timeRequired?: string; weight?: string; materials: CatalogMaterial[] }>;
  materials: CatalogMaterial[]; // the entry's OWN direct Materials — a formatter's spec
  materialCount: number;        // load-bearing Material leaves under the entry
};

export const labelsOf = (n: MutationNode | undefined): string[] => n?.labels ?? [];
export const isRoutine = (n: MutationNode | undefined): boolean => labelsOf(n).includes(ROUTINE_LABEL);
export const isMaterial = (n: MutationNode | undefined): boolean => labelsOf(n).includes(MATERIAL_LABEL);
export const rawOf = (n: MutationNode): Record<string, unknown> => (n.properties?.raw as Record<string, unknown>) ?? {};
export const metaOf = (n: MutationNode): Record<string, unknown> => (rawOf(n).metadata as Record<string, unknown>) ?? {};

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

// An entry's kind is tagged in metadata; entries with no tag are routines (the
// original kind, and how the already-seeded shared library reads). Two tags mean
// formatter: `catalogKind:"formatter"` (how the seeded shared formatters are stamped)
// and `role:"formatter"` (how an author who built one via add_nodes tags it — there is
// no "Formatter" LC label to reach for, so the author overloads role). Either counts.
export const kindOf = (n: MutationNode): CatalogKind => {
  const meta = metaOf(n);
  if (meta.catalogKind === "rubric") return "rubric";
  if (meta.catalogKind === "formatter" || meta.role === "formatter") return "formatter";
  return "routine";
};

// An entry's cross-cutting rules. They used to sit in `metadata.summary`; a migrated
// routine carries them below the name line of its own `description`. Read both so a
// library migrated at a different moment than its subject graph still renders.
const summaryOf = (n: MutationNode): string =>
  str(metaOf(n).summary) || descriptionBody(str(rawOf(n).description));

// One block of authored text with the id that holds it. A formatter's and a rubric's
// bodies are still Material `content`; a routine step's is the body of its own
// description (`content` covers a flat step authored before the migration).
const bodiesOf = (n: MutationNode, materialChildren: MutationNode[]): Array<{ id: string; content: string }> => {
  if (materialChildren.length > 0) {
    return materialChildren.map((m) => ({ id: m.id, content: str(rawOf(m).content) }));
  }
  const own = str(rawOf(n).content) || descriptionBody(str(rawOf(n).description));
  return own ? [{ id: n.id, content: own }] : [];
};

// A step's ordinal comes from raw.position or raw.metadata.order (CI maths writes
// both); fall back to 0 so a malformed step still lists in a stable place.
const orderOf = (n: MutationNode): number => num(rawOf(n).position) ?? num(metaOf(n).order) ?? 0;

// Index the hasPart tree once: children[parent] = [childIds], and the set of nodes
// that are some routine's hasPart child (so a root is a routine that is nobody's).
export function indexContainment(graph: MutationGraph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>();
  const hasRoutineParent = new Set<string>();
  for (const e of graph.edges) {
    if (e.type !== CONTAINMENT) continue;
    (children.get(e.from) ?? children.set(e.from, []).get(e.from)!).push(e.to);
    if (isRoutine(byId.get(e.from))) hasRoutineParent.add(e.to);
  }
  return { byId, children, hasRoutineParent };
}

// The entries a curator can pick: the root container's routine children. The root is
// the routine with no routine parent; its hasPart routine children are the entries,
// and each entry's routine children are its steps. A catalog with no root-container
// (e.g. loose routines) yields [] — the browse surface expects the container shape.
export function listCatalogEntries(graph: MutationGraph, scope: CatalogScope): CatalogEntry[] {
  const { byId, children, hasRoutineParent } = indexContainment(graph);
  const roots = graph.nodes.filter((n) => isRoutine(n) && !hasRoutineParent.has(n.id));

  const entries: CatalogEntry[] = [];
  for (const root of roots) {
    for (const entryId of children.get(root.id) ?? []) {
      const entry = byId.get(entryId);
      if (!entry || !isRoutine(entry)) continue;
      entries.push(describeEntry(entry, byId, children, scope));
    }
  }
  return entries;
}

function describeEntry(entry: MutationNode, byId: Map<string, MutationNode>, children: Map<string, string[]>, scope: CatalogScope): CatalogEntry {
  const steps: CatalogEntry["steps"] = [];
  const materials: CatalogMaterial[] = [];
  let materialCount = 0;
  const kind = kindOf(entry);

  const asMaterial = (n: MutationNode): CatalogMaterial => ({ id: n.id, name: displayName(str(rawOf(n).description)) });

  // The Material children directly under `parentId`. Empty for a FLAT step, whose
  // text lives on the step node itself — there, the step's own id is what edit_nodes
  // takes, so no separate material entry is needed.
  const materialsUnder = (parentId: string): CatalogMaterial[] =>
    (children.get(parentId) ?? [])
      .map((id) => byId.get(id))
      .filter((n): n is MutationNode => isMaterial(n))
      .map(asMaterial);

  const asStep = (n: MutationNode) => ({
    id: n.id,
    name: displayName(str(rawOf(n).description)),
    order: orderOf(n),
    timeRequired: str(rawOf(n).timeRequired) || undefined,
    // Only a rubric SECTION carries a weight ("20%"); a routine step has none.
    weight: str(metaOf(n).weight) || undefined,
    materials: materialsUnder(n.id),
  });

  for (const childId of children.get(entry.id) ?? []) {
    const child = byId.get(childId);
    if (!child) continue;
    if (isRoutine(child)) {
      // Nested step shape: a step is a child routine, its body in a Material grandchild.
      steps.push(asStep(child));
      materialCount += materialsUnder(child.id).length;
    } else if (isMaterial(child)) {
      materialCount += 1;
      // Every direct Material is listed in `materials`, whatever the kind — a
      // formatter's spec lives ONLY here, and listing a routine's flat steps here
      // too keeps the field's meaning uniform ("the entry's own Materials") rather
      // than kind-dependent. Kind still decides what counts as a STEP.
      materials.push(asMaterial(child));
      // Flat step shape (add_nodes → add_to_catalog): a ROUTINE's direct Material child
      // IS a step (name/order/timing on the Material itself). A FORMATTER's direct
      // Materials are its spec, not steps.
      if (kind === "routine") steps.push(asStep(child));
    }
  }
  steps.sort((a, b) => a.order - b.order);
  return {
    id: entry.id,
    kind,
    scope,
    name: displayName(str(rawOf(entry).description)),
    summary: summaryOf(entry),
    scale: str(metaOf(entry).scale) || undefined,
    steps,
    materials,
    materialCount,
  };
}

// One entry's FULL detail rendered as markdown, for the browse resource surface.
// Where listCatalogEntries gives a shallow outline (step names + a material count),
// this includes the load-bearing authored spec: a formatter's Material content, and
// each routine step's inline `description`. Returns null when the id isn't a routine
// entry in this graph.
export type RenderCatalogEntryOptions = {
  // Print `edit_nodes nodeId:` above each authored block. TRUE for the MCP surfaces,
  // whose caller can act on it; FALSE for the explorer, a read-only human viewer
  // where a tool-call instruction is noise that implies an edit it cannot make.
  editHints?: boolean;
};

export function renderCatalogEntry(
  graph: MutationGraph,
  entryId: string,
  scope: CatalogScope,
  options: RenderCatalogEntryOptions = {},
): string | null {
  const { byId, children } = indexContainment(graph);
  const entry = byId.get(entryId);
  if (!entry || !isRoutine(entry)) return null;

  const childrenOf = (id: string) => (children.get(id) ?? []).map((c) => byId.get(c)).filter((n): n is MutationNode => !!n);
  const kind = kindOf(entry);

  // Name the node each block of text lives on. Without this a reader who spots a
  // problem in the rendered spec has no way back to the node that holds it — a
  // catalog is not walkable, so this markdown is the only place the id appears
  // next to its content.
  const showEditHints = options.editHints ?? true;
  const editHint = (id: string) => (showEditHints ? [`\`edit_nodes\` nodeId: \`${id}\``, ""] : []);
  const lines: string[] = [`# ${displayName(str(rawOf(entry).description)) || entryId}`, "", `*${kind} · ${scope} catalog*`, ""];
  const summary = summaryOf(entry);
  if (summary) lines.push(summary, "");

  if (kind === "formatter") {
    // A formatter's spec sits in its direct Material children — rendered flat, no headings.
    for (const m of childrenOf(entry.id).filter(isMaterial)) {
      const content = str(rawOf(m).content);
      if (content) lines.push(...editHint(m.id), content, "");
    }
  } else if (kind === "rubric") {
    // A grid: weighted sections of named criteria. Unlike a routine step (whose text
    // IS the body), a criterion has BOTH a name ("Alignement aux objectifs") and a
    // measurable indicator, so the name gets its own heading above the indicator.
    const scale = str(metaOf(entry).scale);
    if (scale) lines.push(`**Échelle : ${scale}**`, "");
    const sections = childrenOf(entry.id).filter(isRoutine).sort((a, b) => orderOf(a) - orderOf(b));
    for (const section of sections) {
      const weight = str(metaOf(section).weight);
      lines.push(`## ${displayName(str(rawOf(section).description))}${weight ? `  (poids : ${weight})` : ""}`, "");
      for (const criterion of childrenOf(section.id).filter(isMaterial).sort((a, b) => orderOf(a) - orderOf(b))) {
        lines.push(`### ${displayName(str(rawOf(criterion).description))}`, "", ...editHint(criterion.id));
        const indicator = str(rawOf(criterion).content);
        if (indicator) lines.push(indicator, "");
      }
    }
  } else {
    // A routine's ordered steps, each under its own heading. A step is either a child
    // InstructionalRoutine (body in a Material grandchild) or a direct Material child
    // (body in its own content) — see describeEntry; both shapes render the same.
    const steps = childrenOf(entry.id).filter((c) => isRoutine(c) || isMaterial(c)).sort((a, b) => orderOf(a) - orderOf(b));
    for (const step of steps) {
      const timing = str(rawOf(step).timeRequired);
      lines.push(`## ${displayName(str(rawOf(step).description))}${timing ? `  (${timing})` : ""}`, "");
      // The step node itself holds the text now, so it IS what edit_nodes takes; a
      // pre-migration nested step's text sits in Material grandchildren instead.
      const bodies = bodiesOf(step, isMaterial(step) ? [] : childrenOf(step.id).filter(isMaterial));
      for (const body of bodies) {
        if (body.content) lines.push(...editHint(body.id), body.content, "");
      }
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
