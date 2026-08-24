/*
 * Recipe: move_node (generic)
 *
 * Re-parent a node along ONE containment axis: detach its current parent edge(s)
 * on that axis, attach the new parent, set its position. One atomic composite.
 * Only that axis moves — e.g. a maths lesson lives under both a chapter (hasPart)
 * and a week (hasChild), and moving it to another chapter leaves the week untouched.
 *
 * Three things it refuses, because each turns "move" into something else:
 *   • a `via` that is not a containment edge — apply() detaches EVERY edge of the
 *     named type pointing at the node, so `via:"hasEducationalAlignment"` on a
 *     standard would strip every lesson's alignment to it and report a move;
 *   • a target parent that sits INSIDE the node — that cuts the subtree out of the
 *     graph and leaves it pointing at itself, invisible to generation;
 *   • an axis the node has no parent on — the caller meant the other one.
 */

import { linkNodes, unlinkNodes, type GraphMutation, type MutationGraph, type MutationNode } from "../kg-store/index.js";
import { RecipeCommon, containmentDescendants, nextPosition, nodeById, parentEdgeIds, setPosition } from "./shared.js";
import { CONTAINMENT_EDGES, containmentEdgeFor } from "./lc.js";

export type MoveNodeArgs = RecipeCommon & {
  nodeId: string;
  toParentId: string;
  via?: string;          // containment-edge axis; defaults to the axis the node hangs from
  position?: number;     // within-target order; defaults to appending
};

const labelOf = (node: { labels?: string[] } | undefined): string => node?.labels?.[0] ?? "";

const axesList = [...CONTAINMENT_EDGES].join(" or ");

/*
 * The axis this move runs along, read off the GRAPH rather than the label alone.
 * A node hangs from whichever containment edge its source actually used, and
 * containmentEdgeFor answers a different question — which edge a NEW node of this
 * label gets attached by. For a LearningComponent that answer is `supports`, which
 * points component→SFI and is therefore never an incoming parent edge, so the
 * label alone would send every derived component down a dead end; its real parent
 * edge is the `hasChild` from its frame.
 *
 * So: an explicit `via` wins; else the one containment axis the node actually
 * hangs from; else — a node on BOTH axes, the two-parent maths lesson — its
 * label's canonical edge, so a plain move re-files without rescheduling.
 */
function resolveAxis(graph: MutationGraph, node: MutationNode, via?: string): string {
  if (via) return via;
  const attached = [...CONTAINMENT_EDGES].filter((edge) => parentEdgeIds(graph, node.id, edge).length > 0);
  return attached.length === 1 ? attached[0] : containmentEdgeFor(labelOf(node));
}

export const moveNode: GraphMutation<MoveNodeArgs> = {
  name: "moveNode",
  describe: (args) => `move '${args.nodeId}' under '${args.toParentId}'`,
  validate: (base, _after, args) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const node = nodeById(base, args.nodeId);
    const parent = nodeById(base, args.toParentId);

    if (!node) errors.push(`move_node: node '${args.nodeId}' does not exist in the draft.`);
    if (!parent) errors.push(`move_node: target parent '${args.toParentId}' does not exist in the draft.`);
    if (args.nodeId === args.toParentId) errors.push(`move_node: a node cannot be its own parent.`);

    // A non-containment `via` is not a slower way to do this — it is a different,
    // destructive operation wearing this verb's name (see the header).
    const viaIsLegal = !args.via || CONTAINMENT_EDGES.has(args.via);
    if (!viaIsLegal) {
      errors.push(`move_node: 'via' must be a containment edge (${axesList}), not '${args.via}' — that edge means alignment or reference, not membership, and detaching it would delete relationships rather than move anything. Use delete_edges + create_edges to rewire it.`);
    }

    if (node && viaIsLegal) {
      const edgeType = resolveAxis(base, node, args.via);
      const parentEdges = parentEdgeIds(base, args.nodeId, edgeType);

      if (parentEdges.length === 0) {
        errors.push(`move_node: '${args.nodeId}' has no '${edgeType}' parent to move from (a node is contained by ${axesList}; pass 'via' to name the one you mean).`);
      }
      // Legitimate — a node may hang from two parents on one axis — but rarely
      // what someone re-filing ONE thing intends, and the diff alone reads as an
      // ordinary move. Name every parent that goes, before the confirm.
      if (parentEdges.length > 1) {
        warnings.push(`move_node: '${args.nodeId}' has ${parentEdges.length} '${edgeType}' parents and ALL of them are detached by this move: ${parentEdges.join(", ")}. If you meant to re-file it under one of them only, use delete_edges + create_edges instead.`);
      }
      // Moving a node under its own descendant detaches the subtree from the rest
      // of the graph and leaves it in a ring — reachable from nothing, so
      // generation silently drops it while the diff shows one edge in, one out.
      if (parent && containmentDescendants(base, args.nodeId, CONTAINMENT_EDGES).has(args.toParentId)) {
        errors.push(`move_node: '${args.toParentId}' sits INSIDE '${args.nodeId}', so moving it there would cut the whole subtree out of the graph and leave it pointing at itself (nothing would reach it, including generation). Move '${args.toParentId}' out first, or pick a parent outside the subtree.`);
      }
    }
    return { errors, warnings };
  },
  apply: (base, args) => {
    const node = nodeById(base, args.nodeId);
    const parent = nodeById(base, args.toParentId);
    if (!node || !parent) return base;

    const edgeType = resolveAxis(base, node, args.via);

    // Detach the node from every current parent on this axis before re-attaching.
    let graph = base;
    for (const edgeId of parentEdgeIds(graph, args.nodeId, edgeType)) {
      graph = unlinkNodes.apply(graph, { edgeId });
    }

    // Attach it under the new parent, appending unless a position was given.
    const position = args.position ?? nextPosition(graph, args.toParentId, edgeType);
    graph = linkNodes.apply(graph, {
      edgeType,
      fromId: args.toParentId,
      toId: args.nodeId,
      properties: { orderInParent: position },
      namespace: args.namespace,
    });

    // Keep the node's own POSITION field consistent with its new slot.
    const repositionedNodes = setPosition(graph.nodes, args.nodeId, position);
    graph = { nodes: repositionedNodes, edges: graph.edges };
    return graph;
  },
};
