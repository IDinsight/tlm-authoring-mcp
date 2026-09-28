# Administration

This page covers two tasks, for two different audiences:

- **Managing a workspace and its members**: done **by chatting with Claude**, with no technical skills needed. For administrators.
- **Adding a new subject**: needs access to the code repository and to deployment. For developers.

---

## Part 1 — Workspaces and members

### What a workspace is

A **workspace** is the container for a curriculum, whether it belongs to a country, an organisation or a project. It owns the curricula for its grades and subjects, its library (the catalog), its lexicon and the documents it has produced. **Roles** are granted at this level: you can be an approver in one workspace and have no role at all in another.

### Roles

| Role | Scope | Can… |
|---|---|---|
| **super-admin** | every workspace | do everything, including create workspaces, open a workspace to a domain and write to the shared library |
| **admin** | one workspace | manage members and delete a catalog entry, plus everything an approver can do |
| **approver** | one workspace | publish, write to the catalog and the lexicon and view the history, plus everything a curator can do |
| **curator** | one workspace | edit the curriculum and documents in the draft, and produce documents |
| *(no role)* | — | read published curricula |

The **super-admin** role cannot be granted through chat. A developer sets it in the server configuration.

### Bring someone in

There are three ways, from the simplest to the most hands-on.

**Open the workspace to a domain** (super-admin). Anyone who signs in **with Google** using an address at that domain gets the chosen role the first time they sign in.

> "In our curriculum's workspace, give the curator role to anyone at notre-organisation.org."

Only Google sign-in counts, because Google is what vouches that the address really belongs to that person. Someone from the same domain who creates an account with a password still needs an invitation.

**Invite by email** (admin). The invitation is recognised the first time the person signs in with that address.

> "Invite ana.diallo@exemple.org as a curator of this workspace."

If the person already has a known account, they get the role straight away; otherwise the invitation waits for them. You can also withdraw an invitation: "Withdraw the invitation for ana.diallo@exemple.org."

**See who is waiting** (super-admin): "Which accounts don't have a workspace yet?" Claude lists the people who have signed in but have no role, the invitations nobody has claimed, and the accounts that have not been confirmed.

### Manage members

> "List the members of this workspace, with the pending invitations."
>
> "Make Ana Diallo an approver."
>
> "Remove Ana Diallo from this workspace."

A few safeguards:

- giving a member a role again **replaces** the role they have now;
- you **cannot remove the last admin** of a workspace, so appoint another one first;
- an admin cannot grant the super-admin role.

Every change takes effect **immediately** (there is no draft) and is **recorded** in the workspace's history, which approvers can look through.

### Create a workspace

Only the **super-admin** can do this:

> "Create a workspace 'kenya', displayed as 'Kenya'."

The identifier is a short word with no spaces. Creating the workspace creates **no curriculum**: curricula are imported separately (Part 2).

---

## Part 2 — Adding a new subject

!!! warning "A developer task"
    This part assumes you have access to the repository and to the storage credentials. Run the commands from the `backend/` folder. The full procedure, with its checks, is in the repository's technical documentation (`docs/technical-reference/`) and in the internal **rollout** skill.

Adding a subject comes down to **a small description file, then data**. No subject-specific behaviour goes into the code: everything that sets the subject apart lives in its graph and its guide.

1. **Describe the subject.** A **profile** (a configuration object) tells the tool how to read the subject's graph: where the order of its items comes from, and what its groupings are called. Add it under `backend/src/adapters/profiles/`, modelled on an existing profile of the same shape, then register it in `backend/src/adapters/index.ts`. Several subjects can share one profile when their graphs have the same shape.
2. **Deploy the server**, so that it knows about the new subject. The import refuses a subject that has no profile.
3. **Import the starting graph**, a *Learning Commons* `{ nodes, relationships }` envelope:

    ```bash
    npm run import:kg-store -- <espace> <classe> <matière> <graphe.json>
    ```

    Add `--dry-run` for a trial run. In a **new** workspace, the import creates the published curriculum. For a curriculum that is **already in place**, you need `--replace-published`, which writes straight to the published version; it is refused while a draft is open. The subject guide that is already live is kept, unless you supply one with `--profile`.

4. **Check**: enter the subject through chat, ask for a status overview, and reread the guide.

**Back up before you change anything**:

```bash
npm run export:kg-store -- <espace> <classe> <matière> [sortie.json]
```

The resulting file can be imported again as it is, to restore or to clone.

!!! tip "Changing an existing subject does not need a developer"
    A subject's **guide**, its **documents**, its **formatters**, its **routines** and its **evaluation grids** are all changed through chat, in the draft, like the rest of the curriculum. Only adding a *new* subject goes through the code.
