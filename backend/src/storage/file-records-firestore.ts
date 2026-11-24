/*
 * Module: storage · the per-file record store, on Firestore
 *
 * Two flat collections, like kg-store's and workspaces':
 *
 *   file_records            one document per produced file
 *                           id = `<namespace slug>::<sha256 of relPath>`
 *   file_record_namespaces  one small document per namespace: its `revision`
 *                           (moved by every write) and whether its legacy
 *                           history.json has been imported — id = the slug
 *
 * EVERY QUERY HERE IS ONE EQUALITY ON ONE FIELD (`namespace`). That is on
 * purpose: Firestore serves it from the index it builds by itself. A second
 * condition or an order-by would need a composite index created by hand, and
 * the in-memory store the tests run on needs none — so such a query passes every
 * test and fails on the first live call. Filter and sort in code instead.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { CONFIG } from "../config.js";
import { fromFirestoreShape, stripUndefined, toFirestoreShape } from "../kg-store/index.js";
import type { HistoryEntry } from "../types.js";
import { newRevision, type FileRecordStore, type LegacyImport, type NamespaceState } from "./file-record-types.js";

const require = createRequire(import.meta.url);

// Minimal structural Firestore surface (the same pattern as kg-store/firestore.ts),
// so this file does not depend on firebase-admin's compile-time types.
type FsSetOptions = { merge?: boolean };
interface FsDoc { exists: boolean; data(): Record<string, unknown> | undefined }
interface FsDocRef {
  get(): Promise<FsDoc>;
  set(data: Record<string, unknown>, options?: FsSetOptions): Promise<unknown>;
}
interface FsQuery { get(): Promise<{ docs: FsDoc[] }> }
interface FsCollection {
  doc(id: string): FsDocRef;
  where(field: string, op: string, value: unknown): FsQuery;
}
interface FsBatch {
  set(ref: FsDocRef, data: Record<string, unknown>, options?: FsSetOptions): FsBatch;
  delete(ref: FsDocRef): FsBatch;
  commit(): Promise<unknown>;
}
interface Firestore {
  collection(name: string): FsCollection;
  batch(): FsBatch;
}

const fbApp = require("firebase-admin/app") as {
  initializeApp: (opts: { credential: unknown; storageBucket?: string }) => unknown;
  cert: (serviceAccountPathOrObject: string | object) => unknown;
  applicationDefault: () => unknown;
  getApps: () => unknown[];
};
const fbFirestore = require("firebase-admin/firestore") as { getFirestore: () => Firestore };

// The same idempotent bootstrap the other stores use: whichever runs first
// creates the app, and the rest find it already there.
function initFirebase(): void {
  if (fbApp.getApps().length > 0) {
    return;
  }
  const credential = CONFIG.serviceAccountKeyPath
    ? fbApp.cert(CONFIG.serviceAccountKeyPath)
    : CONFIG.serviceAccountKeyJson
      ? fbApp.cert(JSON.parse(CONFIG.serviceAccountKeyJson))
      : fbApp.applicationDefault();
  fbApp.initializeApp({ credential, storageBucket: CONFIG.firebaseBucket || undefined });
}

const RECORDS = "file_records";
const NAMESPACES = "file_record_namespaces";

// Firestore caps a batch at 500 writes. Each batch here also carries one write
// to the namespace document, so stay well under it, like kg-store does.
const BATCH_MAX = 450;

// A document id cannot contain "/", and a namespace ("senegal/ci/maths") does.
const namespaceSlug = (namespace: string): string => namespace.replace(/\//g, "__");

// A relPath holds slashes, spaces and accents ("lecon_23/Guide — Leçon 23.docx"),
// none of which is safe in a document id. Its hash is, and is the same every time.
function recordDocId(namespace: string, relPath: string): string {
  const pathHash = createHash("sha256").update(relPath).digest("hex");
  return `${namespaceSlug(namespace)}::${pathHash}`;
}

// `namespace` is stored beside the entry's own fields because it is what `list`
// filters on. An entry has no field of that name, so nothing is shadowed.
function toDocument(namespace: string, entry: HistoryEntry): Record<string, unknown> {
  const withoutUndefined = stripUndefined({ namespace, ...entry });
  return toFirestoreShape(withoutUndefined) as Record<string, unknown>;
}

function toEntry(doc: FsDoc): HistoryEntry {
  const stored = fromFirestoreShape(doc.data() ?? {}) as Record<string, unknown>;
  const { namespace: _namespace, ...entry } = stored;
  return entry as unknown as HistoryEntry;
}

function chunksOf<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

export function createFirestoreFileRecordStore(): FileRecordStore {
  initFirebase();
  const db = fbFirestore.getFirestore();
  const records = () => db.collection(RECORDS);
  const namespaceDoc = (namespace: string) => db.collection(NAMESPACES).doc(namespaceSlug(namespace));

  // Rides in the SAME batch as the records it announces, so a reader never
  // sees a new revision before the records are there, nor records without one.
  // `merge` keeps the import marker that lives in the same document.
  const moveRevision = (batch: FsBatch, namespace: string): void => {
    batch.set(namespaceDoc(namespace), { namespace, revision: newRevision() }, { merge: true });
  };

  return {
    async state(namespace): Promise<NamespaceState> {
      const doc = await namespaceDoc(namespace).get();
      const data = (doc.exists ? doc.data() : undefined) ?? {};
      return {
        revision: (data.revision as string | undefined) ?? null,
        legacyImport: (data.legacyImport as LegacyImport | undefined) ?? null,
      };
    },

    async list(namespace) {
      const snapshot = await records().where("namespace", "==", namespace).get();
      return snapshot.docs.map(toEntry);
    },

    // One batch is all-or-nothing, and a recorded file plus the handful it
    // replaces always fits in one. Only the legacy import is large enough to
    // span several; it is safe to re-run, and its marker is written last.
    async putAll(namespace, entries) {
      for (const chunk of chunksOf(entries, BATCH_MAX)) {
        const batch = db.batch();
        for (const entry of chunk) {
          const ref = records().doc(recordDocId(namespace, entry.relPath));
          batch.set(ref, toDocument(namespace, entry));
        }
        moveRevision(batch, namespace);
        await batch.commit();
      }
    },

    async removeAll(namespace, relPaths) {
      for (const chunk of chunksOf(relPaths, BATCH_MAX)) {
        const batch = db.batch();
        for (const relPath of chunk) {
          batch.delete(records().doc(recordDocId(namespace, relPath)));
        }
        moveRevision(batch, namespace);
        await batch.commit();
      }
    },

    async markLegacyImported(namespace, done) {
      await namespaceDoc(namespace).set({ namespace, legacyImport: done }, { merge: true });
    },
  };
}
