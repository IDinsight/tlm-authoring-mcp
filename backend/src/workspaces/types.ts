/*
 * Module: workspaces · types (service surface)
 *
 * The tenant registry: which workspaces exist and who holds what role in each.
 * This is authorization DATA (distinct from Supabase identity) — see
 * docs/design-notes/workspaces.md. Subject-agnostic: it knows workspaces and
 * memberships, never grade/subject/chapter.
 */
import type { MembershipRole } from "../actor.js";

/**
 * "Anyone signing in with an @idinsight.org Google account is a curator here."
 * A standing rule on the workspace, so a colleague needs no invite at all.
 *
 * `role` should stay `curator`: this is the one grant nobody reviews, so it
 * must not carry the right to publish. Only a super admin can set one.
 */
export type DomainRule = {
  domain: string;             // normalized, no "@" — e.g. "idinsight.org"
  role: MembershipRole;
};

/** A tenant. Its id is the top segment of every namespace it owns. */
export type WorkspaceRecord = {
  id: string;                 // slug, e.g. "senegal" — matches the namespace segment
  displayName: string;
  createdBy: string;          // actor id of the super admin who created it
  createdAt: string;          // ISO-8601 UTC
  archived?: boolean;
  domainRules?: DomainRule[];
};

/** One user's role in one workspace. Doc id = `${workspace}::${userId}`. */
export type MembershipRecord = {
  workspace: string;
  userId: string;             // JWT sub
  email?: string;             // convenience label; never used for auth
  role: MembershipRole;
  grantedBy: string;          // actor id who granted it
  grantedAt: string;          // ISO-8601 UTC
};

/**
 * A standing permission for someone who has no account yet — "whoever proves
 * they own awa@idinsight.org may be a curator of senegal". Doc id =
 * `${workspace}::${email}`.
 *
 * It is NOT an emailed invitation link: there is no token to leak and nothing
 * to expire out from under the person. They sign in however they like, and the
 * first-login provision step (step 2) matches this row against their VERIFIED
 * address, writes the membership, and deletes the invite — so an invite is
 * always pending by construction.
 */
export type InviteRecord = {
  workspace: string;
  email: string;              // normalized (trimmed + lowercased) — the match key
  role: MembershipRole;
  invitedBy: string;          // actor id who issued it
  invitedAt: string;          // ISO-8601 UTC
};

export interface WorkspaceStore {
  listWorkspaces(): Promise<WorkspaceRecord[]>;
  getWorkspace(id: string): Promise<WorkspaceRecord | null>;
  putWorkspace(rec: WorkspaceRecord): Promise<void>;

  /** All memberships for one user, across every workspace (the per-request read). */
  membershipsForUser(userId: string): Promise<MembershipRecord[]>;
  /** All members of one workspace (for list_members / last-admin checks). */
  membersOf(workspace: string): Promise<MembershipRecord[]>;
  getMember(workspace: string, userId: string): Promise<MembershipRecord | null>;
  putMember(rec: MembershipRecord): Promise<void>;
  removeMember(workspace: string, userId: string): Promise<void>;

  /** Pending invites for one workspace (list_members shows these beside members). */
  listInvites(workspace: string): Promise<InviteRecord[]>;
  /** Every workspace's pending invites for one address — the first-login claim read. */
  invitesForEmail(email: string): Promise<InviteRecord[]>;
  getInvite(workspace: string, email: string): Promise<InviteRecord | null>;
  putInvite(rec: InviteRecord): Promise<void>;
  removeInvite(workspace: string, email: string): Promise<void>;
}
