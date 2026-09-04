# `seeds/` — what a namespace is created FROM

Nothing in this directory is read at runtime, and nothing here is the source of
truth for anything.

A subject's authoring guide lives in its **config cell in Firestore**, beside its
graph. That is what `get_graph_guide` returns, what the authoring model reads,
and what experts edit through `edit_profile`. These files are only the starting
point a brand-new namespace is seeded from, by `import-kg` on a first import.

The moment anyone edits a live guide, the copy here is out of date — and several
already are. `senegal/ci/maths/GRAPH_GUIDE.md`, for instance, still describes
`bilan` assessments and `Semaine` groupings, neither of which the live curriculum
has had since the 2026-09 V2 rebuild.

| | live guide | this directory |
|---|---|---|
| Where | the namespace's config cell (Firestore) | the repo |
| Read by | the server, on every `get_graph_guide` | `import-kg`, on a first import, and the tests |
| Edited with | `edit_profile` → `publish_draft` | a text editor |
| In the production image | n/a — it is in the store | **no**, deliberately not copied |

## Reading and changing the guide that is actually in force

```
get_graph_guide          # the prose the model reads
get_profile              # the whole { core, guide } record
edit_profile             # change it — two-phase, diffed, audited
publish_draft            # make the change live
```

Editing a file here changes nothing that is running.

## If you need to sync

**Live → repo** is the safe direction and the one usually wanted: take
`get_profile`'s `guide` and write it back over the file here, so the repo copy
stops being stale.

**Repo → live** overwrites authored prose. `import-kg` and `write-profile` will
*not* do it on their own any more — both keep the live guide and refresh only the
machine `core` — so it takes an explicit `--profile <file>`. Read what is live
first.

## The banner

Every file here opens with an HTML-comment banner repeating the warning above.
It is stripped when the file is read for seeding (`adapters/index.ts`), so it
never becomes part of the prose the model sees.
