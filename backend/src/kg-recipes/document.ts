/*
 * Recipes: create_document + add_section
 *
 * The two TASK verbs of docs/design-notes/self-serve-authoring.md phase 3, and
 * the reason they exist rather than being facades over add_nodes:
 *
 *   A task verb earns its place only when it enforces a multi-element invariant
 *   that a primitive call can silently violate.
 *
 * Both pass that test. A TeachingLearningMaterial without its `covers` edge is a
 * perfectly valid graph write and a broken document: nothing errors, and
 * generation simply reads an empty document — the expert finds out at the end.
 * A DocumentSection needs TWO edges on TWO axes (its `hasPart` from the document,
 * its `covers` to the curriculum), and forgetting either fails just as quietly.
 * Making the pair atomic is the whole content of these verbs.
 *
 * A hypothetical create_lesson would NOT pass: add_nodes with `alignTo` is
 * already atomic and already carries that invariant. That one stays retired.
 */

import { linkNodes, type GraphMutation, type MutationGraph, type MutationNode } from "../kg-store/index.js";
import { addNode } from "./add-node.js";
import { RecipeCommon, nodeById } from "./shared.js";

// The non-canonical document layer (docs/design-notes/teaching-learning-materials.md).
const TLM_LABEL = "TeachingLearningMaterial";
const SECTION_LABEL = "DocumentSection";
// Our one extension edge: a document (or one of its sections) points at the
// curriculum it renders.
const COVERS_EDGE = "covers";

const labelsOf = (node: MutationNode | undefined): string[] => node?.labels ?? [];

// A document may only cover CURRICULUM. Pointing it at another document (or at a
// formatter) is never meaningful, and it is an easy slip when a name resolves to
// the wrong thing.
const DOCUMENT_LAYER = new Set([TLM_LABEL, SECTION_LABEL, "Formatter", "FormatterSpec", "Rubric", "RubricSection", "RubricCriterion"]);
const isDocumentLayer = (node: MutationNode | undefined): boolean =>
  labelsOf(node).some((label) => DOCUMENT_LAYER.has(label));

// The `covers` edge both verbs must not forget: document/section → curriculum.
const linkCovers = (graph: MutationGraph, fromId: string, toId: string, namespace: string): MutationGraph =>
  linkNodes.apply(graph, { edgeType: COVERS_EDGE, fromId, toId, properties: {}, namespace });

// ── create_document ──────────────────────────────────────────────────────────

export type CreateDocumentArgs = RecipeCommon & {
  newNodeId: string;                      // minted by the tool layer
  name: string;                           // the document's display name
  coversId: string;                       // the curriculum node it renders (already resolved from a name)
  properties?: Record<string, unknown>;   // audience, mediumType, metadata.assemblyGuide, …
};

export const createDocument: GraphMutation<CreateDocumentArgs> = {
  name: "createDocument",
  describe: (args) => `create the document '${args.name}' covering '${args.coversId}'`,

  validate: (base, _after, args) => {
    const errors: string[] = [];
    if (typeof args.name !== "string" || args.name.trim().length === 0) {
      errors.push("create_document: 'name' is required — a document needs a name a person can recognise.");
    }
    const target = nodeById(base, args.coversId);
    if (!target) {
      errors.push(`create_document: the content to cover ('${args.coversId}') does not exist in the draft.`);
    } else if (isDocumentLayer(target)) {
      errors.push(`create_document: '${args.coversId}' is itself part of the document layer (${labelsOf(target).join(", ")}). A document covers CURRICULUM — a Course, a chapter/week, or a lesson.`);
    }
    if (nodeById(base, args.newNodeId)) {
      errors.push(`create_document: minted id '${args.newNodeId}' already exists (retry).`);
    }
    return { errors, warnings: [] };
  },

  apply: (base, args) => {
    // apply() runs before validate() on the dry-run, so a missing target must
    // leave the graph untouched rather than throw — validate then blocks cleanly.
    if (!nodeById(base, args.coversId)) return base;

    const withDocument = addNode.apply(base, {
      namespace: args.namespace,
      label: TLM_LABEL,
      newNodeId: args.newNodeId,
      title: args.name,
      properties: args.properties,
    });
    return linkCovers(withDocument, args.newNodeId, args.coversId, args.namespace);
  },
};

// ── add_section ──────────────────────────────────────────────────────────────

export type AddSectionArgs = RecipeCommon & {
  newNodeId: string;
  documentId: string;                     // the TLM this section belongs to
  name: string;
  position?: number;                      // order within the document; defaults to appending
  coversId?: string;                      // the curriculum this section renders; omitted for front matter
  properties?: Record<string, unknown>;   // metadata.assemblyGuide, …
};

export const addSection: GraphMutation<AddSectionArgs> = {
  name: "addSection",
  describe: (args) =>
    `add the section '${args.name}' to document '${args.documentId}'${args.coversId ? ` covering '${args.coversId}'` : " (front matter — covers nothing)"}`,

  validate: (base, _after, args) => {
    const errors: string[] = [];
    if (typeof args.name !== "string" || args.name.trim().length === 0) {
      errors.push("add_section: 'name' is required.");
    }

    const document = nodeById(base, args.documentId);
    if (!document) {
      errors.push(`add_section: document '${args.documentId}' does not exist in the draft.`);
    } else if (!labelsOf(document).includes(TLM_LABEL)) {
      errors.push(`add_section: '${args.documentId}' is a ${labelsOf(document).join(", ") || "node"}, not a document. Sections hang under a TeachingLearningMaterial — create one with create_document first.`);
    }

    if (args.coversId) {
      const target = nodeById(base, args.coversId);
      if (!target) {
        errors.push(`add_section: the content to cover ('${args.coversId}') does not exist in the draft.`);
      } else if (isDocumentLayer(target)) {
        errors.push(`add_section: '${args.coversId}' is itself part of the document layer. A section covers CURRICULUM — a chapter/week or a lesson.`);
      }
    }

    if (nodeById(base, args.newNodeId)) {
      errors.push(`add_section: minted id '${args.newNodeId}' already exists (retry).`);
    }
    return { errors, warnings: [] };
  },

  apply: (base, args) => {
    if (!nodeById(base, args.documentId)) return base;
    if (args.coversId && !nodeById(base, args.coversId)) return base;

    const withSection = addNode.apply(base, {
      namespace: args.namespace,
      label: SECTION_LABEL,
      parentId: args.documentId,
      newNodeId: args.newNodeId,
      title: args.name,
      position: args.position,
      properties: args.properties,
    });
    // No coversId = front matter (a cover page, a table of contents). That is the
    // ONE legitimate way a section covers nothing, and the reader treats an empty
    // `covers` exactly so.
    return args.coversId ? linkCovers(withSection, args.newNodeId, args.coversId, args.namespace) : withSection;
  },
};
