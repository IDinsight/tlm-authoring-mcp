/*
 * Public surface of the curriculum module: the normalized-model builder, the
 * FR/Wolof terminology lookups, and the shared bridge that materialises a
 * CurriculumModel from stored nodes+edges. The per-subject raw-graph parsing +
 * projection now lives one directory up in src/adapters/*, so this barrel
 * only exposes the pieces those adapters compose on top of.
 */
export { buildModel, unit } from "./model.js";
export { parseGraph, type GraphParseDescriptor } from "./parse-graph.js";
export { searchTerminology, allTerminologyEntries } from "./terminology.js";
export { serializeModel, deserializeToModel, toRawEnvelope, fromRawEnvelope, edgeId, PRELOADED_MODEL_KEY, PRELOADED_SLOT_KEY } from "./store-bridge.js";
export { resolvePrune, type PruneStrategySpec } from "./prunes.js";
export { coursesOf, courseSubgraph, standardsFor } from "./courses.js";
export { documentSubgraph, documentSectionSubgraph, type DocumentScope, type DocumentSectionOut, type DocumentSectionScope, type SectionRoutine } from "./documents.js";
export { walkGraph, type WalkArgs, type WalkDirection, type WalkResult } from "./walk.js";
export { findNodes, resolveRef, toFindable, type FoundNode, type FindArgs, type ResolvedRef, type MatchQuality, type FindableGraph } from "./find.js";
export { computeGraphStats, type GraphStats, type StatsRoot } from "./stats.js";
export { readCachedModel, writeCachedModel, __clearModelCache, type ModelVersion } from "./model-cache.js";

// The CONTENT lint — check_draft checks wiring, review_draft coverage, this consistency.
export { lintContent, lintableRules, CONTENT_RULES, citedIds, minutesFromIso, minutesFromTitle, type ContentRule, type ContentLintInput, type ContentLintOptions } from "./lint-content.js";
