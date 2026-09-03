/*
 * Recipe: edit_nodes (batched)
 *
 * Edit MANY nodes in one atomic draft edit — the batch form of the single-node
 * edit-node recipe, so a bulk pass (retitling 23 weeks, stamping the same
 * `properties` across a run of lessons, pasting rewritten content into a dozen
 * steps) is one dry-run + one confirm instead of dozens of round-trips. Every
 * item runs the exact same single-node `editNode.validate` / `editNode.apply`,
 * folded over an accumulating graph, so the whole batch is ONE mutation → one
 * diff → one confirmation token → one apply audit record — the shape add_nodes
 * and create_edges already use.
 *
 * Each item carries its OWN field values, so a batch can retitle one node and
 * rewrite another's content; applying the identical edit to N nodes is the same
 * fields repeated per item.
 *
 * SCOPE: each item edits an EXISTING node's fields in place. Two items may not
 * name the same node — the second would silently overwrite the first's overlapping
 * fields, and the diff would show only the winner; merge them into one item.
 */

import type { GraphMutation } from "../kg-store/index.js";
import { editNode, type EditNodeArgs } from "./edit-node.js";
import { RecipeCommon } from "./shared.js";

// One node to edit — the same fields the single-node recipe takes, minus the
// namespace (shared across the batch). Every field is optional; at least one set.
export type EditNodesItem = {
  nodeId: string;
  content?: string;
  position?: number;
  title?: string;
  body?: string;
  title_en?: string;
  summary?: string;
  properties?: Record<string, unknown>;
};

export type EditNodesArgs = RecipeCommon & { items: EditNodesItem[] };

// Map one batch item onto the single-node recipe's args, threading the shared
// namespace. Field-for-field what the single-node tool used to build.
function toEditNodeArgs(item: EditNodesItem, namespace: string): EditNodeArgs {
  return {
    namespace,
    nodeId: item.nodeId,
    content: item.content,
    position: item.position,
    title: item.title,
    body: item.body,
    title_en: item.title_en,
    summary: item.summary,
    properties: item.properties,
  };
}

// The single-node recipe prefixes its own messages with the tool name; inside a
// batch the item index already says where the problem is, so drop the prefix
// rather than emit "edit_nodes[0]: edit_nodes: …".
const withoutToolPrefix = (message: string): string => message.replace(/^edit_nodes: /, "");

export const editNodes: GraphMutation<EditNodesArgs> = {
  name: "editNodes",
  describe: (args) => `edit ${args.items.length} node(s) in one batch`,

  // Validate every item and collect ALL failures — the framework blocks the whole
  // batch on any error (no token, no partial apply), so the caller fixes them in
  // one pass. Each item is checked against `base`: an edit never creates a node,
  // so no item can make another item's target exist.
  validate: (base, _after, args) => {
    const errors: string[] = [];
    if (!Array.isArray(args.items) || args.items.length === 0) {
      errors.push("edit_nodes: 'items' must be a non-empty array.");
      return { errors, warnings: [] };
    }

    const seenNodeIds = new Set<string>();
    args.items.forEach((item, index) => {
      const where = `edit_nodes[${index}]`;

      if (typeof item.nodeId !== "string" || item.nodeId.length === 0) {
        errors.push(`${where}: 'nodeId' is required.`);
      } else if (seenNodeIds.has(item.nodeId)) {
        errors.push(`${where}: node '${item.nodeId}' is edited twice in this batch — merge both items into one (every field of a node is set in a single item).`);
      } else {
        seenNodeIds.add(item.nodeId);
      }

      const single = editNode.validate!(base, base, toEditNodeArgs(item, args.namespace));
      for (const message of single.errors) {
        errors.push(`${where}: ${withoutToolPrefix(message)}`);
      }
    });

    return { errors, warnings: [] };
  },

  // Fold each item through the SAME single-node apply, over an accumulating
  // graph. An item naming a node that does not exist leaves the graph unchanged
  // (editNode.apply guards it), and validate then blocks the whole batch.
  apply: (base, args) => {
    let graph = base;
    for (const item of args.items) {
      graph = editNode.apply(graph, toEditNodeArgs(item, args.namespace));
    }
    return graph;
  },
};
