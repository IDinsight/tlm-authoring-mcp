/*
 * Module: workspaces · provision (service surface)
 *
 * First-login access: turn a pending invite, or a workspace's domain rule, into
 * a real membership. Runs on the request path — when a verified caller has NO
 * memberships at all, the app layer calls this once before authorizing them
 * (see http.ts::resolveRequestActor). After it grants, the caller has
 * memberships and it never runs for them again.
 *
 * Why here and not in a signup webhook: the identity provider is the one part
 * of this system we want to stay swappable, and a webhook would tie onboarding
 * to it. See docs/design-notes/member-onboarding.md.
 */
import type { MembershipRole } from "../actor.js";
import { getWorkspaceStore } from "./store.js";
import type { InviteRecord, WorkspaceStore } from "./types.js";
import { normalizeEmail } from "../utils/index.js";

/**
 * Sign-in providers that VOUCH for the address in the token — Google will not
 * mint an @idinsight.org identity for someone outside that Workspace, so a
 * domain rule can trust one. A password signup ("email") proves only that
 * somebody typed the address, so it never satisfies a domain rule; that person
 * needs an invite instead.
 */
const DOMAIN_RULE_PROVIDERS = new Set(["google"]);

/** The verified identity fields provisioning is allowed to look at. */
export type ProvisionIdentity = {
  id: string;
  email?: string;
  /** `app_metadata.provider` — see Actor.authProvider for why only this one. */
  authProvider?: string;
};

/** One membership provisioning created, and what entitled the person to it. */
export type ProvisionGrant = {
  workspace: string;
  role: MembershipRole;
  via: "invite" | "domain";
  /** Human-readable justification, copied into the audit record. */
  reason: string;
};

const domainOf = (email: string): string => email.slice(email.lastIndexOf("@") + 1);

/**
 * Claim everything this identity is entitled to, writing the memberships.
 * Returns the grants it made (empty when the person is entitled to nothing),
 * so the app layer can audit them — this module writes memberships, never audit
 * records, to keep the store dependency one-directional.
 *
 * Invites win over domain rules for the same workspace: an invite is a specific
 * decision an admin made about this person, so its role is the one that stands.
 */
export async function provisionMemberships(
  identity: ProvisionIdentity,
  store: WorkspaceStore = getWorkspaceStore(),
): Promise<ProvisionGrant[]> {
  if (!identity.email) {
    return [];
  }
  const email = normalizeEmail(identity.email);

  const grants: ProvisionGrant[] = [];
  const invites = await store.invitesForEmail(email);
  for (const invite of invites) {
    grants.push(await claimInvite(invite, identity, store));
  }

  const claimed = new Set(grants.map((grant) => grant.workspace));
  const fromDomain = await domainGrants(email, identity, claimed, store);
  grants.push(...fromDomain);

  return grants;
}

async function claimInvite(
  invite: InviteRecord,
  identity: ProvisionIdentity,
  store: WorkspaceStore,
): Promise<ProvisionGrant> {
  await store.putMember({
    workspace: invite.workspace,
    userId: identity.id,
    email: invite.email,
    role: invite.role,
    grantedBy: invite.invitedBy,
    grantedAt: new Date().toISOString(),
  });

  // Consume the invite: the membership now carries the grant, so leaving the
  // row behind would show up forever as "pending" in list_members.
  await store.removeInvite(invite.workspace, invite.email);

  return {
    workspace: invite.workspace,
    role: invite.role,
    via: "invite",
    reason: `claimed the '${invite.role}' invite for ${invite.email} (invited by ${invite.invitedBy})`,
  };
}

async function domainGrants(
  email: string,
  identity: ProvisionIdentity,
  skipWorkspaces: ReadonlySet<string>,
  store: WorkspaceStore,
): Promise<ProvisionGrant[]> {
  const provider = identity.authProvider ?? "";
  if (!DOMAIN_RULE_PROVIDERS.has(provider)) {
    return [];
  }

  const domain = domainOf(email);
  const workspaces = await store.listWorkspaces();
  const grants: ProvisionGrant[] = [];

  for (const workspace of workspaces) {
    if (workspace.archived || skipWorkspaces.has(workspace.id)) {
      continue;
    }
    const rule = workspace.domainRules?.find((candidate) => candidate.domain === domain);
    if (!rule) {
      continue;
    }
    await store.putMember({
      workspace: workspace.id,
      userId: identity.id,
      email,
      role: rule.role,
      grantedBy: `domain-rule:${domain}`,
      grantedAt: new Date().toISOString(),
    });
    grants.push({
      workspace: workspace.id,
      role: rule.role,
      via: "domain",
      reason: `auto-joined '${workspace.id}' as '${rule.role}' — ${email} matches the ${domain} rule, signed in with ${provider}`,
    });
  }

  return grants;
}
