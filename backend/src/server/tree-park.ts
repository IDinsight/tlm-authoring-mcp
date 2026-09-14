/*
 * Module: server · a composed page, kept server-side between calls
 *
 * A teacher sheet's block tree is 20–26 KB, and the loop that produces one —
 * compose, lint, render, measure, fix, render again — used to carry it in full
 * on every call: four or five times a sheet, ~100 KB of retyped JSON, and about
 * a third of the wall clock. Measured on a real session (Leçons 24 and 25).
 *
 * So the server keeps the tree. compose_section, lint_content and
 * render_document each hand back a `treeRef`; the next call names it instead
 * of re-sending the tree, and a correction travels as a PATCH — a few blocks —
 * rather than the whole page. The park is the same pending store the two-phase
 * tools use for their large payloads, so nothing new has to be deployed for it
 * to persist across instances.
 *
 * What a ref is NOT: a document, a draft, or history. It is a convenience with
 * a day's lifetime, scoped to the namespace it was made in, and a ref that
 * resolves to nothing is a refusal that says so — the caller re-sends the
 * tree, and nothing else happens.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getKgStore } from "../kg-store/index.js";
import { validateDocumentTree } from "../render/index.js";

/** A day: a sheet is produced in one sitting, and a ref is not an archive. */
export const TREE_TTL_MS = 24 * 60 * 60 * 1000;

/*
 * Above this the tree is not parked. A tree carrying pictures as inline base64
 * can run to megabytes, and the store's document limit is one; such a tree
 * should be naming its pictures by node or path anyway.
 */
export const MAX_PARKED_BYTES = 900_000;

const REF_PREFIX = "tree_";
const parkKey = (ref: string) => `tree:${ref}`;

export type ParkedTree = { treeRef: string; treeRefExpiresAt: string };

/*
 * Keep a tree for later calls. Returns null, never throws, when the tree is
 * too large to keep — the render itself must not fail over a convenience.
 */
export async function parkTree(namespace: string, tree: unknown): Promise<ParkedTree | null> {
  // Stored as ONE string: a block tree nests arrays in arrays (a table's rows),
  // which Firestore refuses as a field, and a string sidesteps the shape entirely.
  const json = JSON.stringify(tree);
  if (Buffer.byteLength(json, "utf8") > MAX_PARKED_BYTES) return null;

  const ref = REF_PREFIX + randomBytes(12).toString("hex");
  const expiresAt = Date.now() + TREE_TTL_MS;
  await getKgStore().putPending(namespace, parkKey(ref), {
    op: "parkedTree",
    proposedHash: "",   // nothing is re-sent to check against; the record shape needs the field
    payload: { json },
    expiresAt,
  });
  return { treeRef: ref, treeRefExpiresAt: new Date(expiresAt).toISOString() };
}

/** The parked tree, or null when the ref is unknown, expired, or from another namespace. */
export async function readParkedTree(namespace: string, treeRef: string): Promise<unknown | null> {
  if (!treeRef.startsWith(REF_PREFIX)) return null;
  const entry = await getKgStore().readPending(namespace, parkKey(treeRef));
  const json = (entry?.payload as { json?: unknown } | undefined)?.json;
  return typeof json === "string" ? JSON.parse(json) : null;
}

// ── Patches ──────────────────────────────────────────────────────────────────

/*
 * One correction to a tree. `path` names a block the way lint findings and
 * layout problems already do — `blocks[3]`, or inside a table cell,
 * `blocks[1].rows[0][0].blocks[2]`. Ops apply IN ORDER and each sees the tree
 * as the previous ones left it, so two removals count from the top down.
 */
export type TreePatchOp =
  | { op: "replace"; path: string; block?: unknown }
  | { op: "insert-before"; path: string; block?: unknown }
  | { op: "insert-after"; path: string; block?: unknown }
  | { op: "remove"; path: string }
  | { op: "media"; entry: { name: string } & Record<string, unknown> }
  | { op: "remove-media"; name: string };

/*
 * The patch as a tool argument, shared by render_document and lint_content.
 * Loose on the block itself (the tree schema validates the patched result),
 * strict on the op, so a typo in the op name is refused rather than ignored.
 */
export const TREE_PATCH_SCHEMA = z.array(z.discriminatedUnion("op", [
  z.object({ op: z.literal("replace"), path: z.string(), block: z.unknown() }).strict(),
  z.object({ op: z.literal("insert-before"), path: z.string(), block: z.unknown() }).strict(),
  z.object({ op: z.literal("insert-after"), path: z.string(), block: z.unknown() }).strict(),
  z.object({ op: z.literal("remove"), path: z.string() }).strict(),
  z.object({ op: z.literal("media"), entry: z.object({ name: z.string().min(1) }).passthrough() }).strict(),
  z.object({ op: z.literal("remove-media"), name: z.string().min(1) }).strict(),
])).max(200).describe("Corrections applied IN ORDER to the tree named by `treeRef` (or to `document`): `path` is a block path — blocks[3], or blocks[1].rows[0][0].blocks[2] inside a table cell — the same form lint findings use. Each op sees the tree as the previous ones left it.");

type Located = { list: unknown[]; index: number };

const PATH = /^blocks\[(\d+)\]((?:\.rows\[\d+\]\[\d+\]\.blocks\[\d+\])*)$/;
const CELL_STEP = /\.rows\[(\d+)\]\[(\d+)\]\.blocks\[(\d+)\]/g;

/** The array holding the block a path names, and its index there. */
function locate(tree: { blocks: unknown[] }, path: string): Located | string {
  const match = PATH.exec(path);
  if (!match) return `'${path}' is not a block path — expected blocks[i] or blocks[i].rows[r][c].blocks[j]…`;
  let list: unknown[] = tree.blocks;
  let index = Number(match[1]);
  for (const step of match[2].matchAll(CELL_STEP)) {
    const table = list[index] as { kind?: string; rows?: unknown[][] } | undefined;
    if (!table || table.kind !== "table") return `'${path}': the block before .rows[${step[1]}] is not a table`;
    const cell = table.rows?.[Number(step[1])]?.[Number(step[2])] as { blocks?: unknown[] } | undefined;
    if (!cell?.blocks) return `'${path}': no cell at rows[${step[1]}][${step[2]}]`;
    list = cell.blocks;
    index = Number(step[3]);
  }
  if (index > list.length) return `'${path}': index ${index} is past the end (${list.length} blocks there)`;
  return { list, index };
}

/*
 * Apply a patch to a COPY of the tree and validate what comes out, so a patch
 * that produces an invalid page is refused in the renderer's own words rather
 * than half-applied.
 */
export function applyTreePatch(tree: unknown, patch: TreePatchOp[]): { tree: unknown } | { error: string } {
  const copy = JSON.parse(JSON.stringify(tree)) as { blocks: unknown[]; media?: Array<{ name: string }> };
  if (!Array.isArray(copy?.blocks)) return { error: "the parked tree has no `blocks` to patch" };

  for (const [n, op] of patch.entries()) {
    const at = `patch[${n}]`;
    if (op.op === "media") {
      copy.media = [...(copy.media ?? []).filter((entry) => entry.name !== op.entry.name), op.entry];
      continue;
    }
    if (op.op === "remove-media") {
      copy.media = (copy.media ?? []).filter((entry) => entry.name !== op.name);
      continue;
    }
    const located = locate(copy, op.path);
    if (typeof located === "string") return { error: `${at}: ${located}` };
    const { list, index } = located;
    if (op.op !== "remove" && index === list.length && op.op !== "insert-before") {
      return { error: `${at}: '${op.path}' is past the end; use insert-before at that index to append` };
    }
    if (op.op !== "remove" && op.block === undefined) return { error: `${at}: '${op.op}' needs a \`block\`` };
    switch (op.op) {
      case "replace": list.splice(index, 1, op.block); break;
      case "insert-before": list.splice(index, 0, op.block); break;
      case "insert-after": list.splice(index + 1, 0, op.block); break;
      case "remove":
        if (index === list.length) return { error: `${at}: '${op.path}' names no block` };
        list.splice(index, 1);
        break;
    }
  }

  const problems = validateDocumentTree(copy);
  if (problems.length > 0) {
    return { error: `the patched tree is not valid: ${problems.slice(0, 5).join("; ")}${problems.length > 5 ? `; +${problems.length - 5} more` : ""}` };
  }
  return { tree: copy };
}

// ── The one entry point the tools share ──────────────────────────────────────

export type TreeInput = { document?: unknown; treeRef?: string; patch?: TreePatchOp[] };

/*
 * The tree a call means: sent inline, or parked under a ref, then patched.
 *
 * Exactly one of `document` / `treeRef`, because a call carrying both has
 * two candidate pages and no way to say which it meant. A ref that resolves to
 * nothing is a refusal naming the ref, with the only two causes it can have.
 */
export async function resolveTreeInput(namespace: string, input: TreeInput): Promise<{ tree: unknown; from: "document" | "treeRef" } | { error: string }> {
  if (input.document !== undefined && input.treeRef !== undefined) {
    return { error: "Pass `document` OR `treeRef`, not both — they would be two different pages." };
  }
  let tree: unknown;
  let from: "document" | "treeRef";
  if (input.treeRef !== undefined) {
    const parked = await readParkedTree(namespace, input.treeRef);
    if (parked === null) {
      return { error: `No parked tree '${input.treeRef}' in namespace '${namespace}': it expired (a ref lives ${TREE_TTL_MS / 3_600_000} h), or it was made in another namespace. Re-send the tree as \`document\`; the response carries a fresh ref.` };
    }
    tree = parked;
    from = "treeRef";
  } else if (input.document !== undefined) {
    tree = input.document;
    from = "document";
  } else {
    return { error: "Pass the page: `document` (the block tree), or `treeRef` (one a previous call handed back), optionally with `patch`." };
  }

  if (input.patch && input.patch.length > 0) {
    const patched = applyTreePatch(tree, input.patch);
    if ("error" in patched) return { error: `The patch could not be applied: ${patched.error}. Nothing was changed.` };
    tree = patched.tree;
  }
  return { tree, from };
}
