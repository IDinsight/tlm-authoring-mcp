/*
 * Module: identity · types (service surface)
 *
 * Reading the identity provider's USER DIRECTORY — "which accounts exist?" —
 * which is a different question from "who may do what", the one the workspaces
 * registry answers. Only one caller needs this: the super-admin tool that finds
 * people who signed up and never got a role.
 *
 * It is an interface rather than a direct Supabase call so the provider stays
 * swappable: a Firebase move reimplements `listUsers` and nothing above it
 * changes. See docs/design-notes/member-onboarding.md.
 */

/** One account, reduced to the fields an admin needs to decide what to do about it. */
export type DirectoryUser = {
  /** The identity subject — the same value a membership's `userId` holds. */
  id: string;
  email?: string;
  /** How they signed up ("google", "email", …), for the same trust reasons as Actor.authProvider. */
  provider?: string;
  createdAt?: string;
  lastSignInAt?: string;
  /**
   * When their address was confirmed, if ever. An unconfirmed account is one
   * nobody has proven they own, so it is worth seeing before granting a role.
   */
  emailConfirmedAt?: string;
};

export interface IdentityDirectory {
  /** Every account, oldest-first is not guaranteed — callers sort. */
  listUsers(): Promise<DirectoryUser[]>;
}
