/*
 * translateBatch — many passages, correspondence enforced by the server.
 *
 * THE DEFECT this closes, reported from a real session as "the numbering trap".
 * A caller translating a numbered list of lines concatenates them into one
 * passage and splits the answer. The model merges two lines, or drops an empty
 * one, and every line after that point is attributed to the wrong original.
 * Nothing in the response reveals it: the text is fluent and the count is
 * plausible. A caller can avoid this by looping one passage at a time — but that
 * is discipline, and discipline is what fails under load.
 *
 * So the properties under test are structural: an array in, an array of the same
 * length in the same order out, each item grounded in its OWN term bank, and one
 * failure that does not take the other forty-nine with it.
 *
 * Stubbed fetch throughout — the real API is never called.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CONFIG } from "../../config.js";
import { translateBatch } from "../batch.js";
import type { GlossaryTerm } from "../gemini.js";

/*
 * A stub that echoes the passage it was given.
 *
 * Echoing is what makes misalignment VISIBLE: if item i's result does not
 * contain passage i's text, the correspondence broke. A stub returning a
 * constant would pass an out-of-order implementation.
 */
function stubEcho(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { contents: Array<{ parts: Array<{ text: string }> }> };
    const sent = body.contents[0].parts[0].text;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ sourceLanguage: "French", targetLanguage: "Wolof", translation: `wo(${sent})` }) }] } }],
      }),
    };
  });
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

const noGlossary = () => [] as GlossaryTerm[];

describe("translateBatch", () => {
  beforeEach(() => {
    CONFIG.gemini.apiKey = "test-key";
    CONFIG.gemini.model = "gemini-3.6-flash";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    CONFIG.gemini.apiKey = "";
  });

  it("returns one result per passage, in the order they were given", async () => {
    stubEcho();
    // Twenty passages exceeds the concurrency limit, so results genuinely finish
    // out of order — which is the case an index-keyed write has to survive.
    const texts = Array.from({ length: 20 }, (_, i) => `ligne ${i + 1}`);

    const results = await translateBatch({ texts, glossaryFor: noGlossary });

    expect(results).toHaveLength(20);
    results.forEach((item, i) => {
      expect(item.index).toBe(i);
      expect(item.text).toBe(texts[i]);
      // The echo proves this slot holds ITS OWN passage's translation.
      expect(item.ok && item.translation).toBe(`wo(${texts[i]})`);
    });
  });

  it("grounds each passage in its own term bank, not the batch's", async () => {
    const fetchMock = stubEcho();
    // Each passage names a different term; sharing one bank would put both terms
    // in both prompts and quietly ground each item on its neighbour's wording.
    const banks: Record<string, GlossaryTerm[]> = {
      "une droite": [{ francais: "droite", wolof: "rëdd-jub" }],
      "un cercle": [{ francais: "cercle", wolof: "kurel" }],
    };

    await translateBatch({ texts: ["une droite", "un cercle"], glossaryFor: (t) => banks[t] });

    const instructions = fetchMock.mock.calls.map(([, init]) =>
      JSON.parse(String((init as RequestInit).body)).systemInstruction.parts[0].text as string);
    const forDroite = instructions.find((i) => i.includes("droite = rëdd-jub"));
    const forCercle = instructions.find((i) => i.includes("cercle = kurel"));

    expect(forDroite).toBeDefined();
    expect(forCercle).toBeDefined();
    // And no cross-contamination in either direction.
    expect(forDroite).not.toContain("cercle = kurel");
    expect(forCercle).not.toContain("droite = rëdd-jub");
  });

  it("reports a failing passage in place rather than failing the batch", async () => {
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      call += 1;
      if (call === 2) return { ok: false, status: 400, statusText: "Bad Request", text: async () => "blocked" };
      return {
        ok: true, status: 200, statusText: "OK",
        json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sourceLanguage: "French", targetLanguage: "Wolof", translation: "ok" }) }] } }] }),
      };
    }) as unknown as typeof fetch);

    // Sequential enough that the second call is the second passage: with
    // CONCURRENCY workers the failure lands on one item, whichever it is.
    const results = await translateBatch({ texts: ["a", "b", "c"], glossaryFor: noGlossary });

    expect(results).toHaveLength(3);
    // Refusing all three because one tripped a filter would waste the other two,
    // and a caller who must retry everything is back to per-item looping.
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    // Every slot is still occupied, so no result has silently shifted up.
    results.forEach((item, i) => expect(item.index).toBe(i));
    const failure = results.find((r) => !r.ok)!;
    expect(failure.ok).toBe(false);
    expect("error" in failure && failure.error).toMatch(/400/);
  });

  it("handles an empty batch without calling the API", async () => {
    const fetchMock = stubEcho();
    expect(await translateBatch({ texts: [], glossaryFor: noGlossary })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
