/*
 * get_capabilities — the mirror-property test
 *
 * The value of this tool is that it CANNOT lie: every actions.* value must
 * agree with what authorize() actually returns for the same (actor, action,
 * namespace). If they ever disagree, one of them is a copy that drifted —
 * this test catches that immediately.
 *
 * Same test also exercises:
 *   - the role-change-flows-through property (running as different actors
 *     produces different responses with zero code change);
 *   - draft.exists reflecting the actual pointer;
 *   - editable + rules sourced from the real modules (adapter aliases and
 *     STRUCTURAL_RULES), not literal strings that could rot;
 *   - unknown-safe behavior (a truthful read/generate-only response, no error);
 *   - no-state-change (audit is quiet across a get_capabilities call).
 *
 * The tool is exposed via MCP; here we test the underlying logic by driving
 * it via a McpServer connected to a memory transport.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { seedStore, seededContexts, fakeStorage, CI_MATHS , withActiveContext as inContext } from "../../__tests__/index.js";
import { newSessionState, runInSession } from "../../context/index.js";
import { subjectDir, KG_FIXTURE } from "../../__tests__/index.js";
import { __setKgStoreForTest, kgNamespace, runGraphMutation, STRUCTURAL_RULES, __resetMutationsForTest } from "../../kg-store/index.js";
import { RECIPES, SHARED_CATALOG_NAMESPACE, reposition } from "../../kg-recipes/index.js";
import { __setStorageForTest } from "../../storage/index.js";
import { __setActorForTest, type Actor } from "../../actor.js";
import { authorize } from "../../authz.js";
import { activateContext } from "../../activate.js";
import { buildCapabilitiesReport } from "../capabilities.js";
import { CATALOG_WRITE_VERBS } from "../catalog-target.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../index.js";
import type { KgNodeStore, StoredMeta } from "../../kg-store/index.js";
import type { StorageAdapter, HistoryFile } from "../../types.js";


const CURATOR: Actor = { id: "curator-uid", email: "curator@test", role: "curator", unknown: false };
const APPROVER: Actor = { id: "approver-uid", email: "approver@test", role: "approver", unknown: false };
const SIGNED_IN_NO_ROLE: Actor = { id: "guest-uid", email: "guest@test", unknown: false };

let store: KgNodeStore;
// The fixture contexts this suite asserts against — seeding only these
// keeps each beforeEach off the graphs it never reads.
const SEED_CONTEXTS = [CI_MATHS];
const contexts = seededContexts(SEED_CONTEXTS);
const targetCtx = contexts.find((c) => c.grade === "ci" && c.subject === "maths")!;
const ns = kgNamespace(targetCtx.grade, targetCtx.subject);

async function seedFreshStore(): Promise<KgNodeStore> {
  return seedStore({ only: SEED_CONTEXTS });
}

// Drive the tool's inner logic directly, not through the MCP transport —
// `buildCapabilitiesReport` is what the registered tool calls, so testing
// it directly is exactly what a real invocation runs, minus the JSON
// envelope wrapping.
async function callGetCapabilities(): Promise<any> {
  return buildCapabilitiesReport();
}

// A convenience: activate a context inside a session before running the
// tool. Every test picks one context and runs from there.
// The harness session helper, with this suite's context bound in.
const withActiveContext = <T>(actor: Actor | null, fn: () => Promise<T>): Promise<T> =>
  inContext(targetCtx, actor, fn);

beforeAll(() => { __setStorageForTest(fakeStorage); });
beforeEach(async () => {
  store = await seedFreshStore();
  __setKgStoreForTest(store);
  __resetMutationsForTest();
});
afterAll(() => {
  __setKgStoreForTest(null);
});

// ── Mirror property (the whole point) ───────────────────────────────────────

describe("mirror property: get_capabilities.actions == authorize() for every role", () => {
  const authzActionByCap = {
    canReadDraft: "readDraft" as const,
    canEditDraft: "apply" as const,
    canDiscardDraft: "discard" as const,
    canPublish: "publish" as const,
    canReadAudit: "readAudit" as const,
  };

  for (const actor of [CURATOR, APPROVER, SIGNED_IN_NO_ROLE]) {
    it(`agrees with authorize() for role='${actor.role ?? "none"}'`, async () => {
      const caps = await withActiveContext(actor, callGetCapabilities);
      for (const [cap, authAction] of Object.entries(authzActionByCap)) {
        const authResult = authorize(actor, authAction, ns);
        expect(caps.actions[cap]).toBe(authResult.ok);
      }
      // Reads and generation are ungated by construction.
      expect(caps.actions.canReadGenerate).toBe(true);
    });
  }

  it(`agrees with authorize() for the unknown (no verified identity) actor`, async () => {
    const caps = await withActiveContext(null, callGetCapabilities);
    // Unknown → every gated action denied, reads still open.
    expect(caps.actions.canReadGenerate).toBe(true);
    expect(caps.actions.canReadDraft).toBe(false);
    expect(caps.actions.canEditDraft).toBe(false);
    expect(caps.actions.canDiscardDraft).toBe(false);
    expect(caps.actions.canPublish).toBe(false);
    expect(caps.actions.canReadAudit).toBe(false);
    expect(caps.actor.isKnown).toBe(false);
    expect(caps.actor.role).toBe(null);
  });
});

// ── Role-change-flows-through property ──────────────────────────────────────

describe("changing the caller's role changes the response with NO edit to the tool", () => {
  it("curator vs approver: canPublish flips", async () => {
    const asCurator = await withActiveContext(CURATOR, callGetCapabilities);
    const asApprover = await withActiveContext(APPROVER, callGetCapabilities);
    expect(asCurator.actions.canPublish).toBe(false);
    expect(asApprover.actions.canPublish).toBe(true);
    // read_audit is approver-only too — same tier as publish (#16).
    expect(asCurator.actions.canReadAudit).toBe(false);
    expect(asApprover.actions.canReadAudit).toBe(true);
    // The audit section's `available` mirrors the same gate — no drift.
    expect(asCurator.audit.available).toBe(false);
    expect(asApprover.audit.available).toBe(true);
    // Everything else a curator can do, an approver can too (superset).
    expect(asCurator.actions.canEditDraft).toBe(true);
    expect(asApprover.actions.canEditDraft).toBe(true);
    expect(asCurator.actions.canDiscardDraft).toBe(true);
    expect(asApprover.actions.canDiscardDraft).toBe(true);
  });
});

// ── Role/identity plumbing ──────────────────────────────────────────────────

describe("actor block reports the verified identity, not client-supplied fields", () => {
  it("reports role and id from currentActor()", async () => {
    const caps = await withActiveContext(CURATOR, callGetCapabilities);
    expect(caps.actor.id).toBe(CURATOR.id);
    expect(caps.actor.role).toBe("curator");
    expect(caps.actor.isKnown).toBe(true);
  });

  it("reports role=null for a signed-in actor without a user_roles row", async () => {
    const caps = await withActiveContext(SIGNED_IN_NO_ROLE, callGetCapabilities);
    expect(caps.actor.role).toBe(null);
    expect(caps.actor.isKnown).toBe(true);
    // A signed-in user without a role still can't edit — authorize() denies.
    expect(caps.actions.canEditDraft).toBe(false);
    // …and the catalog's canUse mirrors that same gate: no role → cannot copy a routine.
    expect(caps.catalog.canUse).toBe(false);
  });
});

// ── Draft status ────────────────────────────────────────────────────────────

describe("draft.exists reflects the real pointer", () => {
  it("false when no draft has been created", async () => {
    const caps = await withActiveContext(CURATOR, callGetCapabilities);
    expect(caps.draft.exists).toBe(false);
    expect(caps.draft.createdBy).toBeUndefined();
  });

  it("true when a curator has landed an edit; createdBy names the curator", async () => {
    // Seed one apply as CURATOR — this lazy-creates the draft.
    await withActiveContext(CURATOR, async () => {
      const nodes = await store.listNodes(ns, "a");
      const chapter = nodes.find((n) => (n.labels ?? []).includes("LessonGrouping"))!;
      const preview = await runGraphMutation({
        namespace: ns, mutation: reposition,
        args: { namespace: ns, nodeId: chapter.id, position: 7 },
      });
      if (preview.phase !== "preview") {
        throw new Error("preview");
      }
      await runGraphMutation({
        namespace: ns, mutation: reposition,
        args: { namespace: ns, nodeId: chapter.id, position: 7 },
        confirm: true, token: preview.confirmationToken,
      });
    });

    // Now a DIFFERENT curator queries capabilities — they should see that
    // a draft is open and who opened it (so they don't clobber it).
    const anotherCurator: Actor = { id: "other-curator-uid", email: "other@test", role: "curator", unknown: false };
    const caps = await withActiveContext(anotherCurator, callGetCapabilities);
    expect(caps.draft.exists).toBe(true);
    expect(caps.draft.createdBy?.id).toBe(CURATOR.id);
    expect(caps.draft.createdBy?.role).toBe("curator");
    expect(typeof caps.draft.createdBy?.ts).toBe("string");
  });
});

// ── Editable + rules sourced from real modules ──────────────────────────────

describe("editable and rules come from the real sources (no hand-copied literals)", () => {
  it("rules.structural IS the STRUCTURAL_RULES constant from validate.ts", async () => {
    const caps = await withActiveContext(CURATOR, callGetCapabilities);
    expect(caps.rules.structural).toEqual([...STRUCTURAL_RULES]);
  });

  it("editable.structural reports create_edges + the deletion verbs and always-with-warning cascade", async () => {
    const caps = await withActiveContext(CURATOR, callGetCapabilities);
    expect(caps.editable.structural.verbs).toEqual(["create_edges", "delete_edges", "delete_nodes"]);
    // delete_nodes always cascades the dependent subtree; the dry-run warns.
    expect(caps.editable.structural.cascade).toBe("always-with-warning");
  });

  it("the retired typed adds are gone; node creation is add_nodes", async () => {
    const caps = await withActiveContext(CURATOR, callGetCapabilities);
    expect(caps.editable.typedAdds).toBeUndefined();
    expect(caps.editable.batch.tools).toContain("add_nodes");
  });

  it("discovery advertises the read tools (walk_* + find_node + namespace_stats + export_graph_view), with canWalkDraft mirroring the draft-read gate", async () => {
    const caps = await withActiveContext(CURATOR, callGetCapabilities);
    expect(caps.discovery.tools).toEqual(["walk_graph", "walk_document", "walk_document_section", "find_node", "namespace_stats", "export_graph_view"]);
    // walk_document resolves a document's scope one of three ways.
    expect(caps.discovery.walkDocument.scopes).toEqual(["sections", "course", "none"]);
    // walk_document_section is the per-piece entry, anchored on one section id.
    expect(caps.discovery.walkDocumentSection.params).toEqual(["sectionId", "slot"]);
    // canWalkDraft is the SAME gate diff_draft enforces — it cannot drift.
    expect(caps.discovery.canWalkDraft).toBe(caps.actions.canReadDraft);
    // Feature-detection for the paginated walk.
    expect(caps.discovery.walkGraph.defaults.limit).toBe(50);
    expect(caps.discovery.walkGraph.maxLimit).toBe(500);
    // Feature-detection for the scoped visualization export.
    expect(caps.discovery.exportGraphView.defaults.maxDepth).toBe(4);
    expect(caps.discovery.exportGraphView.maxDepth).toBe(12);
  });

  it("editable.batch advertises the batched writes' returnMode + idempotency controls", async () => {
    const caps = await withActiveContext(CURATOR, callGetCapabilities);
    expect(caps.editable.batch.tools).toEqual(["add_nodes", "create_edges", "delete_edges", "delete_nodes"]);
    expect(caps.editable.batch.params).toEqual(["returnMode", "idempotencyKey"]);
    expect(caps.editable.batch.defaultReturnMode).toBe("summary");
    expect(caps.editable.batch.returnModes).toEqual(["summary", "full"]);
    // The per-kind property catalog folded in from the retired typed adds.
    expect(caps.editable.batch.kindProperties.Material).toContain("content");
    expect(caps.editable.batch.kindProperties.StandardsFrameworkItem).toContain("statementType");
  });

  it("lifecycle advertises the draft tools + their returnMode controls", async () => {
    const caps = await withActiveContext(CURATOR, callGetCapabilities);
    // undo_last sits here as the per-EDIT counterpart to discard_draft, even
    // though its role gate is canEditDraft rather than canDiscardDraft.
    expect(caps.lifecycle.tools).toEqual(["publish_draft", "discard_draft", "undo_last", "request_review"]);
    expect(caps.lifecycle.params).toEqual(["returnMode"]);
    expect(caps.lifecycle.defaultReturnMode).toBe("summary");
    expect(caps.lifecycle.returnModes).toEqual(["summary", "full"]);
  });

  it("editable.recipes IS a MIRROR of the generic RECIPES registry — no hand-authored copy", async () => {
    const caps = await withActiveContext(CURATOR, callGetCapabilities);
    // Generic verbs are available on every subject (no per-subject profile/allowlist).
    expect(caps.editable.recipes.available).toBe(true);
    expect(caps.editable.recipes.list.map((r: { name: string }) => r.name)).toEqual(RECIPES.map((r) => r.name));
    expect(caps.editable.recipes.list).toEqual(RECIPES.map((r) => ({ name: r.name, summary: r.summary, params: r.params })));
    // The two generic verbs, in order (node creation is add_nodes). Every name
    // here MUST be a registered tool — see the "advertises only registered
    // tools" case in server/__tests__/recipes.test.ts, which pins the mirror to
    // the server's real tool list (move_node was advertised here while no tool
    // by that name existed).
    expect(caps.editable.recipes.list.map((r: { name: string }) => r.name)).toEqual(["edit_nodes", "move_node"]);
  });

  it("catalog.editVerbs IS the set of tools that actually take a `catalog` argument", async () => {
    /*
     * The claim get_capabilities makes about itself is that every field comes from
     * the module that enforces it. `editVerbs` was the exception — a hand-kept array
     * that went stale twice, missing delete_nodes/delete_edges when they gained the
     * redirect (#178) and move_node (#200). There is no runtime registry to read
     * (each tool declares `catalog` in its own MCP inputSchema), so this test IS the
     * derivation: it asks the assembled server which tools advertise the argument
     * and pins the declared list to exactly that set.
     */
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), buildServer().connect(serverTransport)]);
    try {
      const advertising = (await client.listTools()).tools
        .filter((tool) => "catalog" in ((tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}))
        .map((tool) => tool.name);

      expect([...CATALOG_WRITE_VERBS].sort()).toEqual(advertising.sort());
    } finally {
      await client.close();
    }

    // And the report renders that list rather than a copy of it.
    const caps = await withActiveContext(CURATOR, callGetCapabilities);
    expect(caps.catalog.editVerbs).toEqual(CATALOG_WRITE_VERBS);
  });

  it("catalog advertises its tools + browse resource; canUse mirrors the apply gate", async () => {
    const caps = await withActiveContext(CURATOR, callGetCapabilities);
    expect(caps.catalog.browse).toBe(true);   // list_catalog is an ungated read
    expect(caps.catalog.tools).toEqual(["list_catalog", "get_catalog_entry", "use_routine", "use_formatter", "use_rubric", "add_to_catalog", "duplicate_entry"]);
    expect(caps.catalog.resources).toEqual(["catalog://{scope}/{id}"]);
    expect(caps.catalog.scopes.shared).toBe(SHARED_CATALOG_NAMESPACE);
    // use_routine copies onto the draft — same gate as any edit, no drift.
    expect(caps.catalog.canUse).toBe(caps.actions.canEditDraft);
    // The two kinds attach differently: a routine to a Lesson (usesRoutine), a
    // formatter under the document's TLM (hasPart) — mirrors useRoutine/useFormatter.
    expect(caps.catalog.applies.routine).toMatch(/usesRoutine/);
    expect(caps.catalog.applies.formatter).toMatch(/TeachingLearningMaterial/);
    expect(caps.catalog.applies.formatter).toMatch(/hasPart/);
  });
});

// ── No-state-change / safe for unknown ──────────────────────────────────────

describe("get_capabilities is a read", () => {
  it("does not touch the audit log or the pointer", async () => {
    const auditBefore = (await store.listAudit({ namespace: ns })).length;
    const pointerBefore = await store.readPointer(ns);
    await withActiveContext(CURATOR, callGetCapabilities);
    await withActiveContext(null, callGetCapabilities);
    await withActiveContext(APPROVER, callGetCapabilities);
    const auditAfter = (await store.listAudit({ namespace: ns })).length;
    const pointerAfter = await store.readPointer(ns);
    expect(auditAfter).toBe(auditBefore);
    expect(pointerAfter).toEqual(pointerBefore);
  });

  it("returns a truthful response for unknown callers instead of erroring", async () => {
    const caps = await withActiveContext(null, callGetCapabilities);
    // Structural shape is present even for unknown — the tool doesn't 401 them.
    expect(caps.actor).toBeDefined();
    expect(caps.actions).toBeDefined();
    expect(caps.editable).toBeDefined();
    expect(caps.rules).toBeDefined();
    expect(caps.actor.isKnown).toBe(false);
  });
});

/*
 * The mirror's own integrity.
 *
 * `verbs` is what a caller reads to know what it may call, and it is assembled
 * separately from the sections that describe those tools. That is exactly how
 * it drifts: the `document` section shipped advertising three tools that never
 * reached `verbs`, because its group was written with `available` where the
 * collector reads `allowed` and was then never passed to it at all. Nothing
 * failed — the mirror just quietly stopped listing three callable tools.
 */
describe("every tool a section advertises is a tool it says you may call", () => {
  it("lists the document tools in verbs, for a caller allowed to preview", async () => {
    // Inside an active context, like every other test here: the report reads
    // the active subject to decide what this actor may do.
    const report = await withActiveContext(CURATOR, callGetCapabilities);
    const section = report.document as { available: boolean; tools: string[] };
    if (!section.available) return;   // gated off for this actor: nothing to assert
    for (const tool of section.tools) {
      expect(report.verbs).toContain(tool);
    }
  });
});
