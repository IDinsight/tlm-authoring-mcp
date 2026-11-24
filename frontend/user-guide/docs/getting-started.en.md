# Getting started

Four steps before you can work: **get access**, **connect the tool to your AI assistant**, **sign in**, then **choose where you work**. Allow about ten minutes the first time, and none after that.

## 1. Get access

There are three ways in, depending on your situation.

- **Your organisation has opened access to its domain.** If your work address belongs to an authorised domain and you sign in **with Google**, you get your role automatically the first time you sign in. There is nothing to request.
- **You have been invited.** An administrator has registered your **email address** with a role. Create your account with that exact address (or sign in with Google if it is a Google address). The invitation is recognised the first time you sign in.
- **Neither.** Write to the workspace administrator and give them your email address. They will send you an invitation.

!!! info "Without a role, you can already read"
    Any signed-in user can look at the published curricula. You need a role for the workspace's **documents** (downloading them, producing them), for **translation**, and for any **change** to the curriculum.

## 2. Connect the tool to your assistant

The tool works with several AI assistants. What you install depends on which one you use:

| Your assistant | What you install | Helper assistants |
|---|---|:---:|
| **Claude** — Cowork, Claude Code | The authoring plugin | ✅ |
| **Claude** — chat on the web or in the desktop app | The authoring plugin, or the tool alone | — |
| **Codex** | The authoring plugin | — |
| **ChatGPT** | The tool alone. A workspace administrator can import the plugin | — |
| **Gemini** — Antigravity, Gemini CLI, the Gemini app | The tool alone | — |

Two things in that table need a word of explanation.

- **The authoring plugin** (*tlm-autorat*) brings **the tool and the procedures** in a single install. The assistant then knows in what order to work, what to check before writing, and when to stop and ask you. With **the tool alone**, everything still works, but the assistant knows the procedures less well: expect to guide it more.
- **Helper assistants** (a reader, a reviewer, a measurer…) do the long reads on their own and report back only the conclusion. Where they do not run, your assistant does the same work in the main conversation, and tells you so first. The result is the same; it is slower, and it uses up more of the conversation.

!!! info "The tool's address"
    Where no plugin carries it for you, you give your assistant this address:

    ```text
    https://senegal-mohebs-tlm-148764688487.europe-west1.run.app/mcp
    ```

    If your organisation runs its own server, your administrator gives you a different one. It always ends in `/mcp`.

Now follow the steps for your assistant.

=== "Claude"

    **The plugin (recommended).**

    - **In Cowork**: go to *Customize → Plugins*, add the repository `IDinsight/tlm-authoring-mcp`, then install **tlm-autorat**. On Team and Enterprise plans, an administrator can install it for everyone.
    - **In Claude Code** (including the Code tab of the desktop app), type these two lines, one after the other:

    ```text
    /plugin marketplace add IDinsight/tlm-authoring-mcp
    ```

    ```text
    /plugin install tlm-autorat@tlm-authoring-mcp
    ```

    **Or the tool alone.** Add the **"Teaching & Learning Materials authoring"** connector in Claude's connector settings. If your organisation doesn't offer it, add a **custom connector** with the address above.

=== "Codex"

    **The plugin (recommended).** The same plugin installs in Codex. In a terminal, type these two lines, one after the other:

    ```text
    codex plugin marketplace add IDinsight/tlm-authoring-mcp
    ```

    ```text
    codex plugin add tlm-autorat@tlm-authoring-mcp
    ```

    **Or the tool alone:**

    ```text
    codex mcp add tlm --url https://senegal-mohebs-tlm-148764688487.europe-west1.run.app/mcp
    ```

    Codex itself asks for a ChatGPT account or an OpenAI key before it will run.

=== "ChatGPT"

    ChatGPT takes the tool alone, as a **custom MCP server**. Two limits come from ChatGPT itself:

    - it works **on the web**, not in the mobile app;
    - it needs a **Business, Enterprise or Edu** plan. In a Business workspace, only an admin or an owner can create it and publish it for the others. A Pro plan only lets a custom server *read*, which is not enough to work here.

    Then, on chatgpt.com:

    1. Go to **Plugins**.
    2. Select the plus button, then **Add custom MCP server**.
    3. Give it a name, for example "TLM".
    4. Under **Connection**, enter the address above.
    5. When ChatGPT asks how to authenticate, choose **OAuth**. There is no key or password to paste: you sign in at step 3 below.
    6. Read the warning, then tick **I understand and want to continue**.
    7. Select **Create as a plugin**, and look over the list of tools ChatGPT has found.

    A workspace administrator has a second way in, which brings the procedures too: in the Admin Console, **Plugins**, **Add**, then **Import marketplace**, with the repository `IDinsight/tlm-authoring-mcp` as the source.

    !!! note "Not yet run by us"
        These steps are OpenAI's own. We have not yet been through either route from start to finish. ChatGPT should ask you to confirm each action that **changes** something, such as an edit to the curriculum or a file sent, and let a simple read through. If it asks on every action, or a step looks different, tell your administrator.

=== "Gemini"

    Google offers three places to connect the tool. All three take the tool alone.

    **Antigravity** (the app). Click **Customizations**, then **Installed**. Under **MCP Servers**, click **Add MCP Server (+)**, enter the address above, then **Add**.

    **Gemini CLI.** Since June 2026 Google keeps it for people who use it with a Gemini key or a Google Cloud project; personal accounts have Antigravity instead. In a terminal:

    ```text
    gemini mcp add --scope user --transport http tlm https://senegal-mohebs-tlm-148764688487.europe-west1.run.app/mcp
    ```

    **The Gemini app** (gemini.google.com). Open **Settings**, then **Connected Apps**. Under **Custom apps**, choose **Add a custom app**, enter the address above, then **Next**. For now Google limits this to personal Google accounts, in the United States, in English, for people aged 18 or over, with history turned on.

    !!! note "Not yet run by us"
        These steps are Google's own. We have not yet been through them from start to finish. The plugin has also been prepared for Antigravity, but never tried on a real install. If a step looks different, tell your administrator.

In Claude and in Codex, the plugin also installs a second tool for **image generation**. It is only used when you work on illustrations.

!!! tip "Where it works best"
    **Cowork** and **Claude Code** are the two places where the helper assistants run, so long jobs (reading a whole document, reviewing a lesson) go fastest there. Everywhere else the tool does the same things, more slowly.

## 3. Sign in

The first time you use the tool, a sign-in page opens in your browser. Choose **Continue with Google**, or enter your account's email and password. You won't have to do this every time.

In some assistants you start the sign-in yourself:

| Assistant | To start the sign-in |
|---|---|
| Claude Code | The `/mcp` command |
| Codex | In a terminal: `codex mcp login tlm`. Before working on illustrations, also `codex mcp login nano-banana` |
| Gemini CLI | Inside a session: `/mcp auth tlm` |
| Antigravity | **Authenticate**, next to the server. Paste the code you are given into **Enter authorization code**, then **Submit** |

## 4. Check that everything is connected

Send a simple message:

> "What can I do?"

If the assistant's answer draws on the tool (naming your roles and your workspaces), everything works. If it answers "from memory", check that the tool is **turned on for this conversation** (in Claude, the tools menu under the message box), then ask for it explicitly:

> "Use the TLM tool to tell me what I can do."

The first time the assistant calls a tool, it asks for your permission. Accept: this is normal.

## 5. Choose where you work

Your work is always framed by three things:

- a **workspace** — the curriculum of one organisation or country. This is what determines your role;
- a **grade** and a **subject** inside that workspace. You work on one at a time.

> "Which workspaces and subjects are available?"

Then tell the assistant where to go, naming the workspace, grade and subject exactly as it listed them:

> "Let's work on first-year mathematics."

From then on, everything you ask applies to that scope. To switch, just say so. The assistant starts afresh on the new scope, without mixing the two.

## 6. Ask where you are

This is the question to ask every time you pick the work back up:

> "Where am I?"

The assistant replies with a status report: where you are, what your role allows, whether a **draft** is open, what is waiting for review, what is **unfinished** (a document that covers nothing, an orphaned section, a routine nobody uses), and two or three things to do now.

!!! warning "An open draft is often someone else's work"
    If the assistant reports a draft in progress that you did not open, a colleague is probably working on it. Don't publish it or discard it without talking to them first.

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

Two older commands are kept for habit: `/nouveau-cours` (build a course from scratch, which runs `/construire` then `/composer`) and `/relire` (review the draft before sending it to an approver, like `/evaluer`).

**In Codex**, only the commands that take nothing after their name are offered: `/ou-en-suis-je`, `/relire`, `/publier` and `/decisions`. For the others, ask in words. The procedures behind them are installed all the same.

Without the plugin, some assistants offer a few **ready-made starts** that come from the tool itself (*Créer un nouveau document*, *Appliquer un style*, *Créer une routine*, *Préparer une relecture* — create a new document, apply a style, create a routine, prepare a review). Each one opens the conversation with the right questions.

## What next?

- To build or correct the curriculum → [Understand the graph](create-graph.md).
- To create or produce a document → [Compose a document](compose-document.md).
- To look at the curriculum → [Explore the graph](explorer.md).
