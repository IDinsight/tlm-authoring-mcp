/*
 * Recipe: attach_image
 *
 * A picture becomes a canonical `Material` node under the Lesson or Activity
 * it illustrates (docs/design-notes/illustrations-as-materials.md), and every
 * field it needs is one Learning Commons already defines:
 *
 *   • `identifier` — the file's URI. LC says an identifier is "a string or a
 *     URI"; for a picture it IS the locator (gs://bucket/key), so the graph says
 *     where the bytes are with no field of our own.
 *   • `content` — WHAT THE PICTURE SHOWS, in words, beside the activity's own
 *     text. Two wrong answer keys reached production because the words and the
 *     picture each made sense and disagreed, and nothing in the graph could say
 *     what the picture meant. Now a reviewer can read both.
 *   • `name` — what a page calls it when it places it.
 *   • `materialType: "Supporting"` — it supports the activity's text.
 *
 * No sidecar. A new version of a picture is a new file, hence a new URI, hence
 * a new node (attach again, retire the old one); approval is what publishing
 * the draft means, the same as for any authored text.
 *
 * Why a task verb (self-serve-authoring.md, the D3 test): the invariant is that
 * the node points at a file that EXISTS. An `add_nodes` with a mistyped path is a
 * valid write and a picture that never renders; the tool layer checks the bucket
 * and this recipe checks the graph, and neither half is enough alone.
 */

import type { GraphMutation, MutationNode } from "../kg-store/index.js";
import { parseDocumentObjectUri } from "../context/index.js";
import { imageMimeFor } from "../utils/index.js";
import { addNode } from "./add-node.js";
import { RecipeCommon, nodeById } from "./shared.js";

const MATERIAL_LABEL = "Material";

/** The LC content nodes a picture may illustrate. */
const ILLUSTRATABLE_LABELS = new Set(["Lesson", "Activity"]);

const labelsOf = (node: MutationNode | undefined): string[] => node?.labels ?? [];
const rawOf = (node: MutationNode): Record<string, any> => (node.properties?.raw as Record<string, any>) ?? {};

/**
 * The file URI of a stored picture node, or null when the node is not one — a
 * `Material` whose `identifier` is an object URI naming an image file. A routine
 * step or a formatter spec is a Material too, with its node id as identifier,
 * and this is what keeps them apart.
 */
export function pictureUriOf(node: MutationNode): string | null {
  if (!labelsOf(node).includes(MATERIAL_LABEL)) return null;
  const identifier = rawOf(node).identifier;
  if (typeof identifier !== "string" || !parseDocumentObjectUri(identifier) || !imageMimeFor(identifier)) return null;
  return identifier;
}

/** The name a page uses to place this picture (the LC `name`, else the title). */
export function pictureNameOf(node: MutationNode): string {
  const raw = rawOf(node);
  const name = raw.name ?? raw.description;
  return typeof name === "string" ? name.split("\n")[0].trim() : "";
}

// The pictures already hanging under a parent — so a second one cannot take a
// name the page would then find twice.
function picturesUnder(graph: { nodes: MutationNode[]; edges: { type: string; from: string; to: string }[] }, parentId: string): MutationNode[] {
  const childIds = new Set(graph.edges.filter((edge) => edge.type === "hasPart" && edge.from === parentId).map((edge) => edge.to));
  return graph.nodes.filter((node) => childIds.has(node.id) && pictureUriOf(node) !== null);
}

export type AttachImageArgs = RecipeCommon & {
  newNodeId: string;                      // minted by the tool layer
  parentId: string;                       // the Lesson or Activity it illustrates (already resolved from a name)
  name: string;                           // what a page calls it in an image run's `media`
  description: string;                    // what the picture shows — the Material's `content`
  uri: string;                            // the file's object URI, formed by the tool layer once the file is known to exist
  position?: number;
};

export const attachImage: GraphMutation<AttachImageArgs> = {
  name: "attachImage",
  describe: (args) => `attach the picture '${args.name}' (${args.uri}) to '${args.parentId}'`,

  validate: (base, _after, args) => {
    const errors: string[] = [];
    const required: Array<[keyof AttachImageArgs, string]> = [
      ["name", "the name a page will place it by"],
      ["description", "what the picture shows, in words — that is what lets text and image be checked against each other"],
      ["uri", "the file's object URI"],
    ];
    for (const [key, why] of required) {
      const value = args[key];
      if (typeof value !== "string" || value.trim().length === 0) {
        errors.push(`attach_image: '${key}' is required — ${why}.`);
      }
    }

    const parent = nodeById(base, args.parentId);
    if (!parent) {
      errors.push(`attach_image: '${args.parentId}' does not exist in the draft.`);
    } else if (!labelsOf(parent).some((label) => ILLUSTRATABLE_LABELS.has(label))) {
      errors.push(`attach_image: '${args.parentId}' is a ${labelsOf(parent).join(", ") || "node"}, not a Lesson or an Activity. A picture illustrates the lesson or the activity it belongs to; a section then places it on the page.`);
    } else {
      const taken = picturesUnder(base, args.parentId).find((node) => pictureNameOf(node) === args.name);
      if (taken) {
        errors.push(`attach_image: '${args.parentId}' already has a picture named '${args.name}' (${taken.id}). A page places pictures by name, so two with one name would be one picture; give this one another name, or retire the existing node first.`);
      }
    }

    if (nodeById(base, args.newNodeId)) {
      errors.push(`attach_image: minted id '${args.newNodeId}' already exists (retry).`);
    }
    return { errors, warnings: [] };
  },

  apply: (base, args) => {
    // apply() runs before validate() on the dry-run: a bad parent leaves the
    // graph untouched so validate can block it cleanly.
    if (!nodeById(base, args.parentId)) return base;

    return addNode.apply(base, {
      namespace: args.namespace,
      label: MATERIAL_LABEL,
      parentId: args.parentId,
      newNodeId: args.newNodeId,
      title: args.name,
      position: args.position,
      properties: {
        // Written last, so it overrides the node-id default every created node
        // gets: for a picture the identifier is the file, per LC's own "string
        // or URI".
        identifier: args.uri,
        name: args.name,
        content: args.description,
        materialType: "Supporting",
      },
    });
  },
};
