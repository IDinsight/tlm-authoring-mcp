/*
 * Catalog — a library of reusable spec blocks (instructional routines, formatters
 * and evaluation rubrics) that a curator browses and copies onto content.
 *
 * The catalog lives in a reserved `_catalog` partition, ONE graph per SCOPE:
 *   - the cross-tenant SHARED library (workspace `_shared`), and
 *   - each workspace's own library (workspace = that tenant).
 * Both scopes share one shape — a three-level containment tree in canonical LC:
 *
 *   InstructionalRoutine (root container)          ← one per catalog graph, holds the entries
 *     ─hasPart→ InstructionalRoutine (ENTRY)       ← a catalog entry: "Fiche de leçon", …
 *                 ─hasPart→ InstructionalRoutine (step) ─hasPart→ Material
 *
 * Each entry carries a `kind` (routine | formatter | rubric). Using an entry COPIES it:
 * cloneRoutineSubtree mints fresh ids for the entry and its whole subtree into the
 * active subject's namespace. A ROUTINE attaches to a Lesson via `usesRoutine`
 * (`useRoutine`); a FORMATTER is relabelled to the document-layer Formatter/
 * FormatterSpec shape (`relabelClonedFormatter`) and hung under the document's
 * TeachingLearningMaterial via `hasPart` (`useFormatter`) — formatting is a property
 * of the DOCUMENT, not the curriculum, so it never rides a Course's `usesRoutine`
 * edge (the pre-Phase-4 stopgap the TLM migration moved away from). A RUBRIC — the
 * evaluation grid a document is judged against — attaches the same way, relabelled to
 * Rubric/RubricSection/RubricCriterion (`useRubric`), because which grid governs a
 * document is a property of the document too. The copy is
 * independent — later edits to the library entry do NOT reach copies already made
 * (that independence is the point). Edit rights follow the entry's namespace:
 * `_shared` writes need super_admin, `<workspace>` writes its curators.
 *
 * See docs/design-notes/authorable-catalog.md.
 *
 * The parts:
 *
 *   entries.ts  what an entry IS — namespace, labels, the CatalogEntry
 *               projection, and rendering one entry's full authored spec
 *   clone.ts    copying an entry's subtree with fresh ids (the copy is
 *               independent of the library entry, deliberately)
 *   seed.ts     assembling a catalog namespace from source snapshots
 *   apply.ts    the four mutations — use_routine / use_formatter / use_rubric,
 *               and add_to_catalog, which files an authored entry back
 */
export {
  catalogNamespace, SHARED_CATALOG_WORKSPACE, SHARED_CATALOG_NAMESPACE, CATALOG_ROOT_ID,
  listCatalogEntries, renderCatalogEntry,
} from "./entries.js";
export type { CatalogScope, CatalogKind, CatalogMaterial, CatalogEntry, RenderCatalogEntryOptions } from "./entries.js";
export { cloneRoutineSubtree, type ClonedSubtree } from "./clone.js";
export { assembleCatalog } from "./seed.js";
export {
  useRoutine, useFormatter, useRubric, addCatalogEntry,
  relabelClonedFormatter, relabelClonedRubric, relabelForCatalog, catalogRootId,
} from "./apply.js";
export type { UseRoutineArgs, UseFormatterArgs, UseRubricArgs, AddCatalogEntryArgs } from "./apply.js";
