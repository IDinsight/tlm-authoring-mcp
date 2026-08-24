/*
 * First-login access: what a verified identity is entitled to before anyone has
 * granted them anything. Drives provisionMemberships against a memory store —
 * no actor plumbing, since provisioning takes the identity as an argument.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { provisionMemberships } from "../provision.js";
import { createMemoryWorkspaceStore } from "../store.js";
import type { WorkspaceStore } from "../types.js";

const SENEGAL = { id: "senegal", displayName: "Senegal", createdBy: "seed", createdAt: "1970-01-01T00:00:00Z" };

// Google vouches for the address; a password signup does not.
const VIA_GOOGLE = { id: "u-google", email: "awa@idinsight.org", authProvider: "google" };
const VIA_PASSWORD = { id: "u-password", email: "awa@idinsight.org", authProvider: "email" };

let store: WorkspaceStore;

beforeEach(() => {
  store = createMemoryWorkspaceStore({ workspaces: [SENEGAL] });
});

describe("claiming an invite", () => {
  beforeEach(async () => {
    await store.putInvite({
      workspace: "senegal",
      email: "awa@idinsight.org",
      role: "curator",
      invitedBy: "adm",
      invitedAt: "1970-01-01T00:00:00Z",
    });
  });

  it("turns the invite into a membership on first login", async () => {
    const grants = await provisionMemberships(VIA_PASSWORD, store);
    expect(grants).toMatchObject([{ workspace: "senegal", role: "curator", via: "invite" }]);
    expect(await store.getMember("senegal", "u-password")).toMatchObject({ role: "curator", email: "awa@idinsight.org" });
  });

  it("consumes the invite, so it stops showing as pending", async () => {
    await provisionMemberships(VIA_PASSWORD, store);
    expect(await store.listInvites("senegal")).toHaveLength(0);
  });

  it("is a no-op the second time — nothing left to claim", async () => {
    await provisionMemberships(VIA_PASSWORD, store);
    expect(await provisionMemberships(VIA_PASSWORD, store)).toEqual([]);
  });

  it("matches the address whatever case the token carries", async () => {
    const grants = await provisionMemberships({ ...VIA_PASSWORD, email: "Awa@IDinsight.org" }, store);
    expect(grants).toHaveLength(1);
  });

  it("gives nothing to a different address at the same domain", async () => {
    const grants = await provisionMemberships({ id: "u2", email: "someone-else@idinsight.org", authProvider: "email" }, store);
    expect(grants).toEqual([]);
    expect(await store.getMember("senegal", "u2")).toBeNull();
  });
});

describe("domain auto-join", () => {
  beforeEach(async () => {
    await store.putWorkspace({ ...SENEGAL, domainRules: [{ domain: "idinsight.org", role: "curator" }] });
  });

  it("admits a matching Google identity with no invite", async () => {
    const grants = await provisionMemberships(VIA_GOOGLE, store);
    expect(grants).toMatchObject([{ workspace: "senegal", role: "curator", via: "domain" }]);
    expect(await store.getMember("senegal", "u-google")).toMatchObject({ role: "curator" });
  });

  it("refuses a password signup at the same domain — nothing vouches for the address", async () => {
    const grants = await provisionMemberships(VIA_PASSWORD, store);
    expect(grants).toEqual([]);
    expect(await store.getMember("senegal", "u-password")).toBeNull();
  });

  it("refuses when the token names no provider at all", async () => {
    const grants = await provisionMemberships({ id: "u3", email: "awa@idinsight.org" }, store);
    expect(grants).toEqual([]);
  });

  it("ignores a non-matching domain", async () => {
    const grants = await provisionMemberships({ id: "u4", email: "awa@gmail.com", authProvider: "google" }, store);
    expect(grants).toEqual([]);
  });

  it("does not admit anyone to an archived workspace", async () => {
    await store.putWorkspace({ ...SENEGAL, archived: true, domainRules: [{ domain: "idinsight.org", role: "curator" }] });
    expect(await provisionMemberships(VIA_GOOGLE, store)).toEqual([]);
  });

  it("an invite for the same workspace wins — an admin decided that role deliberately", async () => {
    await store.putInvite({
      workspace: "senegal",
      email: "awa@idinsight.org",
      role: "approver",
      invitedBy: "adm",
      invitedAt: "1970-01-01T00:00:00Z",
    });
    const grants = await provisionMemberships(VIA_GOOGLE, store);
    expect(grants).toMatchObject([{ role: "approver", via: "invite" }]);
    expect((await store.getMember("senegal", "u-google"))?.role).toBe("approver");
  });
});

describe("entitled to nothing", () => {
  it("an identity with no email gets nothing", async () => {
    expect(await provisionMemberships({ id: "u5", authProvider: "google" }, store)).toEqual([]);
  });

  it("a stranger gets nothing, and no membership is written", async () => {
    const grants = await provisionMemberships({ id: "u6", email: "stranger@example.com", authProvider: "google" }, store);
    expect(grants).toEqual([]);
    expect(await store.membersOf("senegal")).toEqual([]);
  });
});
