/*
 * One document's effective `properties.render`, from its formatter stack.
 *
 * A section does not have a render spec; it has FORMATTERS, and each Formatter
 * is composed of FormatterSpec children that each carry a `render` bag beside
 * their prose. `documentSectionSubgraph` hands back the whole stack — the TLM's
 * document-wide formatters together with the section's own — and a renderer
 * needs one spec.
 *
 * NEAREST WINS, and the merge is DEEP. Both matter:
 *
 *   • Nearest wins because that is what the stack means. A section that
 *     attaches its own formatter is overriding, not restating, and a
 *     document-wide rule it does not mention still applies.
 *
 *   • Deep, because a section overriding one margin must not silently drop the
 *     other three. A shallow merge replaces whole groups, so
 *     `{ page: { marginsCm: { top: 1 } } }` would erase the page size — a
 *     failure that shows up as a Letter-sized sheet, which is a defect this
 *     project has already paid for once.
 *
 * The result is validated, so a stack that merges into something invalid is
 * refused HERE, where the formatter can be named, rather than producing a
 * document nobody can explain.
 */
import { renderSpecSchema, type RenderSpec } from "../kg-recipes/index.js";

/** The shape resolution needs: a node with a raw property bag. */
export type SpecCarrier = {
  id: string;
  properties?: { raw?: Record<string, unknown> | undefined } | undefined;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Deep merge, later wins. Arrays REPLACE rather than concatenate: a formatter
 * that redeclares `language.variants` means those variants and not those plus
 * the ones it was overriding.
 */
function deepMerge(
  base: Record<string, unknown>, over: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const existing = out[key];
    out[key] = isPlainObject(existing) && isPlainObject(value)
      ? deepMerge(existing, value)
      : value;
  }
  return out;
}

export type ResolvedSpec =
  | { ok: true; spec: RenderSpec; from: string[] }
  | { ok: false; errors: string[]; from: string[] };

/**
 * Merge a stack's `render` bags into one spec.
 *
 * `stack` is in application order — document-wide first, the section's own
 * last. Nodes without a `render` bag are skipped rather than treated as empty
 * overrides, so a formatter that is pure prose changes nothing.
 */
export function resolveRenderSpec(stack: SpecCarrier[]): ResolvedSpec {
  const from: string[] = [];
  let merged: Record<string, unknown> = {};

  for (const node of stack) {
    const render = node.properties?.raw?.render;
    if (!isPlainObject(render)) continue;
    merged = deepMerge(merged, render);
    from.push(node.id);
  }

  const result = renderSpecSchema.safeParse(merged);
  if (!result.success) {
    return {
      ok: false,
      from,
      errors: result.error.issues.map((issue) => {
        const path = issue.path.length ? issue.path.join(".") : "(root)";
        return `render.${path}: ${issue.message}`;
      }),
    };
  }
  return { ok: true, spec: result.data, from };
}
