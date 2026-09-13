/*
 * append_journal — an entry is ADDED to what a document's or a section's
 * journal holds at the moment of writing (kg-recipes/journal.ts).
 *
 * Pinned here: the entry lands after the existing text, verbatim, under a
 * heading that carries the title, the date and the author; an empty journal
 * is opened with the journal's own header line; a lesson is refused with a
 * sentence saying where journals live; and the case the verb exists for — a
 * confirm whose base moved since the dry-run is refused, not applied over
 * the newer text.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { seedStore, seededContexts, CI_MATHS, CURATOR, withActiveContext as inContext } from "../../__tests__/index.js";
import { __setKgStoreForTest, kgNamespace, __resetMutationsForTest, __resetDraftTokensForTest, readAtPath } from "../../kg-store/index.js";
import { getActiveAdapter } from "../../adapters/index.js";
import { runAppendJournal } from "../document-authoring.js";
import { JOURNAL_PATH } from "../../kg-recipes/index.js";
import type { KgNodeStore } from "../../kg-store/index.js";
import type { Actor } from "../../actor.js";

let store: KgNodeStore;
const SEED_CONTEXTS = [CI_MATHS];
const contexts = seededContexts(SEED_CONTEXTS);
const targetCtx = contexts.find((c) => c.grade === "ci" && c.subject === "maths")!;
const ns = kgNamespace(targetCtx.workspace, targetCtx.grade, targetCtx.subject);

const withActiveContext = <T>(actor: Actor | null, fn: () => Promise<T>): Promise<T> =>
  inContext(targetCtx, actor, fn);

// Read off the fixture rather than hard-coded, so a reshaped graph fails here.
let journaledSectionId: string;   // a section that already keeps a journal
let bareSectionId: string;        // a section with none yet
let lessonId: string;

async function draftJournalOf(nodeId: string): Promise<string | undefined> {
  // Before the first write there is no draft yet: read what a draft would start from.
  const pointer = (await store.readPointer(ns))!;
  const slot = pointer.draftSlot ?? pointer.publishedSlot;
  const node = (await store.listNodes(ns, slot)).find((n) => n.id === nodeId)!;
  const value = readAtPath(node.properties, JOURNAL_PATH);
  return typeof value === "string" ? value : undefined;
}

// Dry-run then confirm, the way a caller does.
async function confirmed(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const preview = await runAppendJournal(args);
  expect(preview.phase, JSON.stringify(preview)).toBe("preview");
  return runAppendJournal({ ...args, confirm: true, confirmationToken: preview.confirmationToken as string });
}

beforeEach(async () => {
  store = await seedStore({ only: SEED_CONTEXTS });
  __setKgStoreForTest(store);
  __resetMutationsForTest();
  __resetDraftTokensForTest();

  await withActiveContext(CURATOR, async () => {
    const raw = getActiveAdapter().model().rawGraph!;
    const sections = raw.nodes.filter((n) => (n.labels ?? []).includes("DocumentSection"));
    const journalOf = (n: { properties?: unknown }) => (n.properties as any)?.metadata?.journal;
    journaledSectionId = sections.find((n) => typeof journalOf(n) === "string" && journalOf(n).trim() !== "")!.id;
    bareSectionId = sections.find((n) => journalOf(n) === undefined)!.id;
    lessonId = raw.nodes.find((n) => (n.labels ?? []).includes("Lesson"))!.id;
  });
});
afterAll(() => { __setKgStoreForTest(null); });

describe("append_journal — where a journal lives", () => {
  it("refuses a lesson, saying where journals live", async () => {
    const out = await withActiveContext(CURATOR, () => runAppendJournal({ on: lessonId, entry: "x" }));
    // The id resolves (an id always resolves to itself); the recipe blocks it.
    expect(JSON.stringify(out)).toMatch(/document or on a section/);
    expect(out.confirmationToken).toBeUndefined();
  });

  it("insists on an entry", async () => {
    const out = await withActiveContext(CURATOR, () => runAppendJournal({ on: journaledSectionId }));
    expect(String(out.error)).toMatch(/entry/);
  });
});

describe("append_journal — what it writes", () => {
  it("adds the entry AFTER the existing text, verbatim, under a dated heading with the author", async () => {
    const before = (await draftJournalOf(journaledSectionId)) ?? "";
    const done = await withActiveContext(CURATOR, () =>
      confirmed({ on: journaledSectionId, entry: "La bande ▲ reste flottante : mesurée à deux pages.", title: "Décision" }));
    expect(done.ok, JSON.stringify(done)).toBe(true);

    const after = (await draftJournalOf(journaledSectionId))!;
    expect(after.startsWith(before.trimEnd())).toBe(true);
    const added = after.slice(before.trimEnd().length);
    expect(added).toMatch(/^\n\n=== Décision — \d{4}-\d{2}-\d{2} — curator@test ===\nLa bande ▲ reste flottante : mesurée à deux pages\.\n$/);
    expect(String(done.heading)).toMatch(/^=== Décision — \d{4}-\d{2}-\d{2} — curator@test ===$/);
  });

  it("opens a journal that did not exist with the journal's own header line", async () => {
    expect(await draftJournalOf(bareSectionId)).toBeUndefined();
    const done = await withActiveContext(CURATOR, () => confirmed({ on: bareSectionId, entry: "Première note." }));
    expect(done.ok, JSON.stringify(done)).toBe(true);

    const after = (await draftJournalOf(bareSectionId))!;
    expect(after).toMatch(/^# Journal — .+\n\n=== NOTE — \d{4}-\d{2}-\d{2} — curator@test ===\nPremière note\.\n$/);
  });

  it("stays a draft edit: the published slot is untouched until publish", async () => {
    await withActiveContext(CURATOR, () => confirmed({ on: bareSectionId, entry: "Brouillon seulement." }));
    const pointer = (await store.readPointer(ns))!;
    const published = (await store.listNodes(ns, pointer.publishedSlot)).find((n) => n.id === bareSectionId)!;
    expect(readAtPath(published.properties, JOURNAL_PATH)).toBeUndefined();
  });
});

describe("append_journal — the race it exists to close", () => {
  it("refuses a confirm whose base moved since its dry-run, instead of writing over the newer entry", async () => {
    const first = await withActiveContext(CURATOR, () => runAppendJournal({ on: journaledSectionId, entry: "Première session." }));
    expect(first.phase).toBe("preview");

    // Another session lands its entry in between.
    const second = await withActiveContext(CURATOR, () => confirmed({ on: journaledSectionId, entry: "Deuxième session." }));
    expect(second.ok).toBe(true);

    const stale = await withActiveContext(CURATOR, () =>
      runAppendJournal({ on: journaledSectionId, entry: "Première session.", confirm: true, confirmationToken: first.confirmationToken as string }));
    expect(stale.ok, JSON.stringify(stale)).not.toBe(true);

    // The second entry is there, the first never landed over it.
    const after = (await draftJournalOf(journaledSectionId))!;
    expect(after).toContain("Deuxième session.");
    expect(after).not.toContain("Première session.");
  });

  it("a fresh dry-run after the move appends AFTER the newer entry", async () => {
    await withActiveContext(CURATOR, () => confirmed({ on: journaledSectionId, entry: "Deuxième session." }));
    const done = await withActiveContext(CURATOR, () => confirmed({ on: journaledSectionId, entry: "Première session, refaite." }));
    expect(done.ok).toBe(true);
    const after = (await draftJournalOf(journaledSectionId))!;
    expect(after.indexOf("Deuxième session.")).toBeLessThan(after.indexOf("Première session, refaite."));
  });
});
