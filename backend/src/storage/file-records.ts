/*
 * Module: storage · the per-file record store
 *
 * One record per produced file, where there used to be one history.json per
 * namespace holding all of them. That single object was read whole and written
 * whole, so two sessions recording files at the same time each saved their own
 * copy and the second erased the first's entry. A record per file means a write
 * touches only the files it is about.
 *
 * This file is the lazy singleton and the in-memory store the tests run on (the
 * same split as workspaces/). The contract is file-record-types.ts and the
 * database-backed store file-records-firestore.ts.
 * Full rationale: docs/design-notes/file-status.md.
 */
import type { HistoryEntry } from "../types.js";
import { newRevision, type FileRecordStore, type NamespaceState } from "./file-record-types.js";
import { createFirestoreFileRecordStore } from "./file-records-firestore.js";

export type { FileRecordStore, LegacyImport, NamespaceState } from "./file-record-types.js";

let store: FileRecordStore | null = null;

export function getFileRecordStore(): FileRecordStore {
  return (store ??= createFirestoreFileRecordStore());
}

export function __setFileRecordStoreForTest(replacement: FileRecordStore | null): void {
  store = replacement;
}

// ── In-memory implementation (tests) ─────────────────────────────────────────

// Records are cloned on the way in and on the way out. Without that a caller
// holding a returned entry could change the stored one by assigning to it,
// which the database-backed store can never allow — and a test passing for that
// reason would be passing on a behaviour production does not have.
const clone = <T>(value: T): T => structuredClone(value);

const recordKey = (namespace: string, relPath: string): string => `${namespace}::${relPath}`;

export function createMemoryFileRecordStore(): FileRecordStore {
  const records = new Map<string, { namespace: string; entry: HistoryEntry }>();
  const states = new Map<string, NamespaceState>();

  const stateOf = (namespace: string): NamespaceState =>
    states.get(namespace) ?? { revision: null, legacyImport: null };

  const moveRevision = (namespace: string): void => {
    states.set(namespace, { ...stateOf(namespace), revision: newRevision() });
  };

  return {
    async state(namespace) {
      return clone(stateOf(namespace));
    },

    async list(namespace) {
      const inNamespace = [...records.values()].filter((record) => record.namespace === namespace);
      return inNamespace.map((record) => clone(record.entry));
    },

    async putAll(namespace, entries) {
      if (entries.length === 0) {
        return;
      }
      for (const entry of entries) {
        records.set(recordKey(namespace, entry.relPath), { namespace, entry: clone(entry) });
      }
      moveRevision(namespace);
    },

    async removeAll(namespace, relPaths) {
      if (relPaths.length === 0) {
        return;
      }
      for (const relPath of relPaths) {
        records.delete(recordKey(namespace, relPath));
      }
      moveRevision(namespace);
    },

    async markLegacyImported(namespace, done) {
      states.set(namespace, { ...stateOf(namespace), legacyImport: done });
    },
  };
}
