# tlm-autorat — plugin for the TLM authoring server

Procedures for authoring teaching materials against the **Senegal Maths — TLM** MCP server.

## Installing it

In **Cowork**: Customize → Plugins → add this repository, then install `tlm-autorat`.

In **Claude Code** (including the Code tab of the Claude desktop app), two commands:

```
/plugin marketplace add IDinsight/tlm-authoring-mcp
/plugin install tlm-autorat@tlm-authoring-mcp
```

Then `/mcp` once, to sign in.

The marketplace is named after the repository, `tlm-authoring-mcp`, on purpose: the desktop app
refreshes a marketplace by its repository name, and a manifest name that differed (`idinsight-tlm`,
until 2026-09-13) made every "check for updates" fail with NOT_REGISTERED. An install made under the
old name must be removed and added again once.

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

The five sub-agents here — `lecteur`, `illustrateur`, `relecteur`, `mesureur`, `terminologue` — are not decoration.
`lecteur` exists because a bulk read costing ~184,000 tokens in the main thread returns ~2,000 from
a sub-agent. An author in plain chat gets the skills and loses that, so **Cowork is the home for
this plugin**, and Claude Code is the equivalent for anyone working in a terminal.

In Cowork an author installs it under **Customize → Plugins** (browse, add this GitHub repo, or
upload a plugin file); on Team and Enterprise plans an admin can install it for everyone instead.
In Claude Code it is the two commands above.

Neither server is a candidate for a `.mcpb` desktop extension: that format packages a LOCAL server,
and both of these are remote.

### In other tools: Codex, Antigravity, and the ones that take the server alone

The same folder installs outside Claude, in the two tools that have a plugin format. The skills are shared as they are; each tool reads its own
manifest and server list, and `check-manifests.sh` keeps those copies in step.

| | reads | gets | does not get |
|---|---|---|---|
| **Codex** | `.claude-plugin/` (Claude's, accepted as is), `.mcp.json` | the 9 skills, both servers, the 4 commands that take no arguments | the 8 commands with arguments (their skills cover them), the agents |
| **Antigravity** | `.antigravity-plugin/plugin.json`, `mcp_config.json` | the 9 skills, both servers | `commands/` (its docs say skills replace them) |

**Codex** — verified on 2026-11-24 with codex-cli 0.172, installed from this GitHub repository and
from a local copy, and signed in to `tlm`. What was not run is a model calling a tool through it:
that needs the author's own OpenAI or ChatGPT account, which Codex requires to run at all.

```
codex plugin marketplace add IDinsight/tlm-authoring-mcp
codex plugin add tlm-autorat@tlm-authoring-mcp
codex mcp login tlm
codex mcp login nano-banana
```

For the server without the plugin: `codex mcp add tlm --url <address>`, then the same login.

**Antigravity** — built from its documentation, **not yet installed on a real copy.** Install it
from this repository in the app's plugin manager, or place the `plugin/` folder under
`~/.gemini/config/plugins/`. It signs in to each server in the browser the first time the server
connects. The `agents/` folder is the open question: Antigravity reads that folder, but its agents
name models and tools differently (`flash` and `view_file` where these say `haiku` and `Read`), and
whether it ignores, loads or refuses these five has not been seen.

Where a tool runs none of the agents, the skills say to do the same file work in the main thread
(`session-autorat`, "When your tool has no such helper"). That costs tokens the agent would have
saved, so the session announces it up front.

**Gemini CLI** is not packaged. Google no longer lets a personal account sign in to it, so it only
serves someone with a Gemini API key or a Google Cloud project, and they can add the server by hand:
`gemini mcp add --scope user --transport http tlm https://senegal-mohebs-tlm-148764688487.europe-west1.run.app/mcp`,
then `/mcp auth tlm` inside a session.

**ChatGPT and the Gemini app** are not packaged, and neither has been run by us. The route the
user guide gives (*Getting started*, one tab per assistant) hands each of them the server address
and nothing else, so an author there gets the tools and none of these procedures.

ChatGPT has a second route, for a workspace admin: Admin Console → Plugins → Add → Import
marketplace, with this repository as the source. OpenAI's help page lists
`.claude-plugin/marketplace.json` among the layouts it accepts, which is the one at this
repository's root. Untried: what it does with `commands/` and `agents/` is not documented, and it
labels a plugin that declares servers in `.mcp.json` as desktop only.

Either way, ChatGPT's own documentation says a tool that does not declare itself read-only is
treated as a write and asks for confirmation. Every tool of the server now declares whether it
only reads, so by that documentation a simple read should go through unprompted and only a
change should ask. A ChatGPT plan limited to reading should then be able to browse the
curriculum, though still not to edit it. None of this has been seen on a real ChatGPT yet.

**Unverified:** the twelve entries under `commands/` are the older flat-file form of a skill — Claude
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

Three capabilities, and the skills that serve each. The source of a proposal — the expert's words,
a search of the graph, a file — changes only its first step; the write procedure after it is one,
in `session-autorat` (« Proposer, puis écrire »).

| capability | skill | when it applies |
|---|---|---|
| always | `session-autorat` | session discipline, the shared write procedure, two-phase writes, never asking for an id |
| build the curriculum | `construire-le-programme` | standards, components, the course, lessons, groupings — from scratch or evolving |
| create documents | `composer-un-document` | a book or a guide: what it covers, its formatter, its grids, its sections, its journal |
| create documents | `produire-et-mesurer` | produce one file and check it fits |
| create documents | `produire-une-lecon` | every file a lesson owes, only what is stale, a delivery note (the review is `evaluer`) |
| create documents | `illustrations` | build and verify a lesson's illustration dossier |
| create documents | `reprendre-corrections` | an expert hands back a corrected `.docx` |
| evaluate | `evaluer` | one review of a document or draft: wiring, coverage, contradictions, grids, render |
| evaluate | `publier` | hand the draft over, on explicit consent |

Not covered yet, by decision: evaluating a curriculum against a grid (a grid attaches to a document
only). One seam the skills mark rather than hide: importing a whole foreign curriculum is a server-side
script, not a tool.

## Subagents

Five, each returning **a structure, not a narrative** — `lecteur`, `mesureur`, `relecteur`,
`illustrateur`, `terminologue`. This is where the token saving is: reading the 18 project notes cost 184,000 tokens
inside a subagent and returned about 2,000 to the main thread. Route every bulk read this way.

## Commands

`/ou-en-suis-je` · `/construire` · `/composer` · `/evaluer` · `/reprendre-corrections` ·
`/produire` · `/lecon` · `/mesurer` · `/relire` · `/publier` · `/nouveau-cours` · `/decisions`

`/nouveau-cours` and `/relire` are kept for habit; they point at `construire-le-programme` +
`composer-un-document` and at `evaluer`.

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
./check-manifests.sh       # the Claude and Antigravity manifests and server lists agree
```

CI runs the last two on every pull request. `check-no-rules.sh` stays a manual check, because each
hit needs a person's judgement (it already reports six hits on `main`).

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

## What the server covers now

The two seams this section once listed are closed: `render_document` lays out a block tree and
counts its pages (`measure:true`), and `lint_content` checks both the graph's statements and a
composed page against it. The seams that remain are the two named under *Skills* above.
