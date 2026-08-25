/*
 * Module: server · node authoring (add_nodes)
 *
 * add_nodes is the SINGLE node-creation tool: create one node or many in ONE
 * atomic draft edit. It replaced the nine per-label typed adds (add_lesson,
 * add_standard_framework_item, …) — those were thin facades over the same
 * addNode recipe, so add_nodes with a one-item batch does everything they did.
 * The per-kind property vocabulary they documented inline now lives in
 * KIND_PROPERTIES (mirrored by get_capabilities) and in this tool's description,
 * so nothing was lost by retiring them.
 *
 * Every add rides the graph-mutation envelope: a dry-run returns a summary (or,
 * with returnMode:"full", the diff) + confirmationToken + minted ids (no state
 * change); the confirm re-checks the token and applies to the DRAFT only. Batch
 * shaping + idempotency live in server/batch.ts. See
 * docs/design-notes/graph-native-authoring.md.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { asJson, guarded } from "./shared.js";
import { getActiveAdapter } from "../adapters/index.js";
import { activeWorkspace } from "../context/index.js";
import { kgNamespace, mintNodeId } from "../kg-store/index.js";
import { addNodes } from "../kg-recipes/index.js";
import { runBatchMutation, type ReturnMode } from "./batch.js";
import { idempotencyPayloadHash } from "./idempotency.js";
import { runCatalogWrite } from "./catalog-target.js";
import type { SubjectAdapter } from "../types.js";
import { PARKED_PAYLOAD_NOTE, IDEMPOTENCY_NOTE, RETURN_MODE_NOTE } from "./tool-notes.js";

// The namespace the active subject binds to (same as the other mutation tool groups).
function bind(adapter: SubjectAdapter): { namespace: string } {
  return { namespace: kgNamespace(activeWorkspace(), adapter.grade, adapter.subject) };
}

// One item of an add_nodes batch, as it arrives from the caller. `kind` is the
// LC label (the discriminator); `properties` is the kind-specific canonical LC
// bag (audience, groupName, statementType, content, … — see KIND_PROPERTIES).
type AddNodesItemInput = {
  kind: string;
  parentId?: string;
  description?: string;   // display text → normalized title/text + raw.description
  title_en?: string;
  position?: number;
  via?: string;
  alignTo?: string;
  properties?: Record<string, unknown>;
  mintedNodeId?: string;  // caller's own alias, echoed back in the id map for correlation
};

// The LC labels add_nodes accepts (the discriminator's enum). The last four are
// the non-canonical document / rendering layer (a TLM and its formatting), which
// LC does not define — see docs/design-notes/teaching-learning-materials.md.
const ADD_NODE_KINDS = [
  "Course", "LessonGrouping", "Lesson", "Activity", "Assessment",
  "Material", "LearningComponent", "InstructionalRoutine", "StandardsFrameworkItem",
  "TeachingLearningMaterial", "DocumentSection", "Formatter", "FormatterSpec",
] as const;

// The kind-specific canonical LC props each label accepts in its `properties`
// bag — the vocabulary the retired typed add tools used to name in their
// schemas. Written under raw.*; exported so get_capabilities mirrors it for
// feature-detection. (Common-to-all fields — description/title_en/position/
// alignTo — are on the item itself, not here.)
export const KIND_PROPERTIES: Record<string, string[]> = {
  Course: ["audience", "educationalUse", "courseCode", "timeRequired"],
  LessonGrouping: ["groupName", "groupLevel", "audience", "educationalUse"],
  Lesson: ["audience", "educationalUse", "timeRequired"],
  Activity: ["audience", "studentGroupingType", "timeRequired"],
  Assessment: ["audience", "educationalUse", "variant", "timeRequired"],
  Material: ["content", "materialType", "audience", "educationalUse"],
  LearningComponent: ["examples"],
  StandardsFrameworkItem: ["normalizedStatementType", "statementType", "statementCode", "gradeLevel"],
  InstructionalRoutine: ["timeRequired", "metadata.summary"],
  // The document / rendering layer (non-canonical). A TLM is a ROOT that `covers`
  // a Course (wire the covers edge with create_edges); its own build logic rides
  // "metadata.assemblyGuide". A FormatterSpec carries the actual rule in `content`.
  TeachingLearningMaterial: ["audience", "mediumType", "metadata.assemblyGuide"],
  DocumentSection: ["metadata.assemblyGuide"],
  Formatter: ["metadata.summary"],
  FormatterSpec: ["content"],
};

// The same catalog as prose, with the notes the typed tools carried (required
// fields, the bilan flag, the supports-edge case) — embedded in the tool
// description so a caller sees what each kind expects at call time.
const PER_KIND_GUIDE =
  // The per-kind PROPERTY KEYS live in get_capabilities (`editable.batch.kindProperties`)
  // as structured data — repeating them here cost ~570 tokens of every session's
  // tool manifest. What stays is only what that table CANNOT express: which
  // kinds are roots, which props are required, and the wiring traps.
  "Per-kind `properties` are catalogued in get_capabilities → `editable.batch.kindProperties` (call it once if you need the exact keys for a kind). " +
  "The rules that catalog does NOT carry: " +
  "Course and TeachingLearningMaterial are ROOTS — omit parentId · " +
  "LessonGrouping REQUIRES `groupName` (e.g. 'Chapitre'/'Unité'/'Semaine') · " +
  "on a Lesson, educationalUse:'Assessment' is what marks a bilan · " +
  "LearningComponent attaches to its parent StandardsFrameworkItem via `supports` (no alignTo) · " +
  "attach an InstructionalRoutine ROOT onto a Lesson/Course/Activity with `via:\"usesRoutine\"`, then nest its steps/step-Materials under it by the default hasPart · " +
  "a DocumentSection with no `covers` target is front-matter; a Formatter is composed of FormatterSpec children by hasPart, and the FormatterSpec carries the rule text in `content`. " +
  "PREFER create_document for a NEW document and add_section for its sections: those mint the node AND its `covers` edge atomically, whereas add_nodes leaves the document covering nothing until you remember create_edges — which fails silently (generation just reads an empty document). " +
  "Common to every item: `description` (display title), `title_en`, `position`; content kinds may `alignTo` an SFI (hasEducationalAlignment).";

type AddNodesArgs = {
  items?: AddNodesItemInput[];
  confirm?: boolean;
  confirmationToken?: string;
  mintedNodeIds?: string[];
  returnMode?: ReturnMode;
  idempotencyKey?: string;
  catalog?: string;   // write to a catalog library instead of the active subject
};

// The add_nodes core, exported so tests drive the real logic (like
// buildCapabilitiesReport). Routes the batch to the active subject's namespace,
// or — when `catalog` is set — to a catalog library, which also publishes on
// confirm (catalogs have no publish_draft; see catalog-target.ts).
export async function runAddNodes(a: AddNodesArgs): Promise<Record<string, unknown>> {
  const addInNamespace = (namespace: string) => addNodesInNamespace(namespace, a);
  if (a.catalog) {
    return runCatalogWrite(a.catalog, a.confirm, addInNamespace);
  }
  return addInNamespace(bind(getActiveAdapter()).namespace);
}

// Mints per-item ids, folds them into the batch mutation, and delegates response
// shaping + idempotency to runBatchMutation. Namespace-agnostic so the same path
// serves both a subject write and a catalog write.
async function addNodesInNamespace(namespace: string, a: AddNodesArgs): Promise<Record<string, unknown>> {
  // Token-only confirm shortcut: caller sends confirm+token with NO items and no
  // mintedNodeIds. Everything the batch needs — built args, mintedIds echo,
  // payload hash — was parked at dry-run and runBatchMutation will read it back.
  // We still call runBatchMutation, but with placeholder args/extra/hash that it
  // overwrites from the parked context.
  if (a.confirm && !a.items) {
    return runBatchMutation({
      namespace, mutation: addNodes,
      args: { namespace, items: [] },
      confirm: true, token: a.confirmationToken,
      returnMode: a.returnMode ?? "summary",
      idempotencyKey: a.idempotencyKey,
      payloadHash: "",
      extra: {},
      storePayload: true,
    });
  }

  // Mint one real id per item on the dry-run; on confirm reuse the exact ids the
  // caller echoes back, so the args-hash matches the previewed batch.
  const items = a.items ?? [];
  const mintedIds = a.confirm ? (a.mintedNodeIds ?? []) : items.map(() => mintNodeId());
  const builtItems = items.map((item, index) => ({
    label: item.kind,
    parentId: item.parentId,
    newNodeId: mintedIds[index] ?? "",
    title: item.description,
    title_en: item.title_en,
    position: item.position,
    via: item.via,
    alignTo: item.alignTo,
    properties: item.properties,
  }));

  // A { yourAlias → realId } map for items that supplied their own mintedNodeId,
  // surfaced (with mintedNodeIds) on both the preview and the apply summary.
  const mintedNodeIdMap: Record<string, string> = {};
  items.forEach((item, index) => {
    if (item.mintedNodeId) {
      mintedNodeIdMap[item.mintedNodeId] = mintedIds[index];
    }
  });

  return runBatchMutation({
    namespace,
    mutation: addNodes,
    args: { namespace, items: builtItems },
    confirm: a.confirm,
    token: a.confirmationToken,
    returnMode: a.returnMode ?? "summary",
    idempotencyKey: a.idempotencyKey,
    payloadHash: idempotencyPayloadHash(builtItems),
    extra: { mintedNodeIds: mintedIds, mintedNodeIdMap },
    storePayload: true,
  });
}

export function registerAuthoringTools(server: McpServer) {
  server.registerTool(
    "add_nodes",
    {
      title: "Add nodes (one or many) in one batch",
      description:
        "The single node-creation tool — create ONE node or MANY in one atomic draft edit (it replaced the per-label add_lesson/add_material/… tools). Each `items[i]` has `kind` (the LC label — Course/LessonGrouping/Lesson/Activity/Assessment/Material/LearningComponent/InstructionalRoutine/StandardsFrameworkItem, or a document-layer label TeachingLearningMaterial/DocumentSection/Formatter/FormatterSpec), an EXISTING `parentId` (omit for a root Course/StandardsFramework), `description` (display title), optional `position`/`alignTo`/`via`, and `properties` (the kind-specific canonical LC bag). " +
        PER_KIND_GUIDE + " " +
        "Each item attaches under an already-existing parent — a node minted in the SAME batch cannot be a parent (stage nodes here, then wire cross-references with create_edges). Optional per-item `mintedNodeId` is your own alias, returned in an id map so you can correlate items to their real ids. ALL-OR-NOTHING: the dry-run validates every item and returns ONE confirmationToken + `mintedNodeIds` (real ids, in item order); any item error blocks the whole batch (no partial apply). " + PARKED_PAYLOAD_NOTE + "" +
        "" + RETURN_MODE_NOTE + "" +
        "" + IDEMPOTENCY_NOTE + " DRAFT edit — publish_draft to make it live. " +
        "`catalog` (optional) adds the nodes to a CATALOG LIBRARY instead of the active subject graph — this is ALSO how a brand-new library entry should be authored (write it straight into the library; do NOT build it inside the curriculum and clone it over with add_to_catalog — an interrupted session leaves a half-built formatter stranded in the subject graph with nothing to flag it). It also extends a stale master entry (e.g. a missing FormatterSpec) that use_routine / use_formatter would otherwise keep re-cloning without it. Pass 'workspace' (your own library), 'shared' (the cross-tenant one), or a workspace id. Crossing into another workspace's or the shared library needs super_admin. In a catalog the entry root is an `InstructionalRoutine` and its steps/specs are `Material` — a formatter is only RELABELLED to Formatter/FormatterSpec when use_formatter clones it out, so author catalog children as Material. TWO DIFFERENCES from a subject add: confirming PUBLISHES the library live in one step (catalogs are not enterable, so no publish_draft or diff_draft), and you must RE-SEND `catalog` on the confirm. Sequence multi-call authoring so each confirmed call leaves the library coherent on its own.",
      inputSchema: {
        // `items` is required on a dry-run; on a token-only confirm (large batch
        // held server-side) it is omitted alongside `mintedNodeIds`.
        items: z.array(
          z.object({
            kind: z.enum(ADD_NODE_KINDS),
            parentId: z.string().optional(),
            description: z.string().optional(),
            title_en: z.string().optional(),
            position: z.number().optional(),
            via: z.string().optional(),
            alignTo: z.string().optional(),
            properties: z.record(z.any()).optional(),
            mintedNodeId: z.string().optional(),
          }),
        ).optional(),
        returnMode: z.enum(["summary", "full"]).optional(),
        idempotencyKey: z.string().optional(),
        catalog: z.string().optional(),
        confirm: z.boolean().optional(),
        confirmationToken: z.string().optional(),
        mintedNodeIds: z.array(z.string()).optional(),   // real ids, echoed on confirm (re-send path only)
      },
    },
    guarded(async (a: AddNodesArgs) => asJson(await runAddNodes(a))),
  );
}
