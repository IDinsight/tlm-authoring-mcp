/*
 * Module: workspaces · firestore (service surface)
 *
 * Firestore-backed WorkspaceStore. Three flat collections — `workspaces` (doc id
 * = workspace id), `workspace_members` (doc id = `${workspace}::${userId}`) and
 * `workspace_invites` (doc id = `${workspace}::${email}`) — mirroring kg-store's
 * flat layout. The firebase-admin bootstrap here is the same idempotent init
 * kg-store uses (guarded by getApps()); a second initializeApp is a no-op, so
 * the two stores share one app.
 */
import { createRequire } from "node:module";
import { CONFIG } from "../config.js";
import type { InviteRecord, MembershipRecord, WorkspaceRecord, WorkspaceStore } from "./types.js";

const require = createRequire(import.meta.url);

// Minimal structural Firestore surface (see kg-store/firestore.ts for the same
// pattern — kept local so we don't depend on firebase-admin's compile types).
interface FsDoc { id: string; exists: boolean; data(): Record<string, unknown> | undefined; ref: FsDocRef }
interface FsDocRef { set(data: Record<string, unknown>): Promise<unknown>; delete(): Promise<unknown> }
interface FsQuerySnap { docs: FsDoc[] }
interface FsQuery { get(): Promise<FsQuerySnap> }
interface FsCollection extends FsQuery {
  doc(id: string): FsDocRef & { get(): Promise<FsDoc> };
  where(field: string, op: string, value: unknown): FsQuery;
}
interface Firestore { collection(name: string): FsCollection }

const fbApp = require("firebase-admin/app") as {
  initializeApp: (opts: { credential: unknown; storageBucket?: string }) => unknown;
  cert: (serviceAccountPathOrObject: string | object) => unknown;
  applicationDefault: () => unknown;
  getApps: () => unknown[];
};
const fbFirestore = require("firebase-admin/firestore") as { getFirestore: () => Firestore };

function initFirebase(): void {
  if (fbApp.getApps().length > 0) return;
  const credential = CONFIG.serviceAccountKeyPath
    ? fbApp.cert(CONFIG.serviceAccountKeyPath)
    : CONFIG.serviceAccountKeyJson
      ? fbApp.cert(JSON.parse(CONFIG.serviceAccountKeyJson))
      : fbApp.applicationDefault();
  fbApp.initializeApp({ credential, storageBucket: CONFIG.firebaseBucket || undefined });
}

const WORKSPACES = "workspaces";
const MEMBERS = "workspace_members";
const INVITES = "workspace_invites";
const memberDocId = (workspace: string, userId: string) => `${workspace}::${userId}`;
const inviteDocId = (workspace: string, email: string) => `${workspace}::${email}`;

const asWorkspace = (d: FsDoc): WorkspaceRecord => d.data() as unknown as WorkspaceRecord;
const asMember = (d: FsDoc): MembershipRecord => d.data() as unknown as MembershipRecord;
const asInvite = (d: FsDoc): InviteRecord => d.data() as unknown as InviteRecord;

export function createFirestoreWorkspaceStore(): WorkspaceStore {
  initFirebase();
  const db = fbFirestore.getFirestore();

  return {
    async listWorkspaces() {
      const snap = await db.collection(WORKSPACES).get();
      return snap.docs.map(asWorkspace).sort((a, b) => a.id.localeCompare(b.id));
    },
    async getWorkspace(id) {
      const d = await db.collection(WORKSPACES).doc(id).get();
      return d.exists ? asWorkspace(d) : null;
    },
    async putWorkspace(rec) {
      await db.collection(WORKSPACES).doc(rec.id).set(rec as unknown as Record<string, unknown>);
    },
    async membershipsForUser(userId) {
      const snap = await db.collection(MEMBERS).where("userId", "==", userId).get();
      return snap.docs.map(asMember);
    },
    async membersOf(workspace) {
      const snap = await db.collection(MEMBERS).where("workspace", "==", workspace).get();
      return snap.docs.map(asMember).sort((a, b) => a.userId.localeCompare(b.userId));
    },
    async getMember(workspace, userId) {
      const d = await db.collection(MEMBERS).doc(memberDocId(workspace, userId)).get();
      return d.exists ? asMember(d) : null;
    },
    async putMember(rec) {
      await db.collection(MEMBERS).doc(memberDocId(rec.workspace, rec.userId)).set(rec as unknown as Record<string, unknown>);
    },
    async removeMember(workspace, userId) {
      await db.collection(MEMBERS).doc(memberDocId(workspace, userId)).delete();
    },
    async listInvites(workspace) {
      const snap = await db.collection(INVITES).where("workspace", "==", workspace).get();
      return snap.docs.map(asInvite).sort((a, b) => a.email.localeCompare(b.email));
    },
    async invitesForEmail(email) {
      const snap = await db.collection(INVITES).where("email", "==", email).get();
      return snap.docs.map(asInvite);
    },
    async getInvite(workspace, email) {
      const doc = await db.collection(INVITES).doc(inviteDocId(workspace, email)).get();
      return doc.exists ? asInvite(doc) : null;
    },
    async putInvite(rec) {
      await db.collection(INVITES).doc(inviteDocId(rec.workspace, rec.email)).set(rec as unknown as Record<string, unknown>);
    },
    async removeInvite(workspace, email) {
      await db.collection(INVITES).doc(inviteDocId(workspace, email)).delete();
    },
  };
}
