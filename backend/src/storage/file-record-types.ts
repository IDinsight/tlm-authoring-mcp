/*
 * Module: storage · the per-file record store's contract
 *
 * The interface and the small types both stores are written against — the
 * in-memory one (file-records.ts) and the database one
 * (file-records-firestore.ts). Its own file so neither has to import the other.
 */
import { randomUUID } from "node:crypto";
import type { HistoryEntry } from "../types.js";

/** When a namespace's legacy history.json was imported, and how many entries it held. */
export type LegacyImport = { importedAt: string; count: number };

/**
 * What one small read says about a namespace's records, before any is fetched.
 *
 * `revision` changes on every write, so a reader holding a copy of the records
 * can tell in one cheap read whether that copy is still good — the records of
 * ci/maths weigh megabytes, and most calls only need to know nothing moved.
 */
export type NamespaceState = {
  revision: string | null;            // null until the first record is written
  legacyImport: LegacyImport | null;  // null until history.json has been imported
};

export interface FileRecordStore {
  state(namespace: string): Promise<NamespaceState>;

  /** Every record of one namespace, in no particular order. */
  list(namespace: string): Promise<HistoryEntry[]>;

  /**
   * Write several records as ONE change: a new file and the older ones it
   * replaces land together or not at all. Each record overwrites the one
   * already stored under its relPath. Moves `revision`.
   */
  putAll(namespace: string, records: HistoryEntry[]): Promise<void>;

  /** Forget the records of files that are gone from the bucket. Moves `revision`. */
  removeAll(namespace: string, relPaths: string[]): Promise<void>;

  /** Record that the legacy import ran, so it never runs twice. */
  markLegacyImported(namespace: string, done: LegacyImport): Promise<void>;
}

/** A fresh revision. Its only property is that it differs from every earlier one. */
export const newRevision = (): string => randomUUID();
