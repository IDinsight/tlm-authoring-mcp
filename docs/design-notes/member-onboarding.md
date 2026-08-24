# Member onboarding (domain auto-join, invites, account self-service)

**Status:** Steps 1-3 (invites, domain auto-join + first-login provisioning,
Google sign-in) implemented 2026-08-24, uncommitted; step 4 (`/account` for
passwords) is still proposal. Extends
[`workspaces.md`](workspaces.md), which defined the membership registry this
note fills.

## Why

Getting a new person into the server is currently a two-person, two-system
chore. `add_member` takes `userId` — the raw Supabase JWT `sub`
(`server/workspaces.ts:129`) — so an admin must first have the newcomer log in,
then find their UUID in the Supabase dashboard, then grant the role. There is no
way to say "let anyone from idinsight.org in" and no way to prepare access
*before* someone's first login.

Three things follow: onboarding blocks on a super admin, it needs dashboard
access nobody should need, and the identifier the admin types (a UUID) is not
the identifier they know (an email).

## Decision 1 — the identity provider stays Supabase

Considered and rejected for now: moving identity to Firebase Auth so that auth,
Firestore, and Storage sit in one project.

The blocker is that Supabase is not merely issuing our tokens — it is the
**OAuth 2.1 authorization server** the MCP connector logs in against. Claude
registers itself as a client, is redirected to `/authorize`, and exchanges a
code for a token; `http.ts:377` advertises that server in the protected-resource
metadata, and `consent.ts` serves the consent screen it delegates back to us.

Firebase Auth signs a first-party app's users into that app. It has no
authorize endpoint, no dynamic client registration, and no third-party consent
screen — neither does Identity Platform. Moving to it therefore means writing
and owning an OAuth 2.1 authorization server (authorize, consent, PKCE code
store, token endpoint, our own signing key + JWKS, refresh, revocation) with
Firebase underneath holding user records. That is security-critical code we'd
maintain forever, to replace something we get for free.

The consolidation win is also smaller than it looks: Supabase stores **no
application data** for us. The only Supabase-database dependency in the repo is
`scripts/supabase-user-roles.sql`, the legacy `app_role` hook we already intend
to retire.

The swap stays cheap to reconsider: `supabaseVerifier()` (`http.ts:48`) and
`resolveActor()` (`actor.ts`) are the entire identity surface, ~40 lines. Every
decision below is provider-agnostic by construction — it operates on a verified
`{ sub, email, email_verified, provider }`, never on a Supabase concept.

## Decision 2 — onboarding is authorization, not identity

Domain whitelisting and invites are *membership* rules. They belong in our
Firestore registry (`src/workspaces/`), not in the identity provider. That is
what makes them independent of Decision 1 and what lets a person who signed in
with Google, with a password, or with a future provider all land in the same
place.

A membership can therefore arise three ways:

| Path | Who initiates | Keyed by |
|---|---|---|
| **Auto-join** | nobody — the workspace's domain rule fires on first login | email domain |
| **Invite** | an admin, before the person has an account | email |
| **Direct grant** | an admin, for someone already known (today's `add_member`) | `sub` |

## The model

### Domain rules ride on the workspace

```ts
type DomainRule = { domain: string; role: MembershipRole };   // role SHOULD be "curator"
type WorkspaceRecord = { /* …existing… */ domainRules?: DomainRule[] };
```

Concretely: `senegal` carries `{ domain: "idinsight.org", role: "curator" }`, so
an IDinsight colleague's first login makes them a curator of `senegal` and of
nothing else. Rules are per workspace, so a second tenant's domain never leaks
across.

### Invites are a collection keyed by email

```ts
type InviteRecord = {
  workspace: string;
  email: string;             // normalized; doc id = `${workspace}::${email}`
  role: MembershipRole;
  invitedBy: string;         // actor id
  invitedAt: string;         // ISO-8601 UTC
};
```

There are deliberately **no `claimedBy` / `claimedAt` fields**: the step-2 claim
writes the membership and *deletes* the invite, so an invite row is pending by
construction and `list_members` needs no filter to say what is outstanding. The
audit trail keeps the history the fields would have carried.

An invite is **not** an email we send — it is a standing permission. There is no
token to leak and no link to expire out from under someone: the person signs in
however they like, and the invite matches on their verified address. Telling
them "you can log in now" stays a human act (or a later, optional SMTP step).

### Provisioning happens on the request path, not in a signup hook

`http.ts` already does one membership read per request (`withMemberships`). When
that read comes back **empty** and the actor is not a super admin, run a
provision step before proceeding:

1. Claim **every** pending invite for the verified email, in whatever
   workspaces they were issued → write those memberships.
2. Match the verified email's domain against every workspace's `domainRules`
   → write those memberships too. For a workspace where both apply, the invite
   wins: an admin made a specific decision about this person, so their role is
   the one that stands.
3. Audit either as a `membership` event with the reason (`"auto-joined
   'senegal' as curator via domain rule idinsight.org"`), so the trail reads the
   same as an admin grant.
4. Re-read and continue.

No provider webhook, no signup callback, no second code path for "the explorer
vs. MCP" — both go through the same actor resolution. The extra read only runs
for callers who have no memberships at all, which after onboarding is nobody;
a negative result can be cached for the session.

## Security rules (non-negotiable)

- **Auto-join requires a provider that VOUCHES for the address.** Granting on
  "the address ends in idinsight.org" would otherwise let anyone type
  `fake@idinsight.org` and become a curator.

  The obvious control — an `email_verified` claim — turned out not to exist:
  Supabase's [JWT claims reference](https://supabase.com/docs/guides/auth/jwt-fields)
  documents no such field, and the place it does show up in practice,
  `user_metadata`, is **writable by the signed-in user** via
  `supabase.auth.updateUser` — so trusting it would let someone verify
  themselves. `app_metadata` is not user-writable (only a service-role key can
  change it), so `app_metadata.provider` is the one usable signal.

  The implemented rule is therefore: **`provider` ∈ {`google`} and domain
  match**. Google will not mint an `@idinsight.org` identity for someone outside
  that Workspace, so the provider is doing the verifying. A password signup at
  the same domain gets nothing from a domain rule — that person needs an invite.
  `resolveActor` never reads `user_metadata`, and `http.ts` never passes it
  through.
- **Auto-join grants the lowest useful role.** `curator` — never `approver` or
  `admin`. Publishing rights stay a deliberate human grant.
- **A domain rule is a super-admin write.** A workspace admin who could add
  domain rules could hand themselves an unbounded supply of colleagues.
- **Invites match the verified email only** — never a `preferred_username`, a
  display name, or anything the user controls.
- **Invites depend on one Supabase project setting.** An invite is claimable by
  whoever holds a token for that address, whatever provider they used. If
  Supabase's "Confirm email" is turned OFF, someone could sign up with an
  invited colleague's address, never confirm it, and claim their invite. It is
  ON by default and must stay on. (Hardening option, not built: read
  `email_confirmed_at` from the Supabase Admin API at claim time. That costs a
  service-role secret and ties the claim path to Supabase, so it is deliberately
  not the default.)
- **Passwords never travel through MCP.** See below.

## Tool surface

New, in `server/workspaces.ts` (same `authorizeWorkspace` gate as today):

- `invite_member(workspace, email, role)` — admin of that workspace, or super
  admin. Writes an `InviteRecord`. Replaces the "make them log in, then find
  their UUID" dance. Re-inviting the same address replaces the role; inviting
  someone who is already a member is refused, naming their `userId` instead.
- `revoke_invite(workspace, email)` — same gate.
- `set_domain_rule(workspace, domain, role)` / `remove_domain_rule(...)` —
  **super admin only**. Removing a rule does not revoke anyone who already
  joined under it; `remove_member` is the tool for that.

There is no `list_invites`: pending invites come back from `list_members`, which
is the whole point of putting them there — "who has access?" has one answer.

Changed:

- `add_member` accepts `email` **or** `userId`. Given an email that an existing
  membership already carries as a label, it grants on that `userId` directly;
  given an unrecognised one, it writes an invite and says so. Either way the
  admin never has to know whether the account exists.
- `list_members` shows pending invites alongside real memberships, so an admin
  sees one list of "who has access".

Unchanged: `remove_member`, and the last-admin guard.

## Google sign-in (step 3)

Both login surfaces — the OAuth consent page (`consent.ts`, where MCP clients
land) and the KG explorer's `LoginGate` — offer Google above the password form,
with the password form kept underneath for invited experts.

Two details worth knowing:

- **The consent page's round trip must preserve `authorization_id`.** Signing in
  with Google navigates away and comes back, and the consent step cannot approve
  the pending authorization without that parameter. The return URL is rebuilt
  from `location.origin + pathname + ?authorization_id=…` rather than reusing
  `location.href`, so a spent `?code=` from an earlier attempt cannot ride
  along. On return, supabase-js has already exchanged the code, so the existing
  `getSession()` check at the bottom of the page resumes the flow.
- **The button only appears when the provider is actually on.** The server
  probes Supabase's public `/auth/v1/settings` once at startup and passes
  `external.google` into the consent page and out through `/kg/config`. A failed
  probe shows the button: hiding a working login is worse than showing one that
  errors. The same probe reads `mailer_autoconfirm` and logs a loud warning when
  email confirmation is off, which is the precondition the invite path rests on.

The dashboard settings this depends on are listed in
[`deployment.md`](../technical-reference/deployment.md#supabase-project-settings-this-server-depends-on).

## Account self-service is a web page, not a tool

Password change and password reset get a small authenticated page (`/account`,
next to `/oauth/consent`), plus a "mot de passe oublié" link on the consent
screen itself. They are deliberately **not** MCP tools: a tool call puts the
password in the model's context and in the audit trail. Invites over MCP are
fine — they carry no secret. Passwords are not.

This needs SMTP configured on the Supabase project for reset mail; without it,
reset stays a super-admin action in the dashboard.

## Seeing who is stuck

`list_unaffiliated_users` (super admin) lists accounts that hold no role anywhere —
the people who signed in and found they could do nothing. It reads the identity
provider's directory through `identity/IdentityDirectory` and joins it against the
membership registry.

The alternative was to record unaffiliated callers ourselves at the provisioning
step, which needs no new secret and stays provider-agnostic. It was rejected because
it only ever sees people who reached the server: someone who signed up and never came
back — the case most worth noticing — would be invisible. The cost is
`SUPABASE_SERVICE_ROLE_KEY`, confined to `identity/supabase.ts` behind an interface so
a Firebase move reimplements one method.

Each entry says *why* there is no role, because the three causes need different fixes:

| status | meaning | fix |
|---|---|---|
| `invited` | an invite is waiting; they have not signed in since | tell them to sign in |
| `unconfirmed` | password signup, confirmation mail never clicked | resend it; a role would do nothing yet |
| `stranded` | nothing is waiting for them | `add_member` or `invite_member` |

Super admins are excluded: they hold no membership by design, so listing them would
be a standing false alarm.

## Open questions

1. **Sign-in methods.** Both are built and both stay enabled: Google (which is
   what makes domain auto-join possible) and email+password (for invited
   experts). Whether the Senegal experts end up on Google accounts is still
   unresolved; while any of them use a password, `/account` stays necessary.
2. **Auto-join into which role for a *second* workspace?** A domain rule is
   per workspace, so an idinsight.org address could match several. Proposed:
   grant all matches (each workspace opted in explicitly).
3. **Invite expiry.** Not implemented — `expiresAt` was left off the record
   until there is a reason for it. A standing invite is not a secret, so expiry
   is hygiene rather than security; add the field with the sweep that uses it.
