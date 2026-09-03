/*
 * Module: utils · read-side response projection (leaf)
 *
 * The convention every list-shaped read follows: the CHEAPEST shape is the
 * default, and detail is asked for.
 *
 * Three tools failed three different ways for one missing convention — each
 * returned everything it knew, and the failure mode only varied with how much
 * that was. `list_documents` blew the server's own 100 KB cap at 30 entries;
 * `list_catalog` stayed legal at 63,125 characters and was still too expensive
 * for a caller to receive; `get_capabilities` hit no limit at all and simply
 * taxed every session. A response can be entirely within the cap and still cost
 * more than it is worth.
 *
 * The write side already worked this way — `returnMode: 'summary' | 'full'`,
 * defaulted to the cheap side. This is the same idea on the read side, in one
 * place so the two do not drift into three different spellings.
 */
import { responseBytes } from "./server.js";

/**
 * How much of each row a read returns.
 *
 * `names` — identity and a label: enough to CHOOSE what to fetch next.
 * `summary` — plus small scalar fields. Never prose, never nested payloads.
 * `full` — everything, which is what these reads returned unconditionally.
 */
export const DETAIL_LEVELS = ["names", "summary", "full"] as const;

export type DetailLevel = typeof DETAIL_LEVELS[number];

/** The default, stated once: a caller who asks for nothing gets the cheap shape. */
export const DEFAULT_DETAIL: DetailLevel = "names";

/**
 * Take rows until either `limit` or a byte budget is reached.
 *
 * A page can satisfy `limit` and still be far too large — one document entry
 * carries a whole content record, so thirty of them is a quarter of a megabyte.
 * Trimming here means the caller gets a short page and a cursor instead of an
 * error and nothing.
 *
 * `trimmedBySize` distinguishes the two reasons a page ended, because they need
 * opposite advice: a limit is raised, a byte overflow is narrowed. At least one
 * row is always returned, so a single oversized row cannot yield an empty page
 * that pages forever.
 *
 * `sent` selects what will ACTUALLY be sent, for callers whose rows carry
 * working state alongside the payload — measuring the whole row would then
 * budget against data the caller never transmits, and cut the page far shorter
 * than it needs to be. Defaults to the row itself.
 */
export function takeWithinBudget<T>(
  rows: T[],
  limit: number,
  budgetBytes: number,
  sent: (row: T) => unknown = (row) => row,
): { page: T[]; trimmedBySize: boolean } {
  const page: T[] = [];
  const measured: unknown[] = [];
  for (const row of rows.slice(0, limit)) {
    const withRow = [...measured, sent(row)];
    if (page.length > 0 && responseBytes(withRow) > budgetBytes) {
      return { page, trimmedBySize: true };
    }
    page.push(row);
    measured.push(sent(row));
  }
  return { page, trimmedBySize: false };
}

/**
 * What to tell a caller whose page was cut short by bytes rather than by `limit`.
 *
 * Says the one thing that is NOT obvious: raising the limit will make it worse,
 * not better.
 */
export const trimmedBySizeHint = (narrowWith: string): string =>
  `This page was trimmed to fit a byte budget, so it holds fewer rows than \`limit\` — raising \`limit\` will NOT help. ${narrowWith}`;
