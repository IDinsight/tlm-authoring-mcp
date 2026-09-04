/*
 * Layer: core (leaf)
 *
 * Static configuration read once from the environment: where local sources live,
 * the canonical per-subject source filenames, Firebase credentials, and the
 * config-derived DOCX_MIME/basePrefix helpers. Imports nothing from this project,
 * so every other module can import it freely without risk of a cycle. (Pure
 * string helpers like slug/noAccents live in utils/.)
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const env = process.env;
const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fromRoot = (p: string) => resolve(PKG_ROOT, p);

export const CONFIG = {
  // On-disk SEED root (override with TLM_SEEDS_DIR): one folder per
  // workspace/grade/subject, holding the GRAPH_GUIDE.md a namespace is seeded
  // FROM. Nothing here is on a runtime path — the server reads the guide from
  // the store's config cell, and the graph from the store — so only the seed
  // scripts and the tests resolve against this. It is not shipped in the image.
  seedsDir: env.TLM_SEEDS_DIR ? resolve(env.TLM_SEEDS_DIR) : fromRoot("seeds"),
  // Firebase Storage (shared source of truth for documents + history).
  serviceAccountKeyPath: env.SERVICE_ACCOUNT_KEY_PATH ?? "",
  // Alternative to the key path: the key's JSON content directly (for hosts
  // where mounting a file is impractical). Path wins if both are set.
  serviceAccountKeyJson: env.SERVICE_ACCOUNT_KEY_JSON ?? "",
  firebaseBucket: env.FIREBASE_STORAGE_BUCKET ?? "",
  bucketPrefix: (env.TLM_BUCKET_PREFIX ?? "").replace(/\/+$/, ""), // optional, no trailing slash
  // Optional startup defaults for the active teaching context.
  defaultWorkspace: (env.TLM_WORKSPACE ?? "").trim(),
  defaultGrade: (env.TLM_GRADE ?? "").trim(),
  defaultSubject: (env.TLM_SUBJECT ?? "").trim(),
  // Google Gemini, used only by the `translate` tool for FR↔Wolof translation
  // (Gemini reads Wolof more reliably than we do in-house). The API key is a
  // secret provisioned per deployment; the model is env-overridable so it can be
  // bumped without a code change. baseUrl is overridable for tests/regional
  // routing. No key set → the translate tool reports a clear config error.
  gemini: {
    apiKey: env.GEMINI_API_KEY ?? "",
    model: (env.GEMINI_MODEL ?? "gemini-3.6-flash").trim(),
    baseUrl: (env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com").replace(/\/+$/, ""),
  },
};

// The single tenant every graph belonged to before workspaces existed, and the
// default for the 2-arg kgNamespace() convenience + a source folder that has no
// workspace segment yet. Production paths always pass a workspace explicitly;
// this only backstops single-tenant/legacy call sites (tests, un-migrated
// sources). See docs/design-notes/workspaces.md.
export const DEFAULT_WORKSPACE = "senegal";

// Root of trust for super admins: comma-separated JWT `sub`s or emails. Env-only
// in v1 (not stored, not grantable at runtime) so the first super admin exists
// before any workspace or membership does — see docs/design-notes/workspaces.md.
export function superAdmins(): string[] {
  return (process.env.TLM_SUPER_ADMINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Where the KG explorer is served from (Firebase Hosting), most-preferred first.
// One value, two readers: it is the CORS allow-list for /kg, and it is where the
// root landing page forwards a sign-in that Supabase bounced to this service
// instead of the explorer. Read at call time so a deployment can override it
// (KG_ALLOWED_ORIGINS, comma-separated) without a code change.
export function explorerOrigins(): string[] {
  const configured = process.env.KG_ALLOWED_ORIGINS
    ?? "https://senegal-ci-maths.web.app,https://senegal-ci-maths.firebaseapp.com";
  return configured.split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
}

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Base object-key prefix from env. The active grade/subject scope is appended in
// context/state.ts so each context gets its own documents/ and history.json.
export const basePrefix = () => (CONFIG.bucketPrefix ? CONFIG.bucketPrefix + "/" : "");
