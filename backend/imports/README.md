# imports/ — converted KGs staged for live import

Canonical Learning-Commons graphs (`{ nodes, relationships }`) ready to load into
the Firestore KG store with `npm run import:kg-store`. Each was produced from a
raw EIDU/CASE JSONL export by `scripts/convert-eidu-jsonl.mjs`.

These are **import inputs, not test fixtures** — they live here (not under
`test/fixtures/`) precisely so `fixtureContexts()` does NOT scan them into the test
matrix. Their subject profiles are still validated at module load, and
`import-kg.mjs --dry-run` exercises their parse.

Layout mirrors the namespace: `imports/<workspace>/<grade>/<subject>/knowledge_graph.json`.

| Workspace | Grade | Subject | Nodes / Edges |
|-----------|-------|---------|---------------|
| cbse   | class-9-10 | science | 1558 / 1797 |
| ghana  | basic-1-3  | english | 662 / 697 |
| ghana  | basic-4-6  | maths   | 548 / 585 |
| madhi  | class-1-5  | maths   | 686 / 713 |
| rwanda | primary-1-3 | maths  | 1391 / 1489 |

Nigeria's corrected maths graph lives under `test/fixtures/nigeria/…` instead — it
is a pre-existing test context whose data was replaced.

## Catalog backups (`<ws>/_catalog/routines/`)

`_catalog` namespaces are **backups**, not new imports. They hold the reusable-spec
libraries — instructional routines, formatters and evaluation rubrics — whose entries
are authored **live** through `add_to_catalog`, so unlike a subject graph they exist
nowhere else in this repo. On 2026-08-22 a `seed:catalog` run deleted 19 senegal
entries; they were only recoverable because copies happened to survive in the subject
graph. A routine that is catalogued but attached to nothing would have been lost.

| Namespace | Entries | Nodes / Edges |
|-----------|---------|---------------|
| `senegal/_catalog/routines` | 21 | 131 / 130 |
| `_shared/_catalog/routines` | 5  | 58 / 57 |

Refresh a snapshot after authoring catalog entries:

```bash
npm run export:kg-store -- senegal _catalog routines imports/senegal/_catalog/routines/knowledge_graph.json
```

Restore one with **`--raw`**. A catalog is not a curriculum: it has no subject adapter
to parse it and no profile cell, so a normal import cannot read it. `--raw` writes the
envelope's nodes and edges verbatim (`fromRawEnvelope`, the exact inverse of the
`toRawEnvelope` that produced the file).

```bash
npm run import:kg-store -- senegal _catalog routines imports/senegal/_catalog/routines/knowledge_graph.json --raw --replace-published
```

The same applies to the `_glossary` partition, for the same reason.
