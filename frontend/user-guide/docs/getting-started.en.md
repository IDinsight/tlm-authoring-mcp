# Getting started

Four steps before you can work: **get access**, **connect the tool to Claude**, **sign in**, then **choose where you work**. Allow about ten minutes the first time, and none after that.

## 1. Get access

There are three ways in, depending on your situation.

- **Your organisation has opened access to its domain.** If your work address belongs to an authorised domain and you sign in **with Google**, you get your role automatically the first time you sign in. There is nothing to request.
- **You have been invited.** An administrator has registered your **email address** with a role. Create your account with that exact address (or sign in with Google if it is a Google address). The invitation is recognised the first time you sign in.
- **Neither.** Write to the workspace administrator and give them your email address. They will send you an invitation.

!!! info "Without a role, you can already read"
    Any signed-in user can look at the published curricula. You need a role for the workspace's **documents** (downloading them, producing them), for **translation**, and for any **change** to the curriculum.

## 2. Connect the tool to Claude

You have two options. The first is recommended.

### Install the authoring plugin (recommended)

The *tlm-autorat* plugin brings **the connector and the procedures** in a single install. Claude then knows in what order to work, what to check before writing, and when to stop and ask you.

- **In Cowork**: go to *Customize → Plugins*, add the repository `IDinsight/tlm-authoring-mcp`, then install **tlm-autorat**. On Team and Enterprise plans, an administrator can install it for everyone.
- **In Claude Code** (including the Code tab of the desktop app), type these two lines, one after the other:

```text
/plugin marketplace add IDinsight/tlm-authoring-mcp
```

```text
/plugin install tlm-autorat@tlm-authoring-mcp
```

The plugin also installs a second connector for **image generation**. It is only used when you work on illustrations.

!!! tip "Cowork works best"
    The plugin relies on specialised assistants (a reader, a reviewer, a measurer…) that do the long reads on their own and report back only the conclusion. They run in **Cowork** and **Claude Code**, but not in the plain web chat. The plugin still works there, just more slowly.

### Or: the connector on its own

If you don't install the plugin, add the **"Teaching & Learning Materials authoring"** connector in Claude's connector settings. If your organisation doesn't offer it, add a **custom connector** with the address your administrator gives you (it ends in `/mcp`). Everything works, but Claude will know the procedures less well.

## 3. Sign in

The first time you use the tool, a sign-in page opens. Choose **Continue with Google**, or enter your account's email and password. You won't have to do this every time.

In Claude Code, you start the sign-in with the `/mcp` command.

## 4. Check that everything is connected

Send a simple message:

> "What can I do?"

If Claude's answer draws on the tool (naming your roles and your workspaces), everything works. If it answers "from memory", check that the connector is **turned on for this conversation** (the tools menu under the message box), then ask for it explicitly:

> "Use the TLM tool to tell me what I can do."

The first time Claude calls a tool, it asks for your permission. Accept: this is normal.

## 5. Choose where you work

Your work is always framed by three things:

- a **workspace** — the curriculum of one organisation or country. This is what determines your role;
- a **grade** and a **subject** inside that workspace. You work on one at a time.

> "Which workspaces and subjects are available?"

Then tell Claude where to go, naming the workspace, grade and subject exactly as it listed them:

> "Let's work on first-year mathematics."

From then on, everything you ask applies to that scope. To switch, just say so. Claude starts afresh on the new scope, without mixing the two.

## 6. Ask where you are

This is the question to ask every time you pick the work back up:

> "Where am I?"

Claude replies with a status report: where you are, what your role allows, whether a **draft** is open, what is waiting for review, what is **unfinished** (a document that covers nothing, an orphaned section, a routine nobody uses), and two or three things to do now.

!!! warning "An open draft is often someone else's work"
    If Claude reports a draft in progress that you did not open, a colleague is probably working on it. Don't publish it or discard it without talking to them first.

## The plugin's commands

Once the plugin is installed, a few shortcuts take you straight to the right procedure. They are optional: anything they do, you can also ask for in writing.

| Command | To… |
|---|---|
| `/ou-en-suis-je` | Take stock: where you are, what you can do, what is still open |
| `/construire` | Build or develop the curriculum (standards, courses, lessons, groupings) |
| `/composer` | Create or develop a document (what it covers, its formatter, its sections) |
| `/produire` | Produce a document, then check that it fits |
| `/lecon` | Produce all of a lesson's files, redoing only what is stale |
| `/mesurer` | Measure a document that has already been produced (pages, overflow) |
| `/evaluer` | Review a document or the draft in a single pass |
| `/reprendre-corrections` | Carry an expert's corrections on a Word file back into the curriculum |
| `/publier` | Publish the draft, with the checks first |
| `/decisions` | List what is waiting for a human decision |

Without the plugin, the connector sometimes offers a few **ready-made starts** (*Créer un nouveau document*, *Appliquer un style*, *Créer une routine*, *Préparer une relecture* — create a new document, apply a style, create a routine, prepare a review). Each one opens the conversation with the right questions.

## What next?

- To build or correct the curriculum → [Understand the graph](create-graph.md).
- To create or produce a document → [Compose a document](compose-document.md).
- To look at the curriculum → [Explore the graph](explorer.md).
