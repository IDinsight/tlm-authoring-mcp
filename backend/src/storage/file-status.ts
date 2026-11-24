/*
 * Module: storage · where a recorded file stands
 *
 * The rules that turn an entry's own fields into a status — replaced, approved,
 * sent back — and that decide which older files a new one takes the place of.
 * Pure: no store, no clock, no bucket, so every rule is a one-line test.
 * Full rationale: docs/design-notes/file-status.md.
 */
import type { FileStatus, FileVerdict, HistoryEntry } from "../types.js";

/** Every status, in the order a file usually moves through them. */
export const FILE_STATUSES: readonly FileStatus[] = ["unfiled", "replaced", "produced", "changes_requested", "approved"];

/** The verdicts a person can give. */
export const FILE_VERDICTS: readonly FileVerdict[] = ["approved", "changes_requested"];

/**
 * A file is FILED when it says which document it is and in which language.
 * The 2026-08 pupil files recorded before those two fields existed say neither.
 */
export function isFiled(entry: HistoryEntry): boolean {
  return entry.documentId !== undefined && entry.variant !== undefined;
}

/** Same lesson, same document, same language: the two files are versions of one thing. */
export function sameSlot(a: HistoryEntry, b: HistoryEntry): boolean {
  return a.nodeId === b.nodeId && a.documentId === b.documentId && a.variant === b.variant;
}

/**
 * Where a file stands, read off the entry.
 *
 * Order matters. A replaced file stays "replaced" even if it was approved first:
 * the approval was of a file that is no longer the one in use.
 */
export function statusOf(entry: HistoryEntry): FileStatus {
  if (!isFiled(entry)) {
    return "unfiled";
  }
  if (entry.replacedBy !== undefined) {
    return "replaced";
  }

  // A verdict counts only for the bytes it was given on. Uploading the file
  // again under the same path changes md5, and the old verdict stops applying.
  const review = entry.review;
  const verdictStillApplies = review !== undefined && review.md5 === entry.md5;
  return verdictStillApplies ? review.verdict : "produced";
}

/** The current file of its lesson, document and language: filed, and not replaced. */
export function isCurrent(entry: HistoryEntry): boolean {
  const status = statusOf(entry);
  return status !== "unfiled" && status !== "replaced";
}

/**
 * The files a newly recorded one takes the place of: every OTHER current file
 * of the same lesson, document and language.
 *
 * An unfiled newcomer replaces nothing, and an unfiled older file is never
 * replaced: neither says which document it is, and guessing that from a file
 * name is what this module stopped doing.
 */
export function replacedByRecording(newcomer: HistoryEntry, existing: readonly HistoryEntry[]): HistoryEntry[] {
  if (!isFiled(newcomer)) {
    return [];
  }
  return existing.filter((entry) =>
    entry.relPath !== newcomer.relPath
    && entry.replacedBy === undefined
    && sameSlot(entry, newcomer));
}

/**
 * Why a verdict cannot be given on this file, or null when it can.
 * A verdict is about the file in use, so only a current file takes one.
 */
export function verdictRefusal(entry: HistoryEntry): string | null {
  const status = statusOf(entry);
  if (status === "replaced") {
    return `'${entry.relPath}' was replaced by '${entry.replacedBy}' on ${entry.replacedAt}. Give the verdict on that file instead.`;
  }
  if (status === "unfiled") {
    return (
      `'${entry.relPath}' does not say which document it is or in which language, so it is not the current file of anything. ` +
      "Record it again with `documentId` and `variant` (log_generation or record_document_content), then give the verdict."
    );
  }
  return null;
}

/** How many files stand at each status — every status present, zeros included. */
export function countByStatus(entries: readonly HistoryEntry[]): Record<FileStatus, number> {
  const counts = Object.fromEntries(FILE_STATUSES.map((status) => [status, 0])) as Record<FileStatus, number>;
  for (const entry of entries) {
    counts[statusOf(entry)] += 1;
  }
  return counts;
}
