/*
 * Read-only hints — every tool says whether it only reads, and a person reviewed the answer
 *
 * A client such as ChatGPT runs a tool hinted read-only without asking the
 * user first. So the costly mistake is a WRITE marked read-only, and it is an
 * easy one to make: the hint is one word (`READS_ONLY`), copied along with
 * whichever registration a new tool was modelled on.
 *
 * That is why the read-only tools are written out here as well as declared in
 * the code. A tool cannot become read-only without this file changing too,
 * which puts the decision in front of a reviewer. The rule for what counts as
 * a read is at the top of server/tool-effects.ts.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { buildServer } from "../index.js";
import {
  discoverySection, documentsSection, editableSection, guidanceSection, lifecycleSection, recipesSection,
} from "../capabilities-sections.js";

// The reviewed list. Each of these changes nothing a user can see.
const READ_ONLY_TOOLS = [
  // Orientation. set_context moves only this session's own context.
  "ping", "start_here", "get_capabilities", "get_context", "set_context", "list_workspaces",
  // The curriculum graph and the lexicon. translate spends a metered backend and writes nothing.
  "walk_graph", "walk_document", "walk_document_section", "find_node", "namespace_stats",
  "export_graph_view", "get_standards", "get_terminology", "translate",
  // The subject's configuration and the catalog.
  "get_profile", "get_graph_guide", "list_catalog", "get_catalog_entry",
  // The draft, read. preview_generation and diff_draft leave an audit line and nothing else.
  "diff_draft", "check_draft", "review_draft", "preview_generation",
  // A page before it is rendered. compose_section and lint_content keep the
  // page a day for the caller's next call — a scratch copy, not a document.
  "check_document", "compose_section", "lint_content", "page_geometry", "propose_from_document",
  // Produced files, read. create_download_url signs a GET and stores nothing.
  "list_documents", "get_document_text", "create_download_url", "check_stale", "evaluate_document",
  // Administration, read.
  "list_members", "list_unaffiliated_users", "read_audit",
];

// Delete outright: no draft holds the change and undo_last cannot reach it.
const DELETES_FOR_GOOD_TOOLS = [
  "delete_nodes", "delete_edges",   // when aimed at a catalog library
  "discard_draft",
  "remove_terms",                   // the lexicon publishes on confirm
  "remove_member", "revoke_invite", "remove_domain_rule",
  "reconcile",                      // drops the record of a file whose object is gone
];

let tools: Tool[];

// Ask the assembled server, as a client would: the hints only matter in the
// tool list a client actually receives.
beforeAll(async () => {
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), buildServer().connect(serverTransport)]);
  try {
    tools = (await client.listTools()).tools;
  } finally {
    await client.close();
  }
});

const isHintedReadOnly = (tool: Tool): boolean => tool.annotations?.readOnlyHint === true;

function namesOf(matching: (tool: Tool) => boolean): string[] {
  const names = tools.filter(matching).map((tool) => tool.name);
  return names.sort();
}

function hintedReadOnlyAmong(names: readonly string[]): string[] {
  return namesOf((tool) => names.includes(tool.name) && isHintedReadOnly(tool));
}

describe("every tool tells the client whether it only reads", () => {
  it("states readOnlyHint as true or false — never leaves it to the client's default", () => {
    // A floor: an empty tool list would pass every assertion in this file.
    expect(tools.length).toBeGreaterThan(50);

    const unstated = namesOf((tool) => typeof tool.annotations?.readOnlyHint !== "boolean");
    expect(unstated).toEqual([]);
  });

  it("marks read-only exactly the tools on the reviewed list", () => {
    const hinted = namesOf(isHintedReadOnly);
    expect(hinted).toEqual([...READ_ONLY_TOOLS].sort());
  });

  it("never marks read-only a tool that asks for confirmation before it acts", () => {
    // Every two-phase tool — the graph mutations (runGraphMutation) and the live
    // document writes (requireConfirmation) — takes a `confirm` argument, so the
    // argument is how the assembled server shows which tools those are.
    const takesConfirm = (tool: Tool): boolean => "confirm" in (tool.inputSchema.properties ?? {});
    const confirming = namesOf(takesConfirm);
    expect(confirming.length).toBeGreaterThan(20);

    const confirmingButReadOnly = namesOf((tool) => takesConfirm(tool) && isHintedReadOnly(tool));
    expect(confirmingButReadOnly).toEqual([]);
  });

  it("flags as destructive exactly the tools that delete with no draft and no undo", () => {
    const flagged = namesOf((tool) => tool.annotations?.destructiveHint === true);
    expect(flagged).toEqual([...DELETES_FOR_GOOD_TOOLS].sort());
  });
});

/*
 * get_capabilities also sorts tools into reads and writes, but by a different
 * question: which PERMISSION a tool needs, so it can list what the caller may
 * call. The hint says what the tool DOES. The two are kept apart on purpose,
 * and these tests pin that they never contradict each other.
 */
describe("get_capabilities and the hints agree", () => {
  const everythingAllowed = { canReadDocuments: true, canWriteDocuments: true, canApproveDocuments: true, canTranslate: true, canReadDraft: true };

  it("hints as a write every tool get_capabilities lists as an edit or a live write", () => {
    const editable = editableSection(recipesSection());
    const recipeNames = editable.recipes.list.map((recipe) => recipe.name);
    const listedAsWrites = [
      ...editable.batch.tools,
      ...editable.structural.verbs,
      ...editable.documents.tools,
      ...recipeNames,
      ...lifecycleSection().tools,
      ...documentsSection(everythingAllowed).writeTools,
    ];
    expect(listedAsWrites.length).toBeGreaterThan(15);

    expect(hintedReadOnlyAmong(listedAsWrites)).toEqual([]);
  });

  it("hints as a read every tool it lists for finding your way around", () => {
    const listedAsReads = [...discoverySection(everythingAllowed).tools, ...guidanceSection().tools];

    expect(hintedReadOnlyAmong(listedAsReads)).toEqual([...new Set(listedAsReads)].sort());
  });

  it("has exactly one tool behind the documents READ permission that is not a read: reconcile", () => {
    // Anyone who may read a workspace's documents may call reconcile, yet it
    // deletes the record of every file whose object is gone. If reconcile ever
    // stops deleting, this is the test that says its hint can change.
    const behindReadPermission = documentsSection(everythingAllowed).readTools;
    const readOnly = hintedReadOnlyAmong(behindReadPermission);
    const notARead = behindReadPermission.filter((name) => !readOnly.includes(name));

    expect(notARead).toEqual(["reconcile"]);
  });
});
