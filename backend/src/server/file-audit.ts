/*
 * Module: server · the audit record of a file event
 *
 * A produced file being recorded, approved or sent back is written to the same
 * append-only trail as every graph change, under the namespace the file lives
 * in — so read_audit answers "who approved the Wolof guide of lesson 23, and
 * when" beside "who changed its wording".
 *
 * Its own small module because both document tool groups write these events
 * (documents.ts records a delivery, file-status.ts a verdict) and neither
 * should import the other.
 */
import { randomUUID } from "node:crypto";
import { currentActor } from "../actor.js";
import { getKgStore, nextAuditSeq, toAuditActor } from "../kg-store/index.js";
import type { FilePerson } from "../types.js";

/** The signed-in caller, as a file record names a person. */
export function currentFilePerson(): FilePerson {
  const actor = currentActor();
  return { id: actor.id, email: actor.email ?? null };
}

export type FileAuditEvent = {
  fileEvent: "recorded" | "approved" | "changes_requested";
  filePath: string;
  fileMd5: string;
  replacedFiles?: string[];
  note?: string;
};

/**
 * Append one file event to the audit trail.
 *
 * The file record is already written when this runs, and a failed trail write
 * does not undo it: the caller is told the truth about the file either way.
 * The failure is logged so a gap in the trail can be traced to its cause.
 */
export async function auditFileEvent(namespace: string, event: FileAuditEvent): Promise<void> {
  const record = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    seq: nextAuditSeq(),
    actor: toAuditActor(currentActor()),
    namespace,
    eventType: "file" as const,
    fileEvent: event.fileEvent,
    filePath: event.filePath,
    fileMd5: event.fileMd5,
    // Optional fields are left OUT rather than set to undefined: Firestore
    // refuses a document that carries `undefined` anywhere.
    ...(event.replacedFiles?.length ? { replacedFiles: event.replacedFiles } : {}),
    ...(event.note ? { reason: event.note } : {}),
  };

  try {
    await getKgStore().appendAudit(record);
  } catch (cause) {
    console.error(`[audit] file event '${event.fileEvent}' on '${event.filePath}' was NOT recorded in the trail: ${(cause as Error).message}`);
  }
}
