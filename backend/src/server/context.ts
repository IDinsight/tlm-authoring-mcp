/*
 * Module: server · tool group: teaching context
 *
 * Choosing the active workspace + grade + subject. These are the only tools that
 * work with no context set (they're how you set it), so they are not wrapped in
 * guarded().
 *
 * Workspace ENTRY is the read-isolation gate (see docs/design-notes/workspaces.md):
 * a signed-in caller may only set_context into a workspace they hold a role in
 * (or are a super admin over). Unknown actors — only reachable with auth
 * disabled, i.e. local dev — are let through, preserving the permissive
 * unknown-actor policy. Once inside, reads/generation stay ungated.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { asJson } from "./shared.js";
import { activateContext } from "../activate.js";
import { getActiveContext, listAvailableContexts } from "../context/index.js";
import { currentActor } from "../actor.js";
import { effectiveRole } from "../authz.js";
import { slug } from "../utils/index.js";

// Contexts the caller may enter: ALL of them. The published curriculum graph is
// open — the same graphs are served anonymously by the public KG explorer, so
// filtering this list only hid options without protecting anything. Membership
// still decides what you can DO once inside (edit the graph, reach the
// documents bucket, translate); it no longer decides where you can stand.
export function accessibleContexts() {
  return listAvailableContexts();
}

export function registerContextTools(server: McpServer) {
  server.registerTool("set_context", { title: "Set workspace, grade & subject", description: "Choose the workspace (e.g. 'senegal'), grade (e.g. 'ci') and subject (e.g. 'maths') to work on. This selects which sources load and which Firebase namespace documents and history live under, and MUST be set before any other tool. Anyone signed in may enter any workspace and read its published curriculum; a ROLE in the workspace is what unlocks editing, its documents, and translation (the response says which you have). If you don't know which to use, call get_context (or list_workspaces) to list your options, then ask the user.", inputSchema: { workspace: z.string(), grade: z.string(), subject: z.string() } },
    async (a) => {
      const r = await activateContext(a.workspace, a.grade, a.subject);
      if (!r.ok) return asJson(r);
      // Entering is open, but say plainly what this caller can do here, so a
      // non-member learns it now rather than from a refusal three tools later.
      const role = effectiveRole(currentActor(), slug(a.workspace)) ?? null;
      return asJson({
        ok: true,
        active: r.context,
        role,
        ...(role ? {} : { note: `You can read this workspace's published curriculum, but you are not a member of '${a.workspace}' — editing the graph, reaching its documents, and translation all need a role. Ask a workspace admin for one.` }),
        available: accessibleContexts(),
      });
    });

  server.registerTool("get_context", { title: "Get active context", description: "Return the currently selected workspace/grade/subject (null if none is set yet) and every workspace/grade/subject option available. Use this to discover what's available, then set_context.", inputSchema: {} },
    async () => asJson({ active: getActiveContext(), available: accessibleContexts() }));
}
