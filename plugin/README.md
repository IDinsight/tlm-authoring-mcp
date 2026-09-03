# tlm-autorat — plugin for the TLM authoring server

Procedures for authoring teaching materials against the **Senegal Maths — TLM** MCP server.

## Installing it

In **Cowork**: Customize → Plugins → add this repository, then install `tlm-autorat`.

In **Claude Code** (including the Code tab of the Claude desktop app), two commands:

```
/plugin marketplace add IDinsight/tlm-authoring-mcp
/plugin install tlm-autorat@idinsight-tlm
```

Then `/mcp` once, to sign in.

**The plugin brings its own servers.** `.mcp.json` declares the two this procedure assumes, so an
author configures nothing by hand:

| server | what it is for |
|---|---|
| `tlm` | the authoring server — the graph, the catalog, the renderer, the documents bucket |
| `nano-banana` | image generation, which the `illustrations` skill and the `illustrateur` agent need |

Both are remote and both authenticate by OAuth discovery, so no key or secret is stored anywhere in
this repo. Installing the plugin does add both servers to the author's Claude — say so when you
hand it to someone, rather than letting them discover it in `/mcp`.

### Where it runs, and what runs there

A plugin installs in **Cowork**, in chat on the web, in the Chat tab of Claude Desktop, and in
Claude Code. What it can DO differs by surface, and this plugin leans on the part that does not
travel:

| | skills | sub-agents |
|---|---|---|
| **Cowork** | yes | **yes** |
| chat (web, desktop Chat tab) | yes | greyed out |
| Claude Code | yes | yes |

The four sub-agents here — `lecteur`, `illustrateur`, `relecteur`, `mesureur` — are not decoration.
`lecteur` exists because a bulk read costing ~184,000 tokens in the main thread returns ~2,000 from
a sub-agent. An author in plain chat gets the skills and loses that, so **Cowork is the home for
this plugin**, and Claude Code is the equivalent for anyone working in a terminal.

In Cowork an author installs it under **Customize → Plugins** (browse, add this GitHub repo, or
upload a plugin file); on Team and Enterprise plans an admin can install it for everyone instead.
In Claude Code it is the two commands above.

Neither server is a candidate for a `.mcpb` desktop extension: that format packages a LOCAL server,
and both of these are remote.

**Unverified:** the eight entries under `commands/` are the older flat-file form of a skill — Claude
Code reads them as skills and its own docs say to use `skills/` for new plugins. Whether Cowork
surfaces them the same way has not been checked on a real install.

## What is in here, and what is deliberately not

This plugin carries **procedure**: which tool to call, in what order, what to check before
confirming, when to stop and ask. It carries **no pedagogy**. Nothing here says how long a step
should last, how a lesson is structured, what a bullet may contain, or which characters a scene may
use — because on 1 September 2026 the same five lessons were reauthored three times in one day as
conventions were adopted, revoked and restored. A rule copied into a skill file becomes a stale
fourth copy of itself.

Every rule is fetched at runtime:

| what you need | where it comes from |
|---|---|
| the subject's conventions, vocabulary and coverage expectations | `get_graph_guide` |
| reusable routines, house styles, evaluation grids | `list_catalog` → `get_catalog_entry` |
| how a specific document must be laid out | its formatter, via `walk_document_section` |
| what this document is judged against | its rubrics, via `evaluate_document` |
| what you personally may do right now | `get_capabilities` |

**This is a checkable property, not an aspiration.** A skill file containing a pedagogical rule is
a defect. See `CONTRIBUTING.md` for the grep that catches it.

## Skills

| skill | when it applies |
|---|---|
| `session-autorat` | always — session discipline, two-phase writes, never asking for an id |
| `reprendre-corrections` | an expert hands back a corrected `.docx` |
| `produire-et-mesurer` | produce a sheet and check it fits |
| `illustrations` | build and verify a lesson's illustration dossier |
| `relire-et-publier` | review a draft and hand it to an approver |
| `nouveau-cours` | build a course from nothing |

## Subagents

Four, each returning **a structure, not a narrative** — `lecteur`, `mesureur`, `relecteur`,
`illustrateur`. This is where the token saving is: reading the 18 project notes cost 184,000 tokens
inside a subagent and returned about 2,000 to the main thread. Route every bulk read this way.

## Commands

`/ou-en-suis-je` · `/reprendre-corrections` · `/produire` · `/mesurer` · `/relire` · `/publier` ·
`/nouveau-cours` · `/decisions`

## Relationship to the server's own prompts

The MCP server publishes four French workflow prompts of its own — `creer-document`,
`appliquer-style`, `creer-routine`, `preparer-relecture` — which a connector client shows as a menu.
They are the entry point for someone who opens the connector cold, with no plugin installed, and
they are written in the expert's voice because a prompt *is* the user's first turn.

This plugin's commands are for someone working in Claude Code, and they instruct the assistant
rather than speak as the user. The two overlap in one place: **`/relire` and `preparer-relecture` do
the same job.** That is tolerable while both are thin, and worth collapsing if either grows.

`appliquer-style` and `creer-routine` have no command here on purpose — they are single actions that
`session-autorat` already covers, not procedures with an order to get right.

## Checks

```
./check-no-rules.sh        # no pedagogical rule leaked into a procedure file
./check-tools-exist.sh     # every tool named here is one the server registers
```

The second one matters more than it looks: a procedure that calls a tool which does not exist fails
mid-task, in front of an expert. It also prints the **seams** — tools named here that do not exist
yet (`generate_document`, `measure_document`, `lint_content`) — so the list of what WP4 and WP5 owe
this plugin stays visible.

## Server version

These procedures assume the response projections from **PR #219** (`list_catalog` with
`detail`/`kind`/`scope`/`limit`, `get_capabilities` with `section`, `find_node` with `queries`).
Against an older server those arguments are ignored or rejected, and `list_catalog` returns the
whole library — about 63,000 characters, which will overflow the response. If that happens, the
server predates the projection: read single entries with `get_catalog_entry` instead.

## Two things this plugin cannot do yet

- **Rendering.** The server has no `generate_document`; producing a `.docx` still happens outside
  it. `produire-et-mesurer` and `illustrations` describe the loop and mark the seam — they cannot
  close it. That is WP4.
- **Content linting.** `relire-et-publier` calls `check_draft` (wiring) and `review_draft`
  (coverage). `lint_content` does not exist yet. That is WP5.
