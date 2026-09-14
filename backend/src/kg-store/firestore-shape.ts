/*
 * The two shapes Firestore refuses that our data has: an array inside an
 * array, and a document nested more than twenty levels deep.
 *
 * A table's rows in a page template (`properties.layout`) are a list of lists of
 * cells — the exact shape render_document takes, so a template is a block tree
 * and not a second grammar. Firestore rejects that document outright ("Property
 * properties contains an invalid nested entity"), and the memory store the tests
 * run on does not, so the first import of a template was the first time anyone
 * saw the refusal.
 *
 * The same template then broke the AUDIT of an edit: the apply record embeds
 * the node before and after, five levels under the record's own root, and
 * the fiche template's nested tables reach Firestore's twenty-level limit
 * from there ("Input object is deeper than 20 levels"). The overlay write
 * had already landed, so the draft held an edit with no audit record, no
 * version stamp and nothing for undo_last to replay (2026-09-14).
 *
 * Both fixes live at the store boundary, nowhere else: on the way in, an array
 * that sits directly inside an array is wrapped in a one-key map, and a
 * document that would still be too deep has its deepest subtrees folded into
 * JSON strings; on the way out both are undone. Nodes, edges, audit records
 * and parked payloads all pass through it, so a template staged live by
 * edit_nodes, its audit diff, and its undo all survive the round trip. Nothing
 * above the store knows.
 */

/** The wrapper's single key. Firestore reserves `__x__` names; `$` is free. */
export const NESTED_ARRAY_KEY = "$array";

/** The key of a subtree folded into a JSON string because the document ran too deep. */
export const FOLDED_JSON_KEY = "$json";

/*
 * Firestore's limit is twenty levels of nested maps and arrays. A document is
 * kept as it is while it fits; only one that would be refused is folded, so
 * the stored shape of every node written so far is unchanged. The fold starts
 * well inside the limit because a folded document's OWN depth must fit too.
 */
export const FIRESTORE_MAX_DEPTH = 20;
/** Fold a document deeper than this — two levels of headroom under the limit, since the count here and Firestore's may differ by one. */
const FOLD_WHEN_DEEPER_THAN = 18;
const FOLD_FROM_DEPTH = 10;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);

const isContainer = (value: unknown): boolean => Array.isArray(value) || isPlainObject(value);

/** Wrap every array that sits directly inside another array, at any depth. */
function wrapNestedArrays<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((element) => (Array.isArray(element) ? { [NESTED_ARRAY_KEY]: wrapNestedArrays(element) } : wrapNestedArrays(element))) as unknown as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) out[key] = wrapNestedArrays(inner);
    return out as T;
  }
  return value;
}

/** How many levels of maps and arrays sit below this value — 0 for a scalar or an empty container. */
export function nestingDepth(value: unknown): number {
  if (Array.isArray(value)) return value.length === 0 ? 1 : 1 + Math.max(...value.map(nestingDepth));
  if (isPlainObject(value)) {
    const inner = Object.values(value);
    return inner.length === 0 ? 1 : 1 + Math.max(...inner.map(nestingDepth));
  }
  return 0;
}

/** Every container at or below `FOLD_FROM_DEPTH` becomes a JSON string, so the document fits. */
function foldDeep<T>(value: T, depth: number): T {
  if (!isContainer(value)) return value;
  if (depth >= FOLD_FROM_DEPTH) return { [FOLDED_JSON_KEY]: JSON.stringify(value) } as unknown as T;
  if (Array.isArray(value)) return value.map((element) => foldDeep(element, depth + 1)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) out[key] = foldDeep(inner, depth + 1);
  return out as T;
}

/** The shape Firestore accepts: nested arrays wrapped, and a document over the depth limit folded. */
export function toFirestoreShape<T>(value: T): T {
  const wrapped = wrapNestedArrays(value);
  return nestingDepth(wrapped) > FOLD_WHEN_DEEPER_THAN ? foldDeep(wrapped, 0) : wrapped;
}

/** The inverse: a wrapper map becomes the array it wrapped, a folded map becomes the subtree it held. */
export function fromFirestoreShape<T>(value: T): T {
  if (Array.isArray(value)) return value.map(fromFirestoreShape) as unknown as T;
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === NESTED_ARRAY_KEY && Array.isArray(value[NESTED_ARRAY_KEY])) {
      return fromFirestoreShape(value[NESTED_ARRAY_KEY]) as T;
    }
    if (keys.length === 1 && keys[0] === FOLDED_JSON_KEY && typeof value[FOLDED_JSON_KEY] === "string") {
      // The folded subtree was wrapped before it was folded, so it is unwrapped on the way out too.
      return fromFirestoreShape(JSON.parse(value[FOLDED_JSON_KEY] as string)) as T;
    }
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) out[key] = fromFirestoreShape(inner);
    return out as T;
  }
  return value;
}

/*
 * What the memory store checks on every write the Firestore store would make,
 * so a shape Firestore refuses fails a test instead of a live edit. The memory
 * store never saw the nested-array refusal nor the depth refusal; both reached
 * production first.
 */
export function assertFirestoreStorable(value: unknown, where: string): void {
  const stored = toFirestoreShape(value);
  const depth = nestingDepth(stored);
  if (depth > FIRESTORE_MAX_DEPTH) {
    throw new Error(`${where}: the document would be nested ${depth} levels deep even after folding; Firestore refuses more than ${FIRESTORE_MAX_DEPTH}.`);
  }
  if (hasNestedArray(stored)) throw new Error(`${where}: an array sits directly inside an array, which Firestore refuses.`);
}

function hasNestedArray(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((element) => Array.isArray(element) || hasNestedArray(element));
  if (isPlainObject(value)) return Object.values(value).some(hasNestedArray);
  return false;
}
