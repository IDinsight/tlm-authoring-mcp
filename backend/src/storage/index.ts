/*
 * Public surface of the storage module. Other modules import from here, never
 * from storage/*'s internal files. Firebase wiring and the record cache stay
 * internal (siblings import each other directly within the module).
 */
export { getStorageAdapter, __setStorageForTest } from "./adapter.js";
export { readGlobalObject, writeGlobalObject } from "./firebase.js";
export { extractDocxText } from "./documents.js";
export { listEntries, getEntry, entriesForNode, recordContent, recordVerdicts, reconcile } from "./history.js";
export type { RecordedFile, FileVerdictResult, FileVerdictRefusal } from "./history.js";
export { FILE_STATUSES, FILE_VERDICTS, statusOf, isCurrent, countByStatus } from "./file-status.js";
export { getFileRecordStore, __setFileRecordStoreForTest, createMemoryFileRecordStore } from "./file-records.js";
export type { FileRecordStore } from "./file-records.js";
