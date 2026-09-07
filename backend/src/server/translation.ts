/*
 * Module: server · tool group: translation
 *
 * `translate` — FR↔Wolof translation backed by Google Gemini (which reads Wolof
 * more reliably than our in-house models). It is grounded in the active
 * subject's MOHEBS glossary: we scan the passage for terms the curriculum
 * already fixes a Wolof wording for and hand those to Gemini as a term bank, so
 * translations stay consistent with existing materials. This is generative
 * translation — distinct from `get_terminology`, which only looks up terms that
 * already exist in the glossary.
 *
 * Guarded like the other curriculum reads: it needs an active grade/subject to
 * resolve the glossary. It never touches the KG store or Cloud Storage.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asJson, guarded } from "./shared.js";
import { contextField, withContextOverrideResult, type WithContext } from "./context-override.js";
import { denyUnlessMember } from "./membership.js";
import { getActiveAdapter } from "../adapters/index.js";
import { activeWorkspace } from "../context/index.js";
import { kgNamespace } from "../kg-store/index.js";
import { CONFIG } from "../config.js";
import { effectiveTerms, filterByText } from "./glossary-read.js";
import { translate, translateBatch, MAX_BATCH, type TranslateDirection } from "../translation/index.js";

export function registerTranslationTools(server: McpServer) {
  server.registerTool(
    "translate",
    {
      title: "Translate French ↔ Wolof (Gemini)",
      description:
        "Translate text between French and Wolof using Google Gemini, grounded in the active subject's MOHEBS FR/Wolof glossary (relevant terms are passed to the model as a term bank so wording stays consistent with existing materials). Direction defaults to auto-detect; pass 'fr>wo' or 'wo>fr' to pin it. Unlike get_terminology (glossary lookup only), this generates a full translation. " +
        "Pass `texts` (an ARRAY) to translate several passages in one call: results come back in the same order, one per input, so a numbered list cannot slide out of alignment the way it does when you concatenate lines and split the answer. Each passage gets its OWN term bank, scanned from its own text. Pass `text` OR `texts`. " +
        "Every result reports `glossaryTerms` — the actual FR/Wolof pairs it was grounded in, not a count — so you can see whether a term was grounded on the sense you meant. " +
        "Requires an active grade/subject, a ROLE in the active workspace (it spends a metered backend, unlike the open curriculum reads), and a server-side Gemini API key.",
      inputSchema: {
        text: z.string().optional().describe("One passage to translate. Use `texts` for several."),
        texts: z
          .array(z.string())
          .max(MAX_BATCH)
          .optional()
          .describe(`Several passages, translated in order (max ${MAX_BATCH}). \`results[i]\` corresponds to \`texts[i]\` — that correspondence is enforced here, not by you.`),
        direction: z
          .enum(["auto", "fr>wo", "wo>fr"])
          .optional()
          .describe("Translation direction. Default: auto (Gemini detects the source language)."),
        ...contextField,
      },
    },
    guarded(async (a: { text?: string; texts?: string[]; direction?: TranslateDirection } & WithContext) =>
      withContextOverrideResult(a.context, async () => {
        // Members only: every call spends Gemini budget, so this is the one read-
        // shaped tool that is not open along with the published curriculum. Inside
        // the override, so the metered backend is charged to a workspace the caller
        // actually belongs to.
        const adapter = getActiveAdapter();
        const namespace = kgNamespace(activeWorkspace(), adapter.grade, adapter.subject);
        const denied = await denyUnlessMember("translate", namespace);
        if (denied) return denied;
        if (!CONFIG.gemini.apiKey) {
          return asJson({
            unavailable: true,
            message:
              "Translation is unavailable: the server has no GEMINI_API_KEY configured. Set it (as a deployment secret) to enable the translate tool.",
          });
        }

        const passages = a.texts ?? (a.text !== undefined ? [a.text] : []);
        if (passages.length === 0) {
          return asJson({ error: "translate needs `text` (one passage) or `texts` (several)." });
        }

        // The glossary is read ONCE for the whole batch; the per-passage scan then
        // runs against that in-memory list, so grounding stays per item without
        // paying for a store read per item.
        const terms = await effectiveTerms();
        const glossaryFor = (text: string) => filterByText(terms, text, 40).map((e) => ({ francais: e.francais, wolof: e.wolof }));

        // A lone `text` keeps its original flat response — a batch of one is not
        // what a caller passing `text` asked for, and reshaping it would break
        // every existing caller for no gain.
        if (a.texts === undefined) {
          return asJson({ namespace, ...(await translate({ text: passages[0], direction: a.direction ?? "auto", glossary: glossaryFor(passages[0]) })) });
        }

        const results = await translateBatch({ texts: passages, direction: a.direction ?? "auto", glossaryFor });
        const failed = results.filter((r) => !r.ok).length;
        return asJson({
          namespace,
          count: results.length,
          results,
          // Said out loud: a partial batch that looked complete would be the same
          // silent misalignment this tool exists to prevent.
          ...(failed ? { failed, note: `${failed} of ${results.length} passage(s) could not be translated; each carries ok:false and its own error. The rest are usable — retry only the failures, by index.` } : {}),
        });
      })),
  );
}
