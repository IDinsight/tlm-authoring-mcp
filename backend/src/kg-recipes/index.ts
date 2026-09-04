/*
 * kg-recipes · public surface
 *
 * The generic curriculum verbs (add_nodes / edit_nodes / move_node / …)
 * that compose kg-store's structural primitives, plus the get_capabilities
 * mirror. External callers (server/*) import the verbs from here.
 *
 * Layering gotcha: import kg-store ONLY through its barrel (../kg-store/index.js),
 * a one-way edge (kg-store never imports back) that check-cycles enforces.
 */

export { addNode, type AddNodeArgs } from "./add-node.js";
export { addNodes, type AddNodesArgs, type AddNodesItem } from "./add-nodes.js";
export { createEdges, type CreateEdgesArgs, type CreateEdgesItem } from "./create-edges.js";
export { moveNode, type MoveNodeArgs } from "./move-node.js";
export { reposition, type RepositionArgs } from "./reposition.js";
export { setContent, type SetContentArgs } from "./set-content.js";
export { editNode, type EditNodeArgs } from "./edit-node.js";
export { editNodes, type EditNodesArgs, type EditNodesItem } from "./edit-nodes.js";
export { createDocument, addSection, type CreateDocumentArgs, type AddSectionArgs } from "./document.js";
export { RECIPES, type RecipeDescriptor, type RecipeParam } from "./registry.js";
export {
  catalogNamespace, SHARED_CATALOG_NAMESPACE, SHARED_CATALOG_WORKSPACE, CATALOG_ROOT_ID,
  listCatalogEntries, renderCatalogEntry, cloneRoutineSubtree, assembleCatalog, useRoutine,
  relabelClonedFormatter, useFormatter, relabelClonedRubric, useRubric, relabelForCatalog,
  addCatalogEntry, catalogRootId,
  type CatalogEntry, type CatalogScope, type CatalogKind, type CatalogMaterial, type ClonedSubtree,
  type UseRoutineArgs, type UseFormatterArgs, type UseRubricArgs, type AddCatalogEntryArgs,
} from "./catalog/index.js";
export {
  containmentEdgeFor, deriveTemplate, isKnownLabel, orderPathsOf,
  ALIGNMENT_EDGE, POSITION, type NodeTemplate,
} from "./lc.js";

// The formatter's declarative half — its schema, and the authoring-time check.
export { renderSpecSchema, validateRenderSpec, validateRenderInBag, type RenderSpec } from "./render-spec.js";
