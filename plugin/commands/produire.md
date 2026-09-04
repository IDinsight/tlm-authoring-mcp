---
description: Produire une fiche ou un document, puis vérifier que ça tient
argument-hint: [ce qu'il faut produire — une leçon, une section, un document]
---

Produce: $ARGUMENTS

Follow the `produire-et-mesurer` skill.

Start by fetching the generation inputs — prefer `walk_document_section` for a single slot, and
`preview_generation` if this should reflect unpublished draft work. Read the formatters and the
section's own guidance before laying anything out; do not work from memory.

Once it is produced, **measure it** and tell me the page count. If it overflows, render it again
with no images and measure that too before proposing anything.

If this is a preview, its output goes through `create_preview_upload_url` only.
