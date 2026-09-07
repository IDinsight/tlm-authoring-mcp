/*
 * Layer: services · module: translation · batch
 *
 * Translate several passages in one call, with the correspondence between input
 * and output enforced HERE rather than by whoever is calling.
 *
 * WHY THIS EXISTS. Translating a numbered list of lines by concatenating them
 * into one passage and splitting the result invites a specific, quiet failure:
 * the model merges two lines, or drops an empty one, and every line after that
 * point is attributed to the wrong original. Nothing in the response reveals it —
 * the text is fluent and the count is plausible. Reported from a real session as
 * "the numbering trap".
 *
 * A caller can avoid it by looping one passage at a time, but that is discipline,
 * and discipline is exactly what fails under load. Taking an ARRAY and returning
 * an array of the same length in the same order makes the correspondence
 * structural: there is no concatenation step in which lines can slide.
 *
 * GROUNDING IS PER ITEM. Each passage gets its own term bank, scanned from its
 * own text. Sharing one bank across the batch would be cheaper and would quietly
 * ground every item on terms drawn from its neighbours — trading the very
 * consistency the glossary exists to provide for throughput.
 */
import { translate, type TranslateDirection, type TranslateResult, type GlossaryTerm } from "./gemini.js";

/** How many passages one call may carry. */
export const MAX_BATCH = 50;

/*
 * How many translations are in flight at once.
 *
 * Sequential would make a 50-item batch unusably slow; unbounded would fire 50
 * simultaneous Gemini requests and earn a rate-limit refusal for the whole
 * batch. Four is slow enough to stay well inside the quota and fast enough that
 * batching is worth doing.
 */
const CONCURRENCY = 4;

/** One passage's outcome. A failure is reported in place, never as a gap. */
export type BatchItem =
  | ({ index: number; text: string; ok: true } & TranslateResult)
  | { index: number; text: string; ok: false; error: string };

export type BatchInput = {
  texts: string[];
  direction?: TranslateDirection;
  /** The term bank for passage `i` — the caller scans its own glossary per item. */
  glossaryFor: (text: string) => GlossaryTerm[];
};

/*
 * Translate every passage, preserving order.
 *
 * A failing item does NOT fail the batch. Refusing all fifty because one tripped
 * a content filter would waste the other forty-nine, and a caller that must
 * retry everything is back to per-item looping. Each item carries its own `ok`,
 * so a partial result is still usable and the failures are named.
 */
export async function translateBatch(input: BatchInput): Promise<BatchItem[]> {
  const results: BatchItem[] = new Array(input.texts.length);
  let next = 0;

  // Each worker claims the next index until they run out — order is preserved by
  // writing into the slot the index names, not by the order they finish in.
  const worker = async (): Promise<void> => {
    for (let i = next++; i < input.texts.length; i = next++) {
      const text = input.texts[i];
      try {
        const result = await translate({ text, direction: input.direction, glossary: input.glossaryFor(text) });
        results[i] = { index: i, text, ok: true, ...result };
      } catch (err) {
        results[i] = { index: i, text, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, input.texts.length) }, worker));
  return results;
}
