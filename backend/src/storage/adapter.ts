/*
 * Module: storage · internal
 *
 * Holds the single StorageAdapter instance (lazily created). The adapter is a
 * credential-scoped client, safe to share across sessions. Internal to the
 * storage module — other modules go through storage/index.ts.
 */
import { createFirebaseStorage } from "./firebase.js";
import { __setFileRecordStoreForTest, createMemoryFileRecordStore } from "./file-records.js";
import type { StorageAdapter } from "../types.js";

let storage: StorageAdapter | null = null;
export const getStorageAdapter = (): StorageAdapter => (storage ??= createFirebaseStorage());

// A fake bucket always comes with an EMPTY in-memory record store. Every suite
// calls this, so none can reach the real database by forgetting a second
// setter — and a fake whose readHistory() returns entries has them imported on
// the first read, exactly as a live namespace does.
export function __setStorageForTest(replacement: StorageAdapter) {
  storage = replacement;
  __setFileRecordStoreForTest(createMemoryFileRecordStore());
}
