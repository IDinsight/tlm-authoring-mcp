/*
 * The one shape Firestore refuses that our data has: an array inside an array.
 *
 * A table's rows in a page template (`properties.layout`) are a list of lists of
 * cells — the exact shape render_document takes, so a template is a block tree
 * and not a second grammar. Firestore rejects that document outright ("Property
 * properties contains an invalid nested entity"), and the memory store the tests
 * run on does not, so the first import of a template was the first time anyone
 * saw the refusal.
 *
 * The fix lives at the store boundary, nowhere else: on the way in, an array
 * that sits directly inside an array is wrapped in a one-key map; on the way
 * out the map is unwrapped. Nodes, edges, audit records and parked payloads all
 * pass through it, so a template staged live by edit_nodes, its audit diff, and
 * its undo all survive the round trip. Nothing above the store knows.
 */

/** The wrapper's single key. Firestore reserves `__x__` names; `$` is free. */
export const NESTED_ARRAY_KEY = "$array";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);

/** Wrap every array that sits directly inside another array, at any depth. */
export function toFirestoreShape<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((element) => (Array.isArray(element) ? { [NESTED_ARRAY_KEY]: toFirestoreShape(element) } : toFirestoreShape(element))) as unknown as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) out[key] = toFirestoreShape(inner);
    return out as T;
  }
  return value;
}

/** The inverse: a map holding only the wrapper key becomes the array it wrapped. */
export function fromFirestoreShape<T>(value: T): T {
  if (Array.isArray(value)) return value.map(fromFirestoreShape) as unknown as T;
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === NESTED_ARRAY_KEY && Array.isArray(value[NESTED_ARRAY_KEY])) {
      return fromFirestoreShape(value[NESTED_ARRAY_KEY]) as T;
    }
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) out[key] = fromFirestoreShape(inner);
    return out as T;
  }
  return value;
}
