/*
 * kg-recipes · recipe registry (the get_capabilities mirror)
 *
 * One descriptor per GENERIC verb. get_capabilities renders THIS array, never a
 * hand-written copy — so the tool list Claude sees can't drift from the verbs
 * actually wired up. Node CREATION is add_nodes (server/authoring.ts); the two
 * verbs here act on nodes that already exist — edit_nodes for their FIELDS
 * (content/position/title are the same concept for every label), move_node for
 * one node's PLACE.
 *
 * A verb belongs here only once it is REGISTERED as a tool in server/recipes.ts:
 * this array is what get_capabilities advertises, so an entry for an unwired
 * recipe would be the exact drift the mirror exists to prevent.
 */

export type RecipeParam = { name: string; required: boolean; note?: string };
export type RecipeDescriptor = {
  name: string;
  summary: string;
  params: RecipeParam[];
};

export const RECIPES: readonly RecipeDescriptor[] = [
  {
    name: "edit_nodes",
    summary: "Edit one node's fields or MANY nodes' in one atomic draft edit (it replaced the single-node edit_node). Each `items[i]` names a `nodeId` and its own values: content (canonical LC Material.content), position (ordinal among siblings — never cascades), title (the display NAME — a single line; the text below it is kept), body (everything BELOW that name line, where a node has one — an empty string removes it), title_en (English mirror), summary (a routine/formatter's cross-cutting blurb → raw.metadata.summary), and/or properties (a freeform bag amending any other canonical LC prop → raw.<key>, e.g. metadata.assemblyGuide). Each item needs at least one field; a node may appear only once per batch. All-or-nothing: any item error blocks the whole batch.",
    params: [
      { name: "items", required: true, note: "one entry per node: { nodeId, content?, position?, title?, body?, title_en?, summary?, properties? }" },
      { name: "items[].nodeId", required: true },
      { name: "items[].content", required: false },
      { name: "items[].position", required: false },
      { name: "items[].title", required: false, note: "the display NAME — a single line; a multi-line value is refused, pass the rest as body" },
      { name: "items[].body", required: false, note: "the text BELOW the name line of `description` (a routine step's script, a catalog entry's prose); \"\" removes it" },
      { name: "items[].title_en", required: false },
      { name: "items[].summary", required: false },
      { name: "items[].properties", required: false, note: "amend any other canonical LC prop → raw.<key>; refuses identity + mirrored paths (use position/title/body/content for those)" },
    ],
  },
  {
    name: "move_node",
    summary: "Re-parent a node in one atomic draft edit: detach it from its current parent(s) on ONE containment axis, attach it under the new parent, set its ordinal there. There are two containment axes — hasPart (content) and hasChild (standards) — and the axis is read off the graph, whichever the node actually hangs from, so a node's OTHER axis is left intact (a CI-maths lesson keeps its week when it moves chapter). Never cascades: the node's own children travel with it. Refuses a target parent that sits inside the node (that would detach the subtree from the graph) and warns when the node has several parents on the axis, since all of them are detached.",
    params: [
      { name: "nodeId", required: true },
      { name: "toParentId", required: true },
      { name: "via", required: false, note: "which containment axis to move along — hasPart or hasChild ONLY; defaults to the one the node hangs from (its label's canonical edge when it hangs from both). An alignment/reference edge is refused: detaching one would delete relationships, not move a node" },
      { name: "position", required: false, note: "ordinal among the new siblings; omit to append" },
    ],
  },
];
