/*
 * Exporting the LIBRARIES a namespace can see: its catalogs and its lexicon.
 *
 * Neither is curriculum. A catalog is the reusable routines / formatters /
 * rubrics visible from a namespace — both the cross-tenant shared library and
 * the workspace's own — and the lexicon is the workspace's bilingual glossary
 * (LexiconEntry nodes) that the `translate` and `get_terminology` tools ground
 * on. They ship through the same read-only endpoint so an author can browse
 * them, and they are grouped here because they share that "what else can this
 * namespace reach" question.
 */
import { getKgStore, parseNamespace } from "../kg-store/index.js";
import type { MutationGraph, MutationNode, MutationEdge } from "../kg-store/index.js";
import {
  SHARED_CATALOG_NAMESPACE, catalogNamespace, listCatalogEntries, renderCatalogEntry,
  type CatalogEntry, type CatalogScope,
} from "../kg-recipes/index.js";
import { glossaryNamespace, readGlossaryEntries, type LexiconEntry } from "../glossary/index.js";

// ── Export the catalog libraries visible from a namespace ─────────────────────
// The explorer's Catalog tab. Given a curriculum namespace (workspace:grade:subject),
// it reads the two libraries a curator of that workspace can browse — the shared
// cross-tenant library and the workspace's own — and returns their entries. Each
// entry already carries its scope (shared | workspace), kind (routine | formatter),
// name, summary, ordered steps, and material count (see listCatalogEntries).
//
// This mirrors the server's list_catalog tool, but keyed by namespace rather than by
// the active session context (the read routes are stateless — no set_context).

export type CatalogScopeEntry = { scope: CatalogScope; namespace: string };
export type CatalogExport = { scopes: CatalogScopeEntry[]; entries: CatalogEntry[] };

// Read one catalog namespace's published slot as a plain graph. Empty when that
// library has never been seeded (no pointer) — mirrors server/catalog.ts::readCatalog,
// duplicated here so the read routes don't reach up into the server (app) layer.
async function readCatalogGraph(namespace: string): Promise<MutationGraph> {
  const store = getKgStore();
  const pointer = await store.readPointer(namespace);
  if (!pointer) return { nodes: [], edges: [] };
  const [nodes, edges] = await Promise.all([
    store.listNodes(namespace, pointer.publishedSlot),
    store.listEdges(namespace, pointer.publishedSlot),
  ]);
  const dropSlot = <T extends { slot: unknown }>(x: T): Omit<T, "slot"> => { const { slot, ...rest } = x; return rest; };
  return { nodes: nodes.map((n) => dropSlot(n) as MutationNode), edges: edges.map((e) => dropSlot(e) as MutationEdge) };
}

// The catalog scopes reachable from a curriculum namespace: the shared library
// always, plus that namespace's workspace library (dropped when the workspace IS
// the shared one, so there is just one library). null for a non-curriculum ns
// (e.g. a reserved `_catalog` partition), which owns no catalog view.
function catalogScopesFor(ns: string): CatalogScopeEntry[] | null {
  const parsed = parseNamespace(ns);
  if (!parsed) return null;
  const scopes: CatalogScopeEntry[] = [{ scope: "shared", namespace: SHARED_CATALOG_NAMESPACE }];
  const workspaceNs = catalogNamespace(parsed.workspace);
  if (workspaceNs !== SHARED_CATALOG_NAMESPACE) scopes.push({ scope: "workspace", namespace: workspaceNs });
  return scopes;
}

export async function exportCatalog(ns: string): Promise<CatalogExport | null> {
  const scopes = catalogScopesFor(ns);
  if (!scopes) return null;
  const perScope = await Promise.all(scopes.map(async (s) => listCatalogEntries(await readCatalogGraph(s.namespace), s.scope)));
  return { scopes, entries: perScope.flat() };
}

// One catalog entry's FULL authored spec as markdown (the click-through detail the
// list only counts). Searches the same two libraries; null when the id isn't an
// entry in either. Mirrors the get_catalog_entry tool.
export async function exportCatalogEntry(ns: string, id: string): Promise<string | null> {
  const scopes = catalogScopesFor(ns);
  if (!scopes) return null;
  for (const s of scopes) {
    // No edit hints: the explorer is a read-only viewer, and `edit_nodes nodeId:` is
    // an instruction for an MCP caller, not for the person reading the spec.
    const markdown = renderCatalogEntry(await readCatalogGraph(s.namespace), id, s.scope, { editHints: false });
    if (markdown) return markdown;
  }
  return null;
}

// ── Export the workspace's bilingual lexicon ─────────────────────────────────
// The explorer's Terminology tab. Given any curriculum namespace, it resolves the
// namespace's workspace and returns that workspace's whole published glossary
// (LexiconEntry entries), so authors can browse the FR/Wolof terminology the
// translate + get_terminology tools ground on. Mirrors the catalog export's
// namespace-keyed, stateless shape. null for a namespace that has no workspace.

export type TerminologyExport = { workspace: string; entries: LexiconEntry[] };

export async function exportTerminology(ns: string): Promise<TerminologyExport | null> {
  const parsed = parseNamespace(ns);
  if (!parsed) return null;
  const entries = await readGlossaryEntries(glossaryNamespace(parsed.workspace));
  return { workspace: parsed.workspace, entries };
}
