/*
 * Public surface of the identity module: reading the provider's user directory
 * ("which accounts exist?"), as distinct from the workspaces registry ("who may
 * do what"). See docs/design-notes/member-onboarding.md.
 */
export * from "./types.js";
export {
  getIdentityDirectory,
  createSupabaseDirectory,
  __setIdentityDirectoryForTest,
} from "./supabase.js";
