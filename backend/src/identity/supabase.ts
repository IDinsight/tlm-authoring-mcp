/*
 * Module: identity · supabase directory (service surface)
 *
 * Lists the project's accounts through GoTrue's admin API.
 *
 * SECURITY: this is the ONLY place SUPABASE_SERVICE_ROLE_KEY is read, and it is
 * used for exactly one read-only call. That key bypasses row-level security and
 * can mint tokens and delete users, so it must never be logged, returned to a
 * caller, or handed to anything else. Absent key = no directory (the tool says
 * so); it is never a reason to fall back to a weaker check.
 */
import type { DirectoryUser, IdentityDirectory } from "./types.js";

// GoTrue caps per_page; 1000 is the documented ceiling. We page until a short
// page comes back, and stop at MAX_USERS so a runaway project can't hang a tool
// call — an admin looking for stranded users does not need page 12 of 12.
const PER_PAGE = 1000;
const MAX_USERS = 10_000;

/** The subset of GoTrue's user shape we read. Everything else is ignored. */
type GoTrueUser = {
  id?: unknown;
  email?: unknown;
  created_at?: unknown;
  last_sign_in_at?: unknown;
  email_confirmed_at?: unknown;
  app_metadata?: { provider?: unknown };
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

function toDirectoryUser(raw: GoTrueUser): DirectoryUser | null {
  const id = str(raw.id);
  if (!id) {
    return null;
  }
  return {
    id,
    email: str(raw.email),
    // app_metadata, not user_metadata — the user can rewrite the latter.
    provider: str(raw.app_metadata?.provider),
    createdAt: str(raw.created_at),
    lastSignInAt: str(raw.last_sign_in_at),
    emailConfirmedAt: str(raw.email_confirmed_at),
  };
}

/**
 * Build a directory from env, or null when SUPABASE_SERVICE_ROLE_KEY is unset.
 * Null is the normal state for a deployment that hasn't opted in — callers
 * report "not configured" rather than failing.
 */
export function createSupabaseDirectory(): IdentityDirectory | null {
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceKey) {
    return null;
  }

  return {
    async listUsers() {
      const users: DirectoryUser[] = [];

      for (let page = 1; users.length < MAX_USERS; page++) {
        const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=${PER_PAGE}`, {
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          // Deliberately no response body in the message: an auth failure from
          // GoTrue can echo request details, and this one carries the key.
          throw new Error(`identity directory read failed (HTTP ${res.status})`);
        }

        const body = await res.json() as { users?: GoTrueUser[] };
        const batch = body.users ?? [];
        for (const raw of batch) {
          const user = toDirectoryUser(raw);
          if (user) {
            users.push(user);
          }
        }
        // A short page is the last page — GoTrue returns no total we can trust
        // across versions.
        if (batch.length < PER_PAGE) {
          break;
        }
      }

      return users;
    },
  };
}

// Lazy singleton + a test seam, mirroring getWorkspaceStore/__setWorkspaceStoreForTest.
let directory: IdentityDirectory | null | undefined;

export function getIdentityDirectory(): IdentityDirectory | null {
  if (directory === undefined) {
    directory = createSupabaseDirectory();
  }
  return directory;
}

export function __setIdentityDirectoryForTest(d: IdentityDirectory | null | undefined): void {
  directory = d;
}
