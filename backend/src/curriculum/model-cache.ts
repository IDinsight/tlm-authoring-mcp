/*
 * Module: curriculum · hydrated-model cache
 *
 * activateContext parses the whole published graph into a CurriculumModel, and
 * the claude.ai client opens a fresh MCP session per tool call — so without a
 * cache every call re-read ~2,100 (ci/maths) to ~4,200 (ce1/reading) Firestore
 * documents to rebuild a model identical to the last one.
 *
 * The cache is keyed by CONTENT, never by time: the caller passes the version
 * it just read from the namespace's pointer document, and a mismatch is a miss.
 * That keeps a publish correct by construction — publish_draft writes a new
 * graph hash (or a new profile), so the very next activation cannot hit a stale
 * entry. There is no TTL and nothing to invalidate by hand.
 *
 * Bounded by the number of namespaces (one entry each, replaced in place).
 * Measured: three hydrated models retain ~12.6 MB total, against Cloud Run's
 * 512 MB default.
 */
import type { CurriculumModel } from "../types.js";

/**
 * Everything that can change what `activateContext` would produce for a
 * namespace: the slot it read, the graph's content hash, and a hash of the
 * subject profile (which drives the parse, and can be published on its own
 * without the graph hash moving).
 */
export type ModelVersion = {
  publishedSlot: string;
  contentHash: string;
  configHash: string;
};

type CacheEntry = ModelVersion & { model: CurriculumModel };

const cache = new Map<string, CacheEntry>();

const sameVersion = (entry: CacheEntry, version: ModelVersion): boolean =>
  entry.publishedSlot === version.publishedSlot
  && entry.contentHash === version.contentHash
  && entry.configHash === version.configHash;

/** The cached model for this namespace at exactly this version, or null. */
export function readCachedModel(namespace: string, version: ModelVersion): CurriculumModel | null {
  const entry = cache.get(namespace);
  if (!entry || !sameVersion(entry, version)) {
    return null;
  }
  return entry.model;
}

/** Cache `model` as this namespace's hydration at `version`, replacing any prior entry. */
export function writeCachedModel(namespace: string, version: ModelVersion, model: CurriculumModel): void {
  cache.set(namespace, { ...version, model });
}

/** Drop every entry. For tests, and for a store swapped underneath the process. */
export function __clearModelCache(): void {
  cache.clear();
}
