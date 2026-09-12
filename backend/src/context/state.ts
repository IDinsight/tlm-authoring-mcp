/*
 * Module: context · state (leaf)
 *
 * The active teaching context — which grade + subject the server is working on.
 * The choice selects (a) which local sources load and (b) which Firebase
 * namespace documents and history live under. It must be set before any source-
 * or bucket-dependent tool runs; when it isn't, requireContext() throws
 * ContextNotSetError and the server prompts the user to choose one.
 *
 * This module is a dependency-light LEAF (imports only config + utils + the
 * context/shared types). Many modules import it at init time, so it must not
 * import adapters/* or storage/* back — the adapter resolution + schema guard
 * that need those live in the app-layer activate.ts (at the repo root).
 */
import { resolve } from "node:path";
import { CONFIG, basePrefix } from "../config.js";
import { slug, assertSafeRelPath } from "../utils/index.js";
import { type ActiveContext, ContextNotSetError } from "./shared.js";
import { sessionState } from "./session.js";

// The active context lives in the current session's state (per-session in HTTP
// mode, process-wide in stdio mode). Context-derived caches live in the same
// session's bag and are cleared wholesale on a context switch — this replaced
// the old onContextChange listener registry, which was process-global and
// therefore unsafe once multiple sessions share the process.

// Installed contexts, discovered from the KG store (the source of truth for
// WHICH graphs exist). This module is a dependency-light leaf that must not
// import kg-store — so the app layer reads the store's namespaces and PUSHES the
// parsed list here via setAvailableContexts (activate.ts::refreshAvailableContexts,
// called at startup and after an import). Until it does, the list is empty.
let storeContexts: ActiveContext[] = [];

// Install (or reset, with null) the store-derived context list.
export function setAvailableContexts(contexts: ActiveContext[] | null): void { storeContexts = contexts ?? []; }

// The installed contexts — whatever the store snapshot last reported.
export function listAvailableContexts(): ActiveContext[] { return storeContexts; }

export function getActiveContext(): ActiveContext | null { return sessionState().active; }

// Low-level bind: slugify, validate against installed sources, set the active
// context, and drop the session's context-derived caches. Adapter resolution
// and the schema guard live in activateContext() (root activate.ts) to avoid an
// import cycle; call that, not this, from tools and startup.
export function setActiveContext(workspace: string, grade: string, subject: string):
  | { ok: true; context: ActiveContext }
  | { ok: false; error: string; available: ActiveContext[] } {
  const w = slug(workspace), g = slug(grade), s = slug(subject);
  const available = listAvailableContexts();
  const match = available.find((c) => c.workspace === w && c.grade === g && c.subject === s);
  if (!match) return { ok: false, error: `No graph found in the store for workspace '${workspace}' / grade '${grade}' / subject '${subject}'. Import it first.`, available };
  const st = sessionState();
  const changed = !st.active || st.active.workspace !== match.workspace || st.active.grade !== match.grade || st.active.subject !== match.subject;
  st.active = match;
  if (changed) st.bag.clear();
  return { ok: true, context: match };
}

export function requireContext(): ActiveContext {
  const { active } = sessionState();
  if (!active) throw new ContextNotSetError(listAvailableContexts());
  return active;
}

// -- Context-scoped object-key helpers ---------------------------------------
// There were on-disk path helpers here (activeAssetDir / assetPath) for reading
// the active subject's assets at runtime. Nothing does that any more: the KG,
// the guide and the glossary all live in the store, so assets/ is seed-only and
// the seed scripts resolve it themselves.

// The active workspace — the tenant segment production namespace/storage keys
// hang off. Throws (via requireContext) if no context is set.
export const activeWorkspace = (): string => requireContext().workspace;

const scope = () => { const { workspace, grade, subject } = requireContext(); return `${workspace}/${grade}/${subject}/`; };
export const docsPrefix = () => basePrefix() + scope() + "documents/";
export const historyKey = () => basePrefix() + scope() + "history.json";
export const docKey = (relPath: string) => { assertSafeRelPath(relPath); return docsPrefix() + relPath; };

/*
 * A document object's URI — the canonical locator a picture node keeps in its
 * LC `identifier` (docs/design-notes/illustrations-as-materials.md). A real
 * `gs://` URI to the object, so the graph says where the bytes are with no
 * field of our own; the bucket is in it because that is what makes it a
 * locator rather than a name. Resolving it back checks the bucket AND the
 * namespace, so a graph moved to another deployment refuses rather than reads
 * the wrong object.
 */
const OBJECT_URI_SCHEME = "gs://";
const DOCUMENTS_SEGMENT = "/documents/";

export const documentObjectUri = (relPath: string): string => {
  if (!CONFIG.firebaseBucket) throw new Error("No FIREBASE_STORAGE_BUCKET is configured, so no object URI can be formed.");
  return `${OBJECT_URI_SCHEME}${CONFIG.firebaseBucket}/${docKey(relPath)}`;
};

/** Split an object URI structurally, with no context: null when it is not one. */
export function parseDocumentObjectUri(uri: string): { bucket: string; objectKey: string; relPath: string } | null {
  if (typeof uri !== "string" || !uri.startsWith(OBJECT_URI_SCHEME)) return null;
  const slash = uri.indexOf("/", OBJECT_URI_SCHEME.length);
  if (slash < 0) return null;
  const bucket = uri.slice(OBJECT_URI_SCHEME.length, slash);
  const objectKey = uri.slice(slash + 1);
  const at = objectKey.indexOf(DOCUMENTS_SEGMENT);
  if (!bucket || at < 0) return null;
  const relPath = objectKey.slice(at + DOCUMENTS_SEGMENT.length);
  return relPath ? { bucket, objectKey, relPath } : null;
}

/**
 * The documents-relative path an object URI names IN THIS deployment's bucket
 * and THIS namespace — or a reason it cannot be read here. Never a path from
 * another namespace: that is how a picture would be read from the wrong subject.
 */
export function relPathOfDocumentObjectUri(uri: string): { relPath: string } | { refused: string } {
  const parsed = parseDocumentObjectUri(uri);
  if (!parsed) return { refused: `'${uri}' is not an object URI (gs://<bucket>/<key>)` };
  if (parsed.bucket !== CONFIG.firebaseBucket) return { refused: `'${uri}' lives in bucket '${parsed.bucket}', not this deployment's` };
  const prefix = docsPrefix();
  if (!parsed.objectKey.startsWith(prefix)) return { refused: `'${uri}' is outside this namespace's documents area` };
  return { relPath: parsed.objectKey.slice(prefix.length) };
}

// Preview objects live under a SIBLING prefix to documents/ (never inside it),
// so a preview .docx is observably non-canonical: reconcile/discoverDocuments
// only scan docsPrefix(), so nothing under previews/ can ever reach the tracked
// document history. Used only by the preview-generation output path. Kept
// separate from docKey deliberately — a preview must not share the canonical
// documents keyspace.
export const previewsPrefix = () => basePrefix() + scope() + "previews/";
export const previewKey = (relPath: string) => { assertSafeRelPath(relPath); return previewsPrefix() + relPath; };
