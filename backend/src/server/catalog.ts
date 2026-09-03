/*
 * Module: server · tool group: catalog
 *
 * Tools over the reusable-spec catalog. The catalog spans TWO scopes, both read
 * here: the cross-tenant SHARED library and the active workspace's own library.
 *   - list_catalog  — browse the entries a curator can pick, from BOTH scopes,
 *                     each tagged with its scope + kind (read-only, ungated).
 *   - use_routine   — COPY a routine entry onto a lesson (linked via `usesRoutine`).
 *   - use_formatter — COPY a formatter entry (a house-style spec) under a document.
 *   - use_rubric    — COPY a rubric entry (an evaluation grid) under a document.
 *                     All three share one path: the entry's subtree is cloned with
 *                     fresh ids into the ACTIVE subject's draft; the copy is
 *                     independent of the library. They diverge in the ATTACHMENT — a
 *                     routine links to a Lesson via `usesRoutine`; a formatter and a
 *                     rubric are relabelled to the document layer (Formatter/
 *                     FormatterSpec, Rubric/RubricSection/RubricCriterion) and hung
 *                     under the Course's TeachingLearningMaterial via `hasPart`.
 *
 * use_routine shares the graph-mutation envelope: a dry-run returns a diff +
 * confirmationToken + the minted id-map (no state change); the confirm re-checks the
 * token and applies to the DRAFT only. Because the copy mints many ids, the dry-run
 * surfaces the whole `old → new` map (as add_node surfaces its single mintedNodeId),
 * and the caller passes it back on confirm so both phases build the identical clone.
 *
 * See docs/design-notes/authorable-catalog.md.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { asJson, asMarkdown, guarded } from "./shared.js";
import { getActiveAdapter } from "../adapters/index.js";
import { activeWorkspace } from "../context/index.js";
import { getKgStore, mintNodeId, runGraphMutation, kgNamespace, publishDraft, discardDraft, type MutationGraph, type MutationEdge, type MutationNode, type StoredEdge, type StoredNode } from "../kg-store/index.js";
import { SHARED_CATALOG_NAMESPACE, catalogNamespace, cloneRoutineSubtree, relabelClonedFormatter, relabelClonedRubric, relabelForCatalog, addCatalogEntry, listCatalogEntries, renderCatalogEntry, useRoutine, useFormatter, useRubric, type CatalogEntry, type CatalogKind, type CatalogScope, type UseRoutineArgs, type UseFormatterArgs, type UseRubricArgs } from "../kg-recipes/index.js";
import { parkWrapperContext, readWrapperContext, deleteWrapperContext } from "./wrapper-park.js";
// Destination resolution moved to catalog-target.ts, which the generic write
// verbs (edit_nodes / add_nodes / create_edges) share for their `catalog` redirect.
import { resolveCatalogTarget } from "./catalog-target.js";
import { PARKED_PAYLOAD_NOTE } from "./tool-notes.js";
import { displayName, responseBytes } from "../utils/index.js";

// Read one catalog namespace's published slot as a plain MutationGraph. Empty when
// that namespace has never been seeded (no pointer). Exported for tests.
export async function readCatalog(namespace: string): Promise<MutationGraph> {
  const store = getKgStore();
  const pointer = await store.readPointer(namespace);
  if (!pointer) return { nodes: [], edges: [] };
  const [nodes, edges] = await Promise.all([
    store.listNodes(namespace, pointer.publishedSlot),
    store.listEdges(namespace, pointer.publishedSlot),
  ]);
  const dropSlot = <T extends { slot: unknown }>(x: T): Omit<T, "slot"> => { const { slot, ...rest } = x; return rest; };
  return { nodes: nodes.map((n: StoredNode) => dropSlot(n) as MutationNode), edges: edges.map((e: StoredEdge) => dropSlot(e) as MutationEdge) };
}

// The catalog scopes visible in the active context: the shared library plus the
// active workspace's own (the workspace scope is dropped when the active workspace
// IS the shared one — there is only one library then).
function catalogScopes(): Array<{ scope: CatalogScope; namespace: string }> {
  const scopes: Array<{ scope: CatalogScope; namespace: string }> = [{ scope: "shared", namespace: SHARED_CATALOG_NAMESPACE }];
  const workspaceNs = catalogNamespace(activeWorkspace());
  if (workspaceNs !== SHARED_CATALOG_NAMESPACE) scopes.push({ scope: "workspace", namespace: workspaceNs });
  return scopes;
}

// Surface the id-map at the top level of a dry-run preview so the caller passes it
// back on confirm (mirrors authoring.ts::withMinted, one id → many).
function withMintedMap(result: unknown, mintedIdMap: Record<string, string>): unknown {
  const r = result as { kind?: string; phase?: string };
  if (r && r.kind === "graphMutation" && r.phase === "preview") return { ...(result as object), mintedIdMap };
  return result;
}

// The shared copy-onto-target path behind use_routine and use_formatter: locate the
// entry across both scopes, clone its subtree into the active subject, and attach the
// clone. Two-phase (mints an id-map on dry-run, reuses it on confirm). The two tools
// diverge in the ATTACHMENT, keyed by `mode`:
//   - "routine"   — the clone is copied verbatim and linked to a Lesson via `usesRoutine`;
//   - "formatter" — the clone is relabelled to the document layer (Formatter/
//     FormatterSpec) and hung under the Course's TeachingLearningMaterial via `hasPart`.
// The token-only confirm path reads the mode back from the parked context, so a
// confirm dispatches to the right mutation without the caller re-stating it.
type CatalogApplyMode = "routine" | "formatter" | "rubric";
type ApplyArgs = { entryId?: string; targetId?: string; mintedIdMap?: Record<string, string>; confirm?: boolean; confirmationToken?: string };
// The wrapper's parked context for a use_routine / use_formatter confirm: the mode,
// the cloned subtree's mutation args the dry-run built, plus the id-map to surface in
// the response. Discriminated by `mode` so the confirm runs the matching mutation.
type ParkedApplyContext =
  | { mode: "routine"; mutationArgs: UseRoutineArgs; idMap: Record<string, string> }
  | { mode: "formatter"; mutationArgs: UseFormatterArgs; idMap: Record<string, string> }
  | { mode: "rubric"; mutationArgs: UseRubricArgs; idMap: Record<string, string> };

// Resolve the TeachingLearningMaterial a formatter or rubric attaches under, from the
// id the caller gave. A TLM id is used directly; a Course id resolves to the TLM that
// `covers` it (the document produced from that Course). Reads the active graph
// DRAFT-first so a just-authored TLM resolves. Any other node — or a Course with no
// TLM yet — is an actionable error: both are properties of the DOCUMENT
// (TLM ─hasPart→ Formatter/Rubric), never of the curriculum. `tool`/`noun` name the
// calling verb so the message reads as its own.
export async function resolveDocumentTarget(namespace: string, targetId: string, tool: string, noun: string): Promise<{ tlmId: string } | { error: string }> {
  const graph = await readActiveGraph(namespace);
  const target = graph.nodes.find((n) => n.id === targetId);
  if (!target) return { error: `Target '${targetId}' does not exist in the active graph.` };
  const labels = target.labels ?? [];
  if (labels.includes("TeachingLearningMaterial")) return { tlmId: targetId };
  if (labels.includes("Course")) {
    const tlmId = graph.nodes.find(
      (n) => (n.labels ?? []).includes("TeachingLearningMaterial") && graph.edges.some((e) => e.type === "covers" && e.from === n.id && e.to === targetId),
    )?.id;
    if (tlmId) return { tlmId };
    return { error: `Course '${targetId}' has no TeachingLearningMaterial covering it yet. A ${noun} attaches under the DOCUMENT, not the Course — mint a TeachingLearningMaterial that \`covers\` this Course (add_nodes + create_edges), then ${tool} against the Course or the TLM directly.` };
  }
  return { error: `'${targetId}' is a ${labels.join("/") || "node"} — ${tool} targets a TeachingLearningMaterial (the document), or a Course to resolve its TLM.` };
}

// Shared tail for a dry-run / confirm: on a dry-run park the built context (so a large
// clone can be confirmed token-only) and surface the id-map; on a confirm return the
// mutation result verbatim. `idMap` and the parked context differ per mode.
async function finishApply(namespace: string, result: Awaited<ReturnType<typeof runGraphMutation>>, idMap: Record<string, string>, confirm: boolean | undefined, parked: ParkedApplyContext) {
  let payloadStored = false;
  if (!confirm && result.phase === "preview") {
    payloadStored = await parkWrapperContext<ParkedApplyContext>(namespace, result.confirmationToken, parked);
  }
  if (confirm) return asJson(result);
  const preview = withMintedMap(result, idMap) as Record<string, unknown>;
  return asJson({ ...preview, payloadStored });
}

// Run the mutation matching a parked confirm's mode. ParkedApplyContext is
// discriminated by `mode`, so each branch's mutationArgs type is the matching one.
async function confirmParkedApply(namespace: string, parked: ParkedApplyContext, token: string | undefined) {
  if (parked.mode === "formatter") {
    return runGraphMutation({ namespace, mutation: useFormatter, args: parked.mutationArgs, confirm: true, token });
  }
  if (parked.mode === "rubric") {
    return runGraphMutation({ namespace, mutation: useRubric, args: parked.mutationArgs, confirm: true, token });
  }
  return runGraphMutation({ namespace, mutation: useRoutine, args: parked.mutationArgs, confirm: true, token });
}

export async function applyCatalogEntry(a: ApplyArgs, mode: CatalogApplyMode = "routine") {
  const adapter = getActiveAdapter();
  const namespace = kgNamespace(activeWorkspace(), adapter.grade, adapter.subject);

  // Token-only confirm shortcut: caller sends confirm+token with no entryId /
  // targetId / mintedIdMap. Read back the cloned subtree the dry-run parked and
  // apply that verbatim — the args-hash still matches because they are the exact
  // args the token was minted from. The parked mode picks the mutation.
  if (a.confirm && !a.entryId) {
    const parked = a.confirmationToken ? await readWrapperContext<ParkedApplyContext>(namespace, a.confirmationToken) : null;
    if (!parked) return asJson({ phase: "apply", ok: false, reason: "stale", message: "The previewed catalog application has expired or was already used; re-run without confirm to preview again." });
    const result = await confirmParkedApply(namespace, parked, a.confirmationToken);
    if (result.phase === "apply" && result.ok && a.confirmationToken) await deleteWrapperContext(namespace, a.confirmationToken);
    return asJson(result);
  }

  if (!a.entryId || !a.targetId) return asJson({ error: "entryId and targetId are required on a dry-run." });

  const catalogs = await Promise.all(catalogScopes().map((s) => readCatalog(s.namespace)));
  const source = catalogs.find((graph) => graph.nodes.some((n) => n.id === a.entryId));
  if (!source) return asJson({ error: `Catalog entry '${a.entryId}' not found in the shared or workspace library. Call list_catalog for entry ids.` });

  const mint = a.confirm ? (oldId: string) => (a.mintedIdMap ?? {})[oldId] : () => mintNodeId();

  if (mode === "formatter") {
    // A formatter hangs under the document (TLM), not the Course — resolve the TLM
    // first, then relabel the clone to the Formatter/FormatterSpec document shape.
    const resolved = await resolveDocumentTarget(namespace, a.targetId, "use_formatter", "formatter");
    if ("error" in resolved) return asJson({ error: resolved.error });
    const clone = relabelClonedFormatter(cloneRoutineSubtree(source, a.entryId, namespace, mint)!);
    const mutationArgs: UseFormatterArgs = { namespace, tlmId: resolved.tlmId, clonedNodes: clone.nodes, clonedEdges: clone.edges, newFormatterId: clone.newEntryId };
    const result = await runGraphMutation({ namespace, mutation: useFormatter, args: mutationArgs, confirm: a.confirm, token: a.confirmationToken });
    return finishApply(namespace, result, clone.idMap, a.confirm, { mode: "formatter", mutationArgs, idMap: clone.idMap });
  }

  if (mode === "rubric") {
    // Same attachment point as a formatter (the document, via hasPart) — a grid judges
    // the DOCUMENT — but relabelled one level deeper: Rubric → RubricSection → RubricCriterion.
    const resolved = await resolveDocumentTarget(namespace, a.targetId, "use_rubric", "rubric");
    if ("error" in resolved) return asJson({ error: resolved.error });
    const clone = relabelClonedRubric(cloneRoutineSubtree(source, a.entryId, namespace, mint)!);
    const mutationArgs: UseRubricArgs = { namespace, tlmId: resolved.tlmId, clonedNodes: clone.nodes, clonedEdges: clone.edges, newRubricId: clone.newEntryId };
    const result = await runGraphMutation({ namespace, mutation: useRubric, args: mutationArgs, confirm: a.confirm, token: a.confirmationToken });
    return finishApply(namespace, result, clone.idMap, a.confirm, { mode: "rubric", mutationArgs, idMap: clone.idMap });
  }

  const clone = cloneRoutineSubtree(source, a.entryId, namespace, mint)!;
  const mutationArgs: UseRoutineArgs = { namespace, targetId: a.targetId, clonedNodes: clone.nodes, clonedEdges: clone.edges, newEntryId: clone.newEntryId };
  const result = await runGraphMutation({ namespace, mutation: useRoutine, args: mutationArgs, confirm: a.confirm, token: a.confirmationToken });
  return finishApply(namespace, result, clone.idMap, a.confirm, { mode: "routine", mutationArgs, idMap: clone.idMap });
}

// ── add_to_catalog: file an authored routine/formatter INTO a catalog ─────────
// The write inverse of use_routine. use_routine copies a library entry OUT onto a
// lesson; this copies one IN — a routine/formatter subtree authored in the active
// subject graph, cloned (fresh ids) into a catalog library and PUBLISHED in one
// gated step (catalogs aren't enterable contexts, so there is no separate
// publish_draft for them). Destination rights ride the catalog's namespace: the
// shared library (_shared) needs super_admin; a workspace library that tenant's curators.

// Read a namespace's current graph, preferring its DRAFT slot so a just-authored
// (still-unpublished) routine is visible — the natural flow is author inline (a
// draft edit) then add it to the catalog. Falls back to published; empty when unseeded.
export async function readActiveGraphWithSlot(namespace: string): Promise<{ graph: MutationGraph; reading: "draft" | "published" }> {
  const store = getKgStore();
  const pointer = await store.readPointer(namespace);
  if (!pointer) return { graph: { nodes: [], edges: [] }, reading: "published" };
  const slot = pointer.draftSlot ?? pointer.publishedSlot;
  const [nodes, edges] = await Promise.all([store.listNodes(namespace, slot), store.listEdges(namespace, slot)]);
  const dropSlot = <T extends { slot: unknown }>(x: T): Omit<T, "slot"> => { const { slot: _s, ...rest } = x; return rest; };
  return {
    graph: { nodes: nodes.map((n: StoredNode) => dropSlot(n) as MutationNode), edges: edges.map((e: StoredEdge) => dropSlot(e) as MutationEdge) },
    reading: pointer.draftSlot ? "draft" : "published",
  };
}

async function readActiveGraph(namespace: string): Promise<MutationGraph> {
  return (await readActiveGraphWithSlot(namespace)).graph;
}

// Tag a dry-run preview so the caller knows confirming PUBLISHES the library live
// (not merely stages a draft, as the graph tools do) and where it lands.
function withCatalogPublishNote(result: unknown, target: { scope: CatalogScope; workspace: string; namespace: string }): unknown {
  const r = result as { phase?: string };
  if (!r || r.phase !== "preview") return result;
  return {
    ...(result as object),
    publishesOnConfirm: true,
    destination: { scope: target.scope, workspace: target.workspace, namespace: target.namespace },
    note: `Confirming does NOT just stage a draft — it PUBLISHES this entry live into the ${target.scope} catalog ('${target.namespace}') in one step. Confirm the destination with the user before proceeding.`,
  };
}

type AddToCatalogArgs = {
  entryId?: string;
  targetWorkspace?: string;
  mintedIdMap?: Record<string, string>;
  confirm?: boolean;
  confirmationToken?: string;
};

// Parked context for a token-only add_to_catalog confirm. The whole apply-and-
// publish sequence needs to run against the catalog namespace, not the active
// subject — so we park that namespace + the target metadata alongside the
// mutation args, and reconstruct the response's `scope/workspace/namespace/entryId`
// without touching activeWorkspace() (which may have moved).
type ParkedAddToCatalogContext = {
  target: { scope: CatalogScope; workspace: string; namespace: string };
  mutationArgs: { namespace: string; clonedNodes: MutationNode[]; clonedEdges: MutationEdge[]; newEntryId: string };
  idMap: Record<string, string>;
};

// Where a catalog copy READS its entry from — the one thing add_to_catalog and
// duplicate_entry disagree about. add_to_catalog sources the active subject graph
// (an entry authored inline); duplicate_entry sources the libraries themselves.
type CatalogCopySource = {
  read: () => Promise<MutationGraph>;
  missing: (entryId: string) => string;
};

// The active subject's graph, draft-first — where an inline-authored entry lives.
const subjectSource = (): CatalogCopySource => ({
  read: () => {
    const adapter = getActiveAdapter();
    return readActiveGraph(kgNamespace(activeWorkspace(), adapter.grade, adapter.subject));
  },
  missing: (entryId) => `Entry '${entryId}' was not found in the active graph. Author it first (add_nodes: an InstructionalRoutine + its steps), then add it to the catalog.`,
});

// Both libraries at once — an entry id is unique across them, so duplicate_entry
// can copy a shared master without the caller saying where it lives.
const librarySource = (): CatalogCopySource => ({
  read: async () => {
    const graphs = await Promise.all(catalogScopes().map((scope) => readCatalog(scope.namespace)));
    return { nodes: graphs.flatMap((g) => g.nodes), edges: graphs.flatMap((g) => g.edges) };
  },
  missing: (entryId) => `Catalog entry '${entryId}' was not found in the shared or workspace library. Call list_catalog for entry ids.`,
});

// The entry's display name — line 1 of the field list_catalog reads
// (raw.description), since a routine's whole authored text lives there.
const entryName = (node: MutationNode | undefined): string =>
  typeof (node?.properties?.raw as Record<string, unknown> | undefined)?.description === "string"
    ? displayName(String((node!.properties.raw as Record<string, unknown>).description))
    : "";

// Rename a cloned entry's ROOT node in place. Only the root is renamed: the steps
// and specs under it keep their own names, which is what "copy and edit" means.
function renameClonedEntry(nodes: MutationNode[], entryId: string, name: string): MutationNode[] {
  return nodes.map((node) => {
    if (node.id !== entryId) return node;
    const raw = { ...((node.properties?.raw as Record<string, unknown>) ?? {}), description: name };
    return { ...node, properties: { ...(node.properties ?? {}), raw } };
  });
}

type CatalogCopyArgs = AddToCatalogArgs & {
  source: CatalogCopySource;
  /** Given the original's name, the name the copy should carry. Absent = keep it. */
  rename?: (originalName: string) => string;
};

// Exported so tests drive the real logic (like runAddNodes / runPublishDraft).
// Returns the raw result record; the tool registration wraps it in asJson.
export async function runAddToCatalog(a: AddToCatalogArgs): Promise<Record<string, unknown>> {
  return copyIntoCatalog({ ...a, source: subjectSource() });
}

// Duplicate a LIBRARY entry: the same clone-and-publish path, reading from the
// libraries instead of the subject. Nobody authors a formatter from a blank page
// — copy-then-edit is the real mental model (self-serve-authoring.md, phase 3).
export async function runDuplicateEntry(a: AddToCatalogArgs & { name?: string }): Promise<Record<string, unknown>> {
  return copyIntoCatalog({
    ...a,
    source: librarySource(),
    rename: (original) => a.name ?? `${original} (copie)`,
  });
}

async function copyIntoCatalog(a: CatalogCopyArgs): Promise<Record<string, unknown>> {
  // Token-only confirm shortcut: caller sends confirm+token with no entryId /
  // targetWorkspace / mintedIdMap. Read back the parked context and run the
  // apply-and-publish against the SAME catalog namespace it was previewed against.
  if (a.confirm && !a.entryId) {
    // We don't know the catalog namespace until we read the parked entry, but
    // wrapper-park is keyed by (namespace, nonce). We keyed the dry-run park by
    // the CATALOG namespace, so probe both possible catalog namespaces (the
    // shared library and the active workspace's) — whichever holds the entry.
    const candidateNss = catalogScopes().map((s) => s.namespace);
    let parked: ParkedAddToCatalogContext | null = null;
    for (const ns of candidateNss) {
      parked = a.confirmationToken ? await readWrapperContext<ParkedAddToCatalogContext>(ns, a.confirmationToken) : null;
      if (parked) break;
    }
    if (!parked) return { phase: "apply", ok: false, reason: "stale", message: "The previewed catalog copy has expired or was already used; re-run without confirm to preview again." };

    const catalogNs = parked.target.namespace;
    const applied = await runGraphMutation({ namespace: catalogNs, mutation: addCatalogEntry, args: parked.mutationArgs, confirm: true, token: a.confirmationToken });
    if (applied.phase !== "apply" || !(applied as { ok?: boolean }).ok) return applied as unknown as Record<string, unknown>;
    const published = await publishDraft(catalogNs);
    if (!published.ok) {
      await discardDraft(catalogNs).catch(() => undefined);
      return { error: `Entry staged but publishing the ${parked.target.scope} catalog was refused: ${published.reason}. The catalog draft was rolled back — nothing changed.` };
    }
    if (a.confirmationToken) await deleteWrapperContext(catalogNs, a.confirmationToken);
    return { ok: true, published: true, scope: parked.target.scope, workspace: parked.target.workspace, namespace: catalogNs, entryId: parked.mutationArgs.newEntryId, auditId: published.auditId };
  }

  const target = await resolveCatalogTarget(a.targetWorkspace);
  if (target.kind === "error") return { error: target.message };
  if (target.kind === "choose") {
    return {
      needsChoice: true,
      message: "You are a super admin — choose which catalog to add this entry to, then call add_to_catalog again with `targetWorkspace` set to one of the `target` values below.",
      choices: target.choices,
    };
  }

  const catalogNs = target.namespace;
  // The catalog must already exist (a root container to file under). Bootstrapping a
  // brand-new library is a seed-time job (scripts/seed-catalog.mjs), not this tool's.
  const pointer = await getKgStore().readPointer(catalogNs);
  if (!pointer) return { error: `The ${target.scope} catalog ('${catalogNs}') has not been seeded yet — seed it before adding entries.` };

  if (!a.entryId) return { error: "entryId is required on a dry-run." };

  const source = await a.source.read();

  // Clone its subtree into the catalog with fresh ids (stable across dry-run/confirm
  // via the echoed id-map), exactly like use_routine's copy — but toward the library.
  const mint = a.confirm ? (oldId: string) => (a.mintedIdMap ?? {})[oldId] : () => mintNodeId();
  const cloned = cloneRoutineSubtree(source, a.entryId, catalogNs, mint);
  if (!cloned) return { error: a.source.missing(a.entryId) };
  // A source that is ALREADY a document-layer copy (a Formatter or Rubric applied by
  // use_formatter / use_rubric) is relabelled back to catalog shape on the way in —
  // otherwise list_catalog would skip it. A routine passes through untouched.
  const clone = relabelForCatalog(cloned);
  const nodes = a.rename
    ? renameClonedEntry(clone.nodes, clone.newEntryId, a.rename(entryName(source.nodes.find((n) => n.id === a.entryId))))
    : clone.nodes;

  const mutationArgs = { namespace: catalogNs, clonedNodes: nodes, clonedEdges: clone.edges, newEntryId: clone.newEntryId };

  // Dry-run: stage nothing; return the diff + the id-map to echo back + the publish note.
  if (!a.confirm) {
    const preview = await runGraphMutation({ namespace: catalogNs, mutation: addCatalogEntry, args: mutationArgs });
    let payloadStored = false;
    if (preview.phase === "preview") {
      payloadStored = await parkWrapperContext<ParkedAddToCatalogContext>(catalogNs, preview.confirmationToken, {
        target: { scope: target.scope, workspace: target.workspace, namespace: target.namespace },
        mutationArgs, idMap: clone.idMap,
      });
    }
    const shaped = withCatalogPublishNote(withMintedMap(preview, clone.idMap), target) as Record<string, unknown>;
    return { ...shaped, payloadStored };
  }

  // Confirm: apply to the catalog's draft…
  const applied = await runGraphMutation({ namespace: catalogNs, mutation: addCatalogEntry, args: mutationArgs, confirm: true, token: a.confirmationToken });
  if (applied.phase !== "apply" || !(applied as { ok?: boolean }).ok) return applied as unknown as Record<string, unknown>; // blocked / unauthorized / failed — nothing to publish

  // …then PUBLISH it live, one gated step. If publish is refused (e.g. strict
  // separation-of-duties), roll the draft back so nothing is stranded in a
  // namespace the curator can't enter to finish or discard.
  const published = await publishDraft(catalogNs);
  if (!published.ok) {
    await discardDraft(catalogNs).catch(() => undefined);
    return { error: `Entry staged but publishing the ${target.scope} catalog was refused: ${published.reason}. The catalog draft was rolled back — nothing changed.` };
  }
  if (a.confirmationToken) await deleteWrapperContext(catalogNs, a.confirmationToken);
  return { ok: true, published: true, scope: target.scope, workspace: target.workspace, namespace: catalogNs, entryId: clone.newEntryId, auditId: published.auditId };
}

// ── list_catalog: filters, paging and the response projection (WP2a) ──────────
// The whole catalog rendered in full is 63,125 characters on the live senegal
// library — 26 entries, most of the weight being each entry's `summary` (up to
// 3.4 KB on one) and its per-step detail. That is a payload no caller can
// afford, so browsing DEFAULTS to names and detail is asked for.

export type CatalogDetail = "names" | "full";

export type ListCatalogArgs = {
  kind?: CatalogKind;
  scope?: CatalogScope;
  detail?: CatalogDetail;
  limit?: number;
  cursor?: string;
};

// One entry as `detail:'names'` renders it: enough to CHOOSE an entry (and to
// pass its id to use_routine / get_catalog_entry), nothing more. Measured at
// ~4.8 KB for all 26 live entries, against 63 KB for the same list in full.
type CatalogEntryName = {
  id: string;
  name: string;
  kind: CatalogKind;
  scope: CatalogScope;
  stepCount: number;
  materialCount: number;
};

const namesOnly = (entry: CatalogEntry): CatalogEntryName => ({
  id: entry.id,
  name: entry.name,
  kind: entry.kind,
  scope: entry.scope,
  stepCount: entry.steps.length,
  materialCount: entry.materialCount,
});

const DEFAULT_CATALOG_LIMIT = 50;
const MAX_CATALOG_LIMIT = 200;

// A page's byte budget, well under the 100 KB response cap so the envelope and
// the scope list always fit. `detail:'full'` entries average ~2.5 KB, so a page
// of them reaches this long before it reaches `limit` — the page is trimmed and
// says so, the way walk_graph reports `truncatedBySize`.
const CATALOG_PAGE_MAX_BYTES = 60 * 1024;

// Stable total order, so a cursor means the same thing on the next call: scope,
// then kind, then name, with the id as the final tie-break.
function compareEntries(left: CatalogEntry, right: CatalogEntry): number {
  return left.scope.localeCompare(right.scope)
    || left.kind.localeCompare(right.kind)
    || left.name.localeCompare(right.name)
    || left.id.localeCompare(right.id);
}

// The cursor is the id of the last entry served — opaque to the caller, and
// resilient to an entry being added or removed between pages (paging resumes
// after that id in the sort order, rather than at a positional offset).
const encodeCursor = (afterId: string): string => Buffer.from(JSON.stringify({ after: afterId }), "utf8").toString("base64url");

function decodeCursor(cursor: string): string | null {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { after?: unknown };
    return typeof decoded.after === "string" ? decoded.after : null;
  } catch {
    return null;
  }
}

// Take entries until either `limit` or the byte budget is reached. Returns what
// fits plus whether the BUDGET (not the limit) is what stopped it — the two need
// different advice: a limit is raised, a byte overflow is narrowed.
function takeWithinBudget<T>(entries: T[], limit: number): { page: T[]; trimmedBySize: boolean } {
  const page: T[] = [];
  for (const entry of entries.slice(0, limit)) {
    const withEntry = [...page, entry];
    if (page.length > 0 && responseBytes(withEntry) > CATALOG_PAGE_MAX_BYTES) {
      return { page, trimmedBySize: true };
    }
    page.push(entry);
  }
  return { page, trimmedBySize: false };
}

// The core behind list_catalog, exported so tests drive the real logic (the same
// shape buildCapabilitiesReport and findActiveNodes use).
export async function listCatalog(args: ListCatalogArgs = {}): Promise<Record<string, unknown>> {
  const detail = args.detail ?? "names";
  const limit = Math.min(MAX_CATALOG_LIMIT, Math.max(1, Math.trunc(args.limit ?? DEFAULT_CATALOG_LIMIT)));

  // Read only the scope(s) asked for — a `scope` filter should not pay for the
  // other library's read.
  const scopes = catalogScopes().filter((candidate) => !args.scope || candidate.scope === args.scope);
  const perScope = await Promise.all(scopes.map(async (s) => listCatalogEntries(await readCatalog(s.namespace), s.scope)));

  const matching = perScope.flat()
    .filter((entry) => !args.kind || entry.kind === args.kind)
    .sort(compareEntries);

  // Resume after the cursor's entry. An unknown or malformed cursor starts from
  // the beginning rather than erroring — a stale cursor should re-list, not fail.
  const afterId = args.cursor ? decodeCursor(args.cursor) : null;
  const startIndex = afterId ? matching.findIndex((entry) => entry.id === afterId) + 1 : 0;
  const remaining = matching.slice(startIndex);

  const projected: Array<CatalogEntry | CatalogEntryName> = detail === "full" ? remaining : remaining.map(namesOnly);
  const { page, trimmedBySize } = takeWithinBudget(projected, limit);

  const lastOnPage = page[page.length - 1];
  const hasMore = page.length < remaining.length;

  return {
    scopes: scopes.map((s) => ({ scope: s.scope, namespace: s.namespace })),
    detail,
    entries: page,
    count: page.length,
    total: matching.length,
    nextCursor: hasMore && lastOnPage ? encodeCursor(lastOnPage.id) : null,
    ...(trimmedBySize
      ? { truncatedBySize: true, hint: "This page was trimmed to fit a byte budget, so it holds fewer entries than `limit` — raising `limit` will not help. Filter by `kind`/`scope`, or use the default detail:'names', then page with cursor:<nextCursor>." }
      : {}),
    ...(detail === "names"
      ? { note: "Names only — id, name, kind, scope and counts, which is what choosing an entry needs. For one entry's full authored spec (and the NODE IDS to edit it) call get_catalog_entry; for the whole list in full pass detail:'full', which is large." }
      : {}),
  };
}

// Shared confirm-gate + copy input, declared on both apply tools.
// `entryId` / `targetId` are required on dry-run; on a token-only confirm (large
// clone held server-side) they are omitted alongside `mintedIdMap`.
const APPLY_INPUT = {
  entryId: z.string().optional(),
  targetId: z.string().optional(),
  mintedIdMap: z.record(z.string(), z.string()).optional(),   // required on re-send confirm
  confirm: z.boolean().optional(),
  confirmationToken: z.string().optional(),
};

export function registerCatalogTools(server: McpServer) {
  server.registerTool(
    "list_catalog",
    {
      title: "List the catalog",
      description:
        "Browse the reusable-spec catalog — the instructional routines, formatters and evaluation rubrics a curator applies to content. Reads the shared cross-tenant library and the active workspace's own, each entry tagged `scope` (shared | workspace) and `kind` (routine | formatter | rubric). " +
        "`detail` defaults to 'names' — id, name, kind, scope, stepCount, materialCount — which is what CHOOSING an entry needs; 'full' adds each entry's summary, ordered steps (name + timing) and materials, and is large (63 KB for the live library, so filter or page it). " +
        "Narrow with `kind` and `scope`; page with `limit` (default 50, max 200) + `cursor` until `nextCursor` is null. " +
        "Pass a routine's id to use_routine, a formatter's to use_formatter, a rubric's to use_rubric. For ONE entry's full authored spec — and the NODE IDS to edit it — call get_catalog_entry: a catalog cannot be traversed (walk_graph reads the active subject only), so those two tools are the only place an entry's ids appear. A RUBRIC's `steps` are its weighted sections (`weight`, criteria in `materials`); a FORMATTER's spec lives in its `materials`; a ROUTINE has no materials — each step carries its text in `description`, so `steps[i].id` is the editable id. [] when nothing is seeded.",
      inputSchema: {
        kind: z.enum(["routine", "formatter", "rubric"]).optional(),
        scope: z.enum(["shared", "workspace"]).optional(),
        detail: z.enum(["names", "full"]).optional(),
        limit: z.number().int().optional(),
        cursor: z.string().optional(),
      },
    },
    guarded(async (a: ListCatalogArgs) => asJson(await listCatalog(a))),
  );

  server.registerTool(
    "get_catalog_entry",
    {
      title: "Read a catalog entry",
      description: "Read ONE catalog entry's FULL authored spec, as markdown: a routine's ordered, timed steps with each step's script (a routine keeps its summary and every step's text inline in `description`, not in Materials); a formatter's spec Material; a rubric's scale plus its weighted sections and their named criteria (each with its measurable indicator). This is the detail list_catalog only COUNTS (materialCount) — the same content the `catalog://` browse resource serves, exposed as a TOOL so it works in every client (not only those with a resource browser). Pass the entry `id` from list_catalog; both libraries (shared + workspace) are searched. Each block of authored text is preceded by the NODE ID holding it (`edit_nodes nodeId: ...`), so a spec you find wrong here can be corrected straight away with edit_nodes(items:[{nodeId, content}], catalog) — and several wrong blocks in ONE call — a catalog is not walkable, so this is where content and its id appear together. Read-only.",
      inputSchema: { id: z.string() },
    },
    guarded(async (a: { id: string }) => {
      for (const s of catalogScopes()) {
        const markdown = renderCatalogEntry(await readCatalog(s.namespace), a.id, s.scope);
        // The entry's authored spec IS markdown — return it tagged text/markdown
        // (labelled by scope + id) so it renders, not as an escaped JSON string.
        if (markdown) return asMarkdown(`catalog://${s.scope}/${a.id}`, markdown);
      }
      return asJson({ error: `Catalog entry '${a.id}' not found in the shared or workspace library. Call list_catalog for entry ids.` });
    }),
  );

  server.registerTool(
    "use_routine",
    {
      title: "Use a catalog routine",
      description: "Apply a catalog ROUTINE to a lesson by COPYING it. The entry (from the shared OR the workspace library) is cloned with fresh ids into the active subject and linked to `targetId` (a Lesson) via `usesRoutine`. The copy is independent — later edits to the library entry do not reach it. REQUIRES CONFIRMATION: dry-run returns diff + confirmationToken + mintedIdMap. " + PARKED_PAYLOAD_NOTE + " DRAFT edit — publish_draft to make it live.",
      inputSchema: APPLY_INPUT,
    },
    guarded(async (a: ApplyArgs) => applyCatalogEntry(a, "routine")),
  );

  server.registerTool(
    "use_formatter",
    {
      title: "Use a catalog formatter",
      description: "Apply a catalog FORMATTER (a house-style spec) to a DOCUMENT by COPYING it. `targetId` is a TeachingLearningMaterial (the document node), OR a Course — in which case the TLM that `covers` that Course is resolved for you. The entry (from the shared OR the workspace library) is cloned with fresh ids into the active subject, RELABELLED to the document layer (Formatter + FormatterSpec), and hung under the TLM via `hasPart`, so generating that document applies the style. Formatting is a property of the document, not the curriculum — it never rides a Course's usesRoutine edge. (If a Course has no document yet, create one with create_document — it mints the TeachingLearningMaterial AND its `covers` edge in one atomic call, so the document cannot end up covering nothing.) The copy is independent — later edits to the library formatter do not reach it. REQUIRES CONFIRMATION: dry-run returns diff + confirmationToken + mintedIdMap. " + PARKED_PAYLOAD_NOTE + " DRAFT edit — publish_draft to make it live.",
      inputSchema: APPLY_INPUT,
    },
    guarded(async (a: ApplyArgs) => applyCatalogEntry(a, "formatter")),
  );

  server.registerTool(
    "use_rubric",
    {
      title: "Use a catalog rubric",
      description: "Apply a catalog RUBRIC (an evaluation grid — Annexe 8's approval checklist, Annexe 7's scored grid) to a DOCUMENT by COPYING it, so `evaluate_document` knows which grid governs it. `targetId` is a TeachingLearningMaterial, or a Course (its covering TLM is resolved for you; if it has none, create_document mints the TLM and its `covers` edge atomically). The entry is cloned with fresh ids into the active subject, RELABELLED to Rubric → RubricSection → RubricCriterion, and hung under the TLM via `hasPart` — a grid judges the DOCUMENT, so it attaches where a formatter does, never to the curriculum. A document may carry SEVERAL rubrics and evaluate_document reports every one. The copy is independent of the library. REQUIRES CONFIRMATION: dry-run returns diff + confirmationToken + mintedIdMap. " + PARKED_PAYLOAD_NOTE + " DRAFT edit — publish_draft to make it live.",
      inputSchema: APPLY_INPUT,
    },
    guarded(async (a: ApplyArgs) => applyCatalogEntry(a, "rubric")),
  );

  server.registerTool(
    "add_to_catalog",
    {
      title: "Add a routine or formatter to the catalog",
      description: "File a routine, formatter or rubric you AUTHORED in the active subject INTO a catalog library, so list_catalog / use_routine / use_formatter / use_rubric can reuse it — the write inverse of use_routine. It clones the entry's whole subtree with fresh ids under the destination library's root. " +
        "Use it for an entry that ALREADY exists in a subject graph (authored inline, or applied by use_routine and improved since). For a NEW entry, prefer add_nodes with `catalog:'workspace'`, which writes straight into the library — building it in the subject and cloning here strands a half-built entry if the session is interrupted. To start from an entry already in a library, use duplicate_entry. " +
        "DESTINATION: a curator files into their OWN workspace's library (omit targetWorkspace); a super_admin may pass `targetWorkspace` ('_shared' or a workspace id), or call without it to be offered the list. Because it PUBLISHES it needs an APPROVER there (super_admin for the shared library). TWO-PHASE, and confirming applies AND publishes in one step — catalogs are not enterable, so there is no publish_draft. The dry-run returns the diff + confirmationToken + mintedIdMap. " + PARKED_PAYLOAD_NOTE,
      inputSchema: {
        entryId: z.string().optional(),   // required on dry-run; omitted on token-only confirm
        targetWorkspace: z.string().optional(),
        mintedIdMap: z.record(z.string(), z.string()).optional(),   // required on re-send confirm
        confirm: z.boolean().optional(),
        confirmationToken: z.string().optional(),
      },
    },
    guarded(async (a: AddToCatalogArgs) => asJson(await runAddToCatalog(a))),
  );

  server.registerTool(
    "duplicate_entry",
    {
      title: "Duplicate a catalog entry",
      description:
        "COPY an existing catalog entry into a library as a NEW entry with fresh ids, editable without touching the original. This is how a house style is adapted: nobody authors a formatter from a blank page — start from the one that is nearly right. " +
        "`entryId` comes from list_catalog (both libraries are searched). ALWAYS give `name` (default: the original + « (copie) »): two identically-named entries cannot be told apart later. DESTINATION works like add_to_catalog — a curator's copy lands in their OWN library (omit targetWorkspace), which is what makes duplicating a SHARED master useful, since a curator cannot edit a shared entry in place; a super_admin may pass `targetWorkspace`, or omit it to be offered the list. Because it PUBLISHES it needs an APPROVER there. " +
        "TWO-PHASE: confirm with the token, RE-SENDING the same `entryId`, `name` and `mintedIdMap` — a different or omitted `name` produces a different copy and the token is rejected. " + PARKED_PAYLOAD_NOTE + " Then edit the copy with edit_nodes(items:[{nodeId, content}], catalog).",
      inputSchema: {
        entryId: z.string().optional(),   // required on dry-run; omitted on token-only confirm
        name: z.string().optional(),
        targetWorkspace: z.string().optional(),
        mintedIdMap: z.record(z.string(), z.string()).optional(),   // required on re-send confirm
        confirm: z.boolean().optional(),
        confirmationToken: z.string().optional(),
      },
    },
    guarded(async (a: AddToCatalogArgs & { name?: string }) => asJson(await runDuplicateEntry(a))),
  );
}

// The catalog scopes to browse, tolerant of no active context: the shared library
// is always readable; the workspace library is added only when a context is set
// (resources may be listed before set_context, when activeWorkspace() would throw).
function catalogScopesSafe(): Array<{ scope: CatalogScope; namespace: string }> {
  const scopes: Array<{ scope: CatalogScope; namespace: string }> = [{ scope: "shared", namespace: SHARED_CATALOG_NAMESPACE }];
  try {
    const ws = catalogNamespace(activeWorkspace());
    if (ws !== SHARED_CATALOG_NAMESPACE) scopes.push({ scope: "workspace", namespace: ws });
  } catch { /* no active workspace → shared library only */ }
  return scopes;
}

const firstLine = (s: string): string => { const i = s.indexOf("\n"); return (i === -1 ? s : s.slice(0, i)).trim(); };

// Browse surface (D5): expose each catalog entry as a readable MCP RESOURCE
// (`catalog://{scope}/{id}`), rendered with its FULL authored spec — the step /
// formatter Material content that list_catalog only counts. Resources are
// read-only and ungated (browsing a shared/own library reveals no tenant data);
// applying an entry still goes through the confirm-gated use_routine / use_formatter.
export function registerCatalogResources(server: McpServer) {
  server.registerResource(
    "catalog-entry",
    new ResourceTemplate("catalog://{scope}/{id}", {
      list: async () => {
        const scopes = catalogScopesSafe();
        const perScope = await Promise.all(scopes.map(async (s) => listCatalogEntries(await readCatalog(s.namespace), s.scope)));
        return {
          resources: perScope.flat().map((e) => ({
            uri: `catalog://${e.scope}/${e.id}`,
            name: e.name || e.id,
            title: e.name || e.id,
            mimeType: "text/markdown",
            description: `${e.kind} · ${e.scope} · ${e.steps.length} step(s), ${e.materialCount} material(s)${e.summary ? ` — ${firstLine(e.summary)}` : ""}`,
          })),
        };
      },
    }),
    {
      title: "Catalog entries",
      description: "Reusable instructional routines and formatters (shared + workspace libraries), each rendered with its full authored spec. Browse-only; apply one to content with use_routine (→ a Lesson, via usesRoutine) or use_formatter (→ a document / TeachingLearningMaterial, via hasPart).",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const scope: CatalogScope = String(variables.scope) === "workspace" ? "workspace" : "shared";
      const id = String(variables.id);
      let namespace = SHARED_CATALOG_NAMESPACE;
      if (scope === "workspace") {
        try { namespace = catalogNamespace(activeWorkspace()); }
        catch { return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: "Set a context (set_context) to read a workspace-scoped catalog entry." }] }; }
      }
      const md = renderCatalogEntry(await readCatalog(namespace), id, scope);
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: md ?? `Catalog entry '${id}' not found in the ${scope} library.` }] };
    },
  );
}
