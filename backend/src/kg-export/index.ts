/*
 * Layer: app · read-only KG export
 *
 * Backs the live KG explorer (a hosted static page) and the in-chat graph
 * artifact. Reads the generic node/edge store and transforms it into the
 * "display schema" the explorer's views + modal consume. Published-only by
 * default: a curator's in-flight edit never leaks here until they publish, and
 * the draft read that does exist is gated by the caller (see namespace.ts).
 *
 * Purely additive — it reuses the same store the MCP read/curator tools use
 * (getKgStore + readPointer/listNodes/listEdges) and the same namespace
 * enumeration. It does NOT go through the subject adapters, because the
 * explorer needs the WHOLE graph rather than a per-unit slice.
 *
 * The explorer follows the LEARNING-COMMONS ONTOLOGY ONLY: every node is
 * categorised and coloured by its LC label, and the two views it offers —
 * containment and by-label — are derived from the graph in hand. That is why
 * there is no subject vocabulary anywhere below (no domaine, chapitre, semaine,
 * strand, palier). See docs/design-notes/kg-explorer-findings.md.
 *
 * The parts, in the order data flows through them:
 *
 *   types.ts      the display schema + legend taxonomy (mirrored by the frontend)
 *   display.ts    one stored node/edge → its display shape; namespace labels
 *   views.ts      the derived view config + the shared graph projection
 *   namespace.ts  which namespaces are offerable, and one namespace's whole graph
 *   subtree.ts    a scoped, self-bounded slice for an in-chat artifact
 *   libraries.ts  the catalogs and the bilingual lexicon a namespace can reach
 */
export type {
  DisplayNode, DisplayEdge, DisplayGraph, TaxonomyEntry, ViewConfig, ViewSpec, GroupByLevel,
} from "./types.js";
export { listExportNamespaces, exportNamespace, type NamespaceEntry } from "./namespace.js";
export { exportSubtree, type SubtreeExport } from "./subtree.js";
export { exportCatalog, exportCatalogEntry, exportTerminology } from "./libraries.js";
export type { CatalogScopeEntry, CatalogExport, TerminologyExport } from "./libraries.js";
