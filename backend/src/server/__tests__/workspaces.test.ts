/*
 * Admin-tool behaviour: authorization tiers, the last-admin guardrail, and the
 * audit trail. Drives the exported *Op functions directly with an injected
 * actor (currentActor via __setActorForTest) + memory stores — the same style
 * as capabilities.test.ts, since the admin tools read the verified actor and the
 * InMemory transport doesn't carry one.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createWorkspaceOp, addMemberOp, removeMemberOp, listMembersOp, listWorkspacesOp, inviteMemberOp, revokeInviteOp, setDomainRuleOp, removeDomainRuleOp, listUnaffiliatedUsersOp } from "../workspaces.js";
import { __setIdentityDirectoryForTest } from "../../identity/index.js";
import type { DirectoryUser } from "../../identity/index.js";
import { __setActorForTest, type Actor } from "../../actor.js";
import { __setWorkspaceStoreForTest, createMemoryWorkspaceStore } from "../../workspaces/index.js";
import type { WorkspaceStore } from "../../workspaces/index.js";
import { __setKgStoreForTest, createMemoryKgStore } from "../../kg-store/index.js";

const SUPER: Actor = { id: "root", unknown: false, superAdmin: true };
const SEN_ADMIN: Actor = { id: "adm", unknown: false, memberships: { senegal: "admin" } };
const SEN_CURATOR: Actor = { id: "cur", unknown: false, memberships: { senegal: "curator" } };

let workspaceStore: WorkspaceStore;
let kgStore: ReturnType<typeof createMemoryKgStore>;

beforeEach(() => {
  workspaceStore = createMemoryWorkspaceStore({
    workspaces: [{ id: "senegal", displayName: "Senegal", createdBy: "seed", createdAt: "1970-01-01T00:00:00Z" }],
    members: [{ workspace: "senegal", userId: "adm", role: "admin", grantedBy: "seed", grantedAt: "1970-01-01T00:00:00Z" }],
  });
  kgStore = createMemoryKgStore();
  __setWorkspaceStoreForTest(workspaceStore);
  __setKgStoreForTest(kgStore);
});
afterEach(() => {
  __setIdentityDirectoryForTest(undefined);
  __setActorForTest(null);
  __setWorkspaceStoreForTest(null);
  __setKgStoreForTest(null);
});

describe("create_workspace — super admin only", () => {
  it("super admin creates a workspace + writes an audit record", async () => {
    __setActorForTest(SUPER);
    const result = await createWorkspaceOp({ id: "Kenya", displayName: "Kenya" });
    expect(result.ok).toBe(true);
    expect(await workspaceStore.getWorkspace("kenya")).toMatchObject({ id: "kenya", displayName: "Kenya", createdBy: "root" });
    const audit = await kgStore.listAudit({ namespace: "kenya", eventType: "workspace" });
    expect(audit).toHaveLength(1);
    expect(audit[0].reason).toContain("created workspace 'kenya'");
  });

  it("a workspace admin cannot create a workspace", async () => {
    __setActorForTest(SEN_ADMIN);
    const result = await createWorkspaceOp({ id: "kenya", displayName: "Kenya" });
    expect(result.ok).toBe(false); // denied — not a super admin
    expect(String(result.error)).toMatch(/super admin|no role/i);
    expect(await workspaceStore.getWorkspace("kenya")).toBeNull();
  });

  it("rejects a duplicate id", async () => {
    __setActorForTest(SUPER);
    const result = await createWorkspaceOp({ id: "senegal", displayName: "dup" });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/already exists/i);
  });
});

describe("add_member — admin tier", () => {
  it("a workspace admin grants a role in their workspace", async () => {
    __setActorForTest(SEN_ADMIN);
    const result = await addMemberOp({ workspace: "senegal", userId: "u1", role: "curator", email: "u1@x" });
    expect(result.ok).toBe(true);
    expect((await workspaceStore.getMember("senegal", "u1"))?.role).toBe("curator");
    const audit = await kgStore.listAudit({ namespace: "senegal", eventType: "membership" });
    expect(audit[0].reason).toContain("granted 'curator' to u1");
  });

  it("a curator cannot grant roles", async () => {
    __setActorForTest(SEN_CURATOR);
    const result = await addMemberOp({ workspace: "senegal", userId: "u1", role: "curator" });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/manage members/i);
  });

  it("a Senegal admin has no rights in another workspace", async () => {
    __setActorForTest(SUPER);
    await createWorkspaceOp({ id: "kenya", displayName: "Kenya" });
    __setActorForTest(SEN_ADMIN);
    const result = await addMemberOp({ workspace: "kenya", userId: "u1", role: "curator" });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/no role is assigned in workspace 'kenya'/i);
  });
});

describe("remove_member — last-admin guard", () => {
  it("refuses to remove the only admin", async () => {
    __setActorForTest(SUPER);
    const result = await removeMemberOp({ workspace: "senegal", userId: "adm" });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/last admin/i);
  });

  it("allows removing an admin once a second admin exists", async () => {
    __setActorForTest(SUPER);
    await addMemberOp({ workspace: "senegal", userId: "adm2", role: "admin" });
    const result = await removeMemberOp({ workspace: "senegal", userId: "adm" });
    expect(result.ok).toBe(true);
    expect(await workspaceStore.getMember("senegal", "adm")).toBeNull();
  });

  it("removing a non-admin is unguarded", async () => {
    __setActorForTest(SUPER);
    await addMemberOp({ workspace: "senegal", userId: "u1", role: "curator" });
    const result = await removeMemberOp({ workspace: "senegal", userId: "u1" });
    expect(result.ok).toBe(true);
  });
});

describe("list — visibility", () => {
  it("list_members requires admin", async () => {
    __setActorForTest(SEN_CURATOR);
    expect((await listMembersOp({ workspace: "senegal" })).ok).toBe(false);
    __setActorForTest(SEN_ADMIN);
    const result = await listMembersOp({ workspace: "senegal" });
    expect((result.members as unknown[]).length).toBe(1);
  });

  it("list_members shows unclaimed invites beside real members", async () => {
    __setActorForTest(SEN_ADMIN);
    await inviteMemberOp({ workspace: "senegal", email: "awa@idinsight.org", role: "curator" });
    const result = await listMembersOp({ workspace: "senegal" });
    expect(result.pendingInvites).toMatchObject([{ email: "awa@idinsight.org", role: "curator" }]);
  });

  it("list_workspaces shows super admin everything", async () => {
    __setActorForTest(SUPER);
    const result = await listWorkspacesOp();
    expect(result.superAdmin).toBe(true);
    expect((result.workspaces as Array<{ id: string }>).some((w) => w.id === "senegal")).toBe(true);
  });
});

describe("invite_member — access before the account exists", () => {
  it("an admin invites by email + writes an audit record", async () => {
    __setActorForTest(SEN_ADMIN);
    const result = await inviteMemberOp({ workspace: "senegal", email: "awa@idinsight.org", role: "curator" });
    expect(result.ok).toBe(true);
    expect(await workspaceStore.getInvite("senegal", "awa@idinsight.org")).toMatchObject({ role: "curator", invitedBy: "adm" });
    const audit = await kgStore.listAudit({ namespace: "senegal", eventType: "membership" });
    expect(audit[0].reason).toContain("invited awa@idinsight.org as 'curator'");
  });

  it("a curator cannot invite", async () => {
    __setActorForTest(SEN_CURATOR);
    const result = await inviteMemberOp({ workspace: "senegal", email: "awa@idinsight.org", role: "curator" });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/manage members/i);
    expect(await workspaceStore.getInvite("senegal", "awa@idinsight.org")).toBeNull();
  });

  it("the email is the match key, so case and padding don't fork the record", async () => {
    __setActorForTest(SEN_ADMIN);
    await inviteMemberOp({ workspace: "senegal", email: "  Awa@IDinsight.org ", role: "curator" });
    expect(await workspaceStore.getInvite("senegal", "awa@idinsight.org")).not.toBeNull();
    expect((await revokeInviteOp({ workspace: "senegal", email: "AWA@idinsight.org" })).ok).toBe(true);
  });

  it("re-inviting replaces the role rather than duplicating the invite", async () => {
    __setActorForTest(SEN_ADMIN);
    await inviteMemberOp({ workspace: "senegal", email: "awa@idinsight.org", role: "curator" });
    const result = await inviteMemberOp({ workspace: "senegal", email: "awa@idinsight.org", role: "approver" });
    expect(result.replaced).toMatchObject({ role: "curator" });
    expect((await workspaceStore.listInvites("senegal"))).toHaveLength(1);
    expect((await workspaceStore.getInvite("senegal", "awa@idinsight.org"))?.role).toBe("approver");
  });

  it("refuses an invite for someone who is already a member, naming their userId", async () => {
    __setActorForTest(SEN_ADMIN);
    await addMemberOp({ workspace: "senegal", userId: "u1", role: "curator", email: "awa@idinsight.org" });
    const result = await inviteMemberOp({ workspace: "senegal", email: "awa@idinsight.org", role: "approver" });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain("u1");
    expect(await workspaceStore.getInvite("senegal", "awa@idinsight.org")).toBeNull();
  });

  it("rejects a value that isn't an email", async () => {
    __setActorForTest(SEN_ADMIN);
    const result = await inviteMemberOp({ workspace: "senegal", email: "awa", role: "curator" });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/email address/i);
  });
});

describe("revoke_invite", () => {
  it("withdraws an unclaimed invite + audits it", async () => {
    __setActorForTest(SEN_ADMIN);
    await inviteMemberOp({ workspace: "senegal", email: "awa@idinsight.org", role: "curator" });
    const result = await revokeInviteOp({ workspace: "senegal", email: "awa@idinsight.org" });
    expect(result.ok).toBe(true);
    expect(await workspaceStore.getInvite("senegal", "awa@idinsight.org")).toBeNull();
    const audit = await kgStore.listAudit({ namespace: "senegal", eventType: "membership" });
    expect(audit.some((record) => record.reason?.includes("revoked the 'curator' invite"))).toBe(true);
  });

  it("says so when there is nothing to revoke", async () => {
    __setActorForTest(SEN_ADMIN);
    const result = await revokeInviteOp({ workspace: "senegal", email: "nobody@idinsight.org" });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/no pending invite/i);
  });
});

describe("add_member — identified by email or userId", () => {
  it("an email nobody holds yet becomes an invite", async () => {
    __setActorForTest(SEN_ADMIN);
    const result = await addMemberOp({ workspace: "senegal", email: "awa@idinsight.org", role: "curator" });
    expect(result.ok).toBe(true);
    expect(result.invite).toMatchObject({ email: "awa@idinsight.org", role: "curator" });
    expect(await workspaceStore.membersOf("senegal")).toHaveLength(1); // still just the seeded admin
  });

  it("an email an existing member carries updates that membership directly", async () => {
    __setActorForTest(SEN_ADMIN);
    await addMemberOp({ workspace: "senegal", userId: "u1", role: "curator", email: "awa@idinsight.org" });
    const result = await addMemberOp({ workspace: "senegal", email: "awa@idinsight.org", role: "approver" });
    expect(result.ok).toBe(true);
    expect((await workspaceStore.getMember("senegal", "u1"))?.role).toBe("approver");
    expect(await workspaceStore.listInvites("senegal")).toHaveLength(0);
  });

  it("needs one identifier or the other", async () => {
    __setActorForTest(SEN_ADMIN);
    const result = await addMemberOp({ workspace: "senegal", role: "curator" });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/userId|email/);
  });

  it("omits the email field entirely when none is given (Firestore rejects undefined)", async () => {
    __setActorForTest(SEN_ADMIN);
    await addMemberOp({ workspace: "senegal", userId: "u1", role: "curator" });
    const stored = await workspaceStore.getMember("senegal", "u1");
    expect(Object.keys(stored!)).not.toContain("email");
  });
});

describe("domain rules — super admin only", () => {
  it("a super admin opens a workspace to a domain + audits it", async () => {
    __setActorForTest(SUPER);
    const result = await setDomainRuleOp({ workspace: "senegal", domain: "idinsight.org", role: "curator" });
    expect(result.ok).toBe(true);
    expect((await workspaceStore.getWorkspace("senegal"))?.domainRules).toMatchObject([{ domain: "idinsight.org", role: "curator" }]);
    const audit = await kgStore.listAudit({ namespace: "senegal", eventType: "workspace" });
    expect(audit[0].reason).toContain("anyone at idinsight.org");
  });

  it("a workspace ADMIN cannot set one — this grant gets no per-person review", async () => {
    __setActorForTest(SEN_ADMIN);
    const result = await setDomainRuleOp({ workspace: "senegal", domain: "idinsight.org", role: "curator" });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/super admin/i);
    expect((await workspaceStore.getWorkspace("senegal"))?.domainRules).toBeUndefined();
  });

  it("stores the domain the way an email address will arrive", async () => {
    __setActorForTest(SUPER);
    await setDomainRuleOp({ workspace: "senegal", domain: " @IDinsight.org ", role: "curator" });
    expect((await workspaceStore.getWorkspace("senegal"))?.domainRules).toMatchObject([{ domain: "idinsight.org" }]);
  });

  it("re-setting a domain replaces its role instead of stacking rules", async () => {
    __setActorForTest(SUPER);
    await setDomainRuleOp({ workspace: "senegal", domain: "idinsight.org", role: "curator" });
    await setDomainRuleOp({ workspace: "senegal", domain: "idinsight.org", role: "approver" });
    expect((await workspaceStore.getWorkspace("senegal"))?.domainRules).toMatchObject([{ domain: "idinsight.org", role: "approver" }]);
  });

  it("warns when the rule hands out more than curator", async () => {
    __setActorForTest(SUPER);
    const result = await setDomainRuleOp({ workspace: "senegal", domain: "idinsight.org", role: "approver" });
    expect(String(result.note)).toMatch(/no per-person review/i);
  });

  it("rejects something that is not a domain", async () => {
    __setActorForTest(SUPER);
    const result = await setDomainRuleOp({ workspace: "senegal", domain: "awa@idinsight.org", role: "curator" });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/not a domain/i);
  });

  it("removing a rule leaves existing members alone", async () => {
    __setActorForTest(SUPER);
    await setDomainRuleOp({ workspace: "senegal", domain: "idinsight.org", role: "curator" });
    const result = await removeDomainRuleOp({ workspace: "senegal", domain: "idinsight.org" });
    expect(result.ok).toBe(true);
    expect((await workspaceStore.getWorkspace("senegal"))?.domainRules).toEqual([]);
    expect(await workspaceStore.getMember("senegal", "adm")).not.toBeNull();
  });

  it("says so when there is no such rule", async () => {
    __setActorForTest(SUPER);
    const result = await removeDomainRuleOp({ workspace: "senegal", domain: "nowhere.org" });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/no rule/i);
  });

  it("list_members surfaces the rule beside members and invites", async () => {
    __setActorForTest(SUPER);
    await setDomainRuleOp({ workspace: "senegal", domain: "idinsight.org", role: "curator" });
    __setActorForTest(SEN_ADMIN);
    const result = await listMembersOp({ workspace: "senegal" });
    expect(result.domainRules).toMatchObject([{ domain: "idinsight.org", role: "curator" }]);
  });
});


describe("list_unaffiliated_users — accounts with no role anywhere", () => {
  const directoryOf = (users: DirectoryUser[]) => ({ listUsers: async () => users });

  const ROOT: DirectoryUser = { id: "root", email: "root@x", provider: "google" };
  const MEMBER: DirectoryUser = { id: "adm", email: "adm@x", provider: "google", lastSignInAt: "2026-08-20T00:00:00Z" };
  const STRANDED: DirectoryUser = { id: "u-new", email: "new@x", provider: "google", lastSignInAt: "2026-08-24T00:00:00Z" };
  const INVITED: DirectoryUser = { id: "u-inv", email: "awa@idinsight.org", provider: "google", lastSignInAt: "2026-08-22T00:00:00Z" };
  const UNCONFIRMED: DirectoryUser = { id: "u-unc", email: "pending@x", provider: "email", lastSignInAt: "2026-08-21T00:00:00Z" };

  it("lists only the accounts holding no membership, newest sign-in first", async () => {
    __setIdentityDirectoryForTest(directoryOf([MEMBER, STRANDED, INVITED, UNCONFIRMED]));
    __setActorForTest(SUPER);
    await inviteMemberOp({ workspace: "senegal", email: "awa@idinsight.org", role: "curator" });

    const result = await listUnaffiliatedUsersOp();
    expect(result.ok).toBe(true);
    expect(result.totalAccounts).toBe(4);
    const rows = result.unaffiliated as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.userId)).toEqual(["u-new", "u-inv", "u-unc"]); // 'adm' is a member
  });

  it("says WHY each one has no role", async () => {
    __setIdentityDirectoryForTest(directoryOf([STRANDED, INVITED, UNCONFIRMED]));
    __setActorForTest(SUPER);
    await inviteMemberOp({ workspace: "senegal", email: "awa@idinsight.org", role: "curator" });

    const rows = (await listUnaffiliatedUsersOp()).unaffiliated as Array<Record<string, unknown>>;
    const byId = new Map(rows.map((r) => [r.userId, r]));
    expect(byId.get("u-new")?.status).toBe("stranded");
    expect(byId.get("u-inv")?.status).toBe("invited");
    expect(byId.get("u-inv")?.pendingInvites).toMatchObject([{ workspace: "senegal", role: "curator" }]);
    expect(byId.get("u-unc")?.status).toBe("unconfirmed");
  });

  it("does not report a super admin as stranded — they hold no membership by design", async () => {
    // Super admins come from env, not the registry, so the env is the thing
    // under test here.
    const saved = process.env.TLM_SUPER_ADMINS;
    process.env.TLM_SUPER_ADMINS = "root@x";
    try {
      __setIdentityDirectoryForTest(directoryOf([ROOT, STRANDED]));
      __setActorForTest(SUPER);
      const rows = (await listUnaffiliatedUsersOp()).unaffiliated as Array<Record<string, unknown>>;
      expect(rows.map((r) => r.userId)).toEqual(["u-new"]);
    } finally {
      if (saved === undefined) delete process.env.TLM_SUPER_ADMINS;
      else process.env.TLM_SUPER_ADMINS = saved;
    }
  });

  it("a workspace admin cannot enumerate accounts", async () => {
    __setIdentityDirectoryForTest(directoryOf([STRANDED]));
    __setActorForTest(SEN_ADMIN);
    const result = await listUnaffiliatedUsersOp();
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/super admin/i);
  });

  it("says so when no directory is configured, rather than failing obscurely", async () => {
    __setIdentityDirectoryForTest(null);
    __setActorForTest(SUPER);
    const result = await listUnaffiliatedUsersOp();
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});
