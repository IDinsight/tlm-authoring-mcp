/*
 * Module: server · tool group: workspaces & membership (admin)
 *
 * The tenant-administration surface (see docs/design-notes/workspaces.md):
 *   list_workspaces   — the workspaces the caller can enter (all, if super admin).
 *   create_workspace  — super admin only.
 *   add_member        — workspace admin (their ws) or super admin (any).
 *   remove_member     — same gate; refuses removing the last admin.
 *   list_members      — same gate; shows pending invites beside real members.
 *   invite_member     — same gate; access for someone with no account yet.
 *   revoke_invite     — same gate.
 *   set_domain_rule / remove_domain_rule — super admin only; who may join by
 *                       email domain, with no invite at all.
 *
 * Authorization goes through the SAME authorize() every graph tool uses (via
 * authorizeWorkspace, which has no grade/subject). Every mutation writes an
 * append-only audit record, keyed under the workspace namespace, exactly like a
 * graph mutation. Membership changes are LIVE (not drafted) — a membership is
 * not a graph node — so there is no publish step.
 *
 * Invites exist because a membership is keyed by the identity `sub`, which
 * nobody knows until that person has logged in at least once. An invite is the
 * same grant keyed by EMAIL instead, so access can be arranged before the
 * account exists. See docs/design-notes/member-onboarding.md.
 */
import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { asJson } from "./shared.js";
import { currentActor } from "../actor.js";
import type { MembershipRole } from "../actor.js";
import type { DomainRule, InviteRecord, MembershipRecord } from "../workspaces/index.js";
import { authorizeWorkspace, effectiveRole } from "../authz.js";
import { basePrefix } from "../config.js";
import { slug, normalizeEmail, looksLikeEmail } from "../utils/index.js";
import { listAvailableContexts } from "../context/index.js";
import { getKgStore, toAuditActor, nextAuditSeq } from "../kg-store/index.js";
import { getWorkspaceStore } from "../workspaces/index.js";
import { accessibleContexts } from "./context.js";

const ROLE = z.enum(["curator", "approver", "admin"]);

// Audit a membership/workspace admin action under the workspace's namespace, so
// read_audit for that workspace surfaces it alongside graph events.
async function auditAdmin(workspace: string, eventType: "membership" | "workspace", reason: string): Promise<void> {
  await getKgStore().appendAudit({
    id: randomUUID(),
    ts: new Date().toISOString(), seq: nextAuditSeq(),
    actor: toAuditActor(currentActor()),
    namespace: basePrefix() + workspace,
    eventType,
    reason,
  });
}


// The preamble every membership tool shares: canonicalize the workspace id and
// check the caller may manage members there. `error` is the refusal to hand
// straight back to the caller.
function adminGate(rawWorkspace: string): { workspace: string; error?: string } {
  const workspace = slug(rawWorkspace);
  const authz = authorizeWorkspace(currentActor(), "manageMembers", workspace);
  return authz.ok ? { workspace } : { workspace, error: authz.reason };
}

// A workspace you can grant roles in must exist — either in the registry or as
// an installed context (a workspace whose graphs were seeded before anyone
// registered it).
async function workspaceExists(workspace: string): Promise<boolean> {
  const registered = await getWorkspaceStore().getWorkspace(workspace);
  if (registered) return true;
  return listAvailableContexts().some((c) => c.workspace === workspace);
}

// Match an email against the `email` LABELS on existing memberships. Those
// labels are typed by an admin, not verified, so this is only ever used to be
// helpful ("you already know this person, here is their userId") — never to
// decide authorization.
async function findMemberByEmail(workspace: string, email: string): Promise<MembershipRecord | null> {
  const members = await getWorkspaceStore().membersOf(workspace);
  const match = members.find((m) => m.email && normalizeEmail(m.email) === email);
  return match ?? null;
}

// Write (or update) one membership + its audit line. Shared by add_member's
// userId form and by its email form once the person is recognised.
async function grantMembership(
  workspace: string,
  userId: string,
  role: MembershipRole,
  email?: string,
): Promise<Record<string, unknown>> {
  // `email` is spread in only when set: Firestore rejects an explicit
  // `undefined` field value, so `{ email: undefined }` would throw on write.
  const rec: MembershipRecord = {
    workspace,
    userId,
    role,
    grantedBy: currentActor().id,
    grantedAt: new Date().toISOString(),
    ...(email ? { email } : {}),
  };
  await getWorkspaceStore().putMember(rec);
  await auditAdmin(workspace, "membership", `granted '${role}' to ${userId}${email ? ` (${email})` : ""} in '${workspace}'`);
  return { ok: true, member: rec };
}

// ── Operations (exported so tests can drive them with an injected actor +
// stores; the tool handlers below are thin asJson wrappers). Each reads the
// verified currentActor() and enforces authz — never trusting any arg for it.

// A domain as a match key: no leading "@", no case, no padding. "@IDinsight.org"
// and "idinsight.org" must land on the same rule or the auto-join silently
// never fires. Lowercase ONLY — normalizeEmail does the same to the address
// side, and folding accents here (café.fr → cafe.fr) would stop the two matching.
const normalizeDomain = (raw: string): string => raw.trim().toLowerCase().replace(/^@/, "");

/**
 * Let anyone signing in with an address at `domain` into this workspace, at
 * `role`. Super admin only, and deliberately so: this is the one grant no human
 * reviews per person, so the power to create it sits above workspace admin.
 *
 * Only a provider that VOUCHES for the address satisfies the rule at login
 * (Google, today) — see workspaces/provision.ts.
 */
export async function setDomainRuleOp(a: { workspace: string; domain: string; role: MembershipRole }): Promise<Record<string, unknown>> {
  const actor = currentActor();
  const workspace = slug(a.workspace);
  const authz = authorizeWorkspace(actor, "manageWorkspace", workspace);
  if (!authz.ok) return { ok: false, error: authz.reason };

  const domain = normalizeDomain(a.domain);
  if (!domain.includes(".") || domain.includes("@")) {
    return { ok: false, error: `'${a.domain}' is not a domain — give the part after the @, e.g. 'idinsight.org'` };
  }

  const store = getWorkspaceStore();
  const record = await store.getWorkspace(workspace);
  if (!record) return { ok: false, error: `unknown workspace '${workspace}' — create it first` };

  const others = (record.domainRules ?? []).filter((rule) => rule.domain !== domain);
  const rule: DomainRule = { domain, role: a.role };
  await store.putWorkspace({ ...record, domainRules: [...others, rule] });
  await auditAdmin(workspace, "workspace", `set domain rule: anyone at ${domain} joins '${workspace}' as '${a.role}'`);

  return {
    ok: true,
    rule,
    workspace,
    note: a.role === "curator"
      ? undefined
      : `'${a.role}' is granted with no per-person review. 'curator' is the intended role for a domain rule.`,
  };
}

export async function removeDomainRuleOp(a: { workspace: string; domain: string }): Promise<Record<string, unknown>> {
  const actor = currentActor();
  const workspace = slug(a.workspace);
  const authz = authorizeWorkspace(actor, "manageWorkspace", workspace);
  if (!authz.ok) return { ok: false, error: authz.reason };

  const domain = normalizeDomain(a.domain);
  const store = getWorkspaceStore();
  const record = await store.getWorkspace(workspace);
  if (!record) return { ok: false, error: `unknown workspace '${workspace}' — create it first` };

  const remaining = (record.domainRules ?? []).filter((rule) => rule.domain !== domain);
  if (remaining.length === (record.domainRules ?? []).length) {
    return { ok: false, error: `'${workspace}' has no rule for ${domain}` };
  }
  await store.putWorkspace({ ...record, domainRules: remaining });
  await auditAdmin(workspace, "workspace", `removed the ${domain} domain rule from '${workspace}'`);

  // People who already joined under the rule keep their membership — remove_member
  // is the tool for taking access away.
  return { ok: true, workspace, removed: domain, remaining, note: "Existing members who joined under this rule keep their role." };
}

export async function listWorkspacesOp(): Promise<Record<string, unknown>> {
  const actor = currentActor();
  const registry = await getWorkspaceStore().listWorkspaces().catch(() => []);
  // Ids from the registry AND installed sources (a seeded-but-unregistered
  // workspace still appears).
  const ids = new Set<string>([...registry.map((w) => w.id), ...listAvailableContexts().map((c) => c.workspace)]);
  const displayName = new Map(registry.map((w) => [w.id, w.displayName]));
  const ctxByWs = new Map<string, Array<{ grade: string; subject: string }>>();
  for (const c of accessibleContexts()) {
    (ctxByWs.get(c.workspace) ?? ctxByWs.set(c.workspace, []).get(c.workspace)!).push({ grade: c.grade, subject: c.subject });
  }
  const out = [...ids]
    .map((id) => ({ id, displayName: displayName.get(id) ?? id, role: actor.superAdmin ? "super_admin" : effectiveRole(actor, id) ?? null, contexts: ctxByWs.get(id) ?? [] }))
    .filter((w) => actor.unknown || actor.superAdmin || w.role !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
  return { workspaces: out, superAdmin: !!actor.superAdmin };
}

export async function createWorkspaceOp(a: { id: string; displayName: string }): Promise<Record<string, unknown>> {
  const actor = currentActor();
  const id = slug(a.id);
  const authz = authorizeWorkspace(actor, "manageWorkspace", id);
  if (!authz.ok) return { ok: false, error: authz.reason };
  if (!id) return { ok: false, error: "workspace id is empty after slugifying" };
  const store = getWorkspaceStore();
  if (await store.getWorkspace(id)) return { ok: false, error: `workspace '${id}' already exists` };
  const rec = { id, displayName: a.displayName, createdBy: actor.id, createdAt: new Date().toISOString() };
  await store.putWorkspace(rec);
  await auditAdmin(id, "workspace", `created workspace '${id}' (${a.displayName})`);
  return { ok: true, workspace: rec };
}

/**
 * Grant a role, by `userId` (an identity subject) or by `email`. Given only an
 * email, it grants directly if an existing member carries that address as a
 * label, and otherwise leaves an invite for that person's first login — so an
 * admin never has to know whether the account exists yet.
 */
export async function addMemberOp(a: { workspace: string; userId?: string; email?: string; role: MembershipRole }): Promise<Record<string, unknown>> {
  const gate = adminGate(a.workspace);
  if (gate.error) return { ok: false, error: gate.error };
  const { workspace } = gate;

  if (!(await workspaceExists(workspace))) {
    return { ok: false, error: `unknown workspace '${workspace}' — create it first` };
  }
  const email = a.email ? normalizeEmail(a.email) : undefined;
  if (a.userId) {
    return await grantMembership(workspace, a.userId, a.role, email);
  }
  if (!email) {
    return { ok: false, error: "give a userId (the person's identity subject) or an email" };
  }

  const alreadyMember = await findMemberByEmail(workspace, email);
  if (alreadyMember) {
    return await grantMembership(workspace, alreadyMember.userId, a.role, email);
  }
  return await inviteMemberOp({ workspace, email, role: a.role });
}

/**
 * Leave a standing invite: whoever signs in with this verified address becomes
 * a `role` in this workspace. Nothing is emailed — telling the person they can
 * log in is a human step.
 */
export async function inviteMemberOp(a: { workspace: string; email: string; role: MembershipRole }): Promise<Record<string, unknown>> {
  const gate = adminGate(a.workspace);
  if (gate.error) return { ok: false, error: gate.error };
  const { workspace } = gate;

  const email = normalizeEmail(a.email);
  if (!looksLikeEmail(email)) {
    return { ok: false, error: `'${a.email}' does not look like an email address` };
  }
  if (!(await workspaceExists(workspace))) {
    return { ok: false, error: `unknown workspace '${workspace}' — create it first` };
  }

  // Someone already in the workspace has a subject we can grant on directly; an
  // invite for them would sit in the list forever, with nothing left to claim it.
  const alreadyMember = await findMemberByEmail(workspace, email);
  if (alreadyMember) {
    return { ok: false, error: `${email} is already a '${alreadyMember.role}' in '${workspace}' — use add_member with userId '${alreadyMember.userId}' to change their role` };
  }

  const store = getWorkspaceStore();
  const previous = await store.getInvite(workspace, email);
  const invite: InviteRecord = {
    workspace,
    email,
    role: a.role,
    invitedBy: currentActor().id,
    invitedAt: new Date().toISOString(),
  };
  await store.putInvite(invite);

  const auditVerb = previous ? `re-invited (was '${previous.role}')` : "invited";
  await auditAdmin(workspace, "membership", `${auditVerb} ${email} as '${a.role}' in '${workspace}'`);
  return {
    ok: true,
    invite,
    replaced: previous ?? undefined,
    note: `No mail is sent. Tell ${email} they can sign in — the role applies from their first login.`,
  };
}

export async function revokeInviteOp(a: { workspace: string; email: string }): Promise<Record<string, unknown>> {
  const gate = adminGate(a.workspace);
  if (gate.error) return { ok: false, error: gate.error };
  const { workspace } = gate;

  const email = normalizeEmail(a.email);
  const store = getWorkspaceStore();
  const invite = await store.getInvite(workspace, email);
  if (!invite) {
    return { ok: false, error: `no pending invite for ${email} in '${workspace}'` };
  }
  await store.removeInvite(workspace, email);
  await auditAdmin(workspace, "membership", `revoked the '${invite.role}' invite for ${email} in '${workspace}'`);
  return { ok: true, revoked: invite };
}

export async function removeMemberOp(a: { workspace: string; userId: string }): Promise<Record<string, unknown>> {
  const gate = adminGate(a.workspace);
  if (gate.error) return { ok: false, error: gate.error };
  const { workspace } = gate;
  const store = getWorkspaceStore();
  const target = await store.getMember(workspace, a.userId);
  if (!target) return { ok: false, error: `${a.userId} is not a member of '${workspace}'` };
  if (target.role === "admin") {
    const admins = (await store.membersOf(workspace)).filter((m) => m.role === "admin");
    if (admins.length <= 1) return { ok: false, error: `cannot remove the last admin of '${workspace}' — grant another admin first` };
  }
  await store.removeMember(workspace, a.userId);
  await auditAdmin(workspace, "membership", `revoked '${target.role}' from ${a.userId} in '${workspace}'`);
  return { ok: true, removed: { workspace, userId: a.userId, role: target.role } };
}

/** Everyone with access: real memberships, plus invites nobody has claimed yet. */
export async function listMembersOp(a: { workspace: string }): Promise<Record<string, unknown>> {
  const gate = adminGate(a.workspace);
  if (gate.error) return { ok: false, error: gate.error };
  const { workspace } = gate;

  const store = getWorkspaceStore();
  const members = await store.membersOf(workspace);
  const invites = await store.listInvites(workspace);
  const record = await store.getWorkspace(workspace);
  return { workspace, members, pendingInvites: invites, domainRules: record?.domainRules ?? [] };
}

export function registerWorkspaceTools(server: McpServer) {
  server.registerTool("list_workspaces", { title: "List workspaces", description: "List the workspaces you can enter (a super admin sees all). Each entry shows your role and its grade/subject graphs. Use this before set_context.", inputSchema: {} },
    async () => asJson(await listWorkspacesOp()));

  server.registerTool("create_workspace", { title: "Create a workspace", description: "Create a new tenant workspace (super admin only). The id becomes the top segment of every namespace it owns — use a short slug like 'kenya'. Seeding its curriculum graphs is a separate step.", inputSchema: { id: z.string(), displayName: z.string() } },
    async (a) => asJson(await createWorkspaceOp(a)));

  server.registerTool("add_member", { title: "Add / update a workspace member", description: "Grant a user a role (curator, approver, or admin) in a workspace. Requires admin in that workspace (or super admin). Identify the person by `email` (simplest — if they have never signed in, this becomes a pending invite they claim at first login) or by `userId`, their identity subject (Supabase JWT `sub`). Re-granting updates the role. A workspace admin cannot grant super admin (that tier is env-configured).", inputSchema: { workspace: z.string(), role: ROLE, email: z.string().optional(), userId: z.string().optional() } },
    async (a) => asJson(await addMemberOp(a)));

  server.registerTool("invite_member", { title: "Invite someone by email", description: "Give someone who has NOT signed in yet a role in a workspace, keyed by their email: whoever signs in with that verified address gets the role on their first login. Requires admin in that workspace (or super admin). No mail is sent — telling them they can log in is up to you. Pending invites show up in list_members; drop one with revoke_invite.", inputSchema: { workspace: z.string(), email: z.string(), role: ROLE } },
    async (a) => asJson(await inviteMemberOp(a)));

  server.registerTool("revoke_invite", { title: "Revoke a pending invite", description: "Withdraw an unclaimed invite for an email address. Requires admin in that workspace (or super admin). Someone who has already claimed theirs is a member now — use remove_member instead.", inputSchema: { workspace: z.string(), email: z.string() } },
    async (a) => asJson(await revokeInviteOp(a)));

  server.registerTool("remove_member", { title: "Remove a workspace member", description: "Revoke a user's role in a workspace. Requires admin in that workspace (or super admin). Refuses to remove the workspace's last admin (so a workspace can't be orphaned).", inputSchema: { workspace: z.string(), userId: z.string() } },
    async (a) => asJson(await removeMemberOp(a)));

  server.registerTool("set_domain_rule", { title: "Let a whole email domain join", description: "Anyone who signs in with an address at this domain becomes a member of the workspace at the given role — no invite needed. Super admin only. The rule only applies to sign-ins from a provider that vouches for the address (Google today); a password signup at that domain still needs an invite. Use 'curator': this grant gets no per-person review.", inputSchema: { workspace: z.string(), domain: z.string(), role: ROLE } },
    async (a) => asJson(await setDomainRuleOp(a)));

  server.registerTool("remove_domain_rule", { title: "Remove a domain rule", description: "Stop auto-admitting people from an email domain. Super admin only. People who already joined under the rule keep their role — use remove_member for those.", inputSchema: { workspace: z.string(), domain: z.string() } },
    async (a) => asJson(await removeDomainRuleOp(a)));

  server.registerTool("list_members", { title: "List workspace members", description: "List everyone with a role in a workspace. Requires admin in that workspace (or super admin).", inputSchema: { workspace: z.string() } },
    async (a) => asJson(await listMembersOp(a)));
}
