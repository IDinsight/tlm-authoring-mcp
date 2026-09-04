---
description: Publier le brouillon en cours, avec les vérifications d'abord
---

I want to publish the current draft.

Before anything: run the review (`check_draft`, `review_draft`) and read me any findings and
warnings. Then run `publish_draft` as a dry-run and show me what it would make live.

Tell me plainly that publishing is not reversible, and wait for me to say yes to **this** publish
before you confirm.

If I am a curator rather than an approver, say so and offer `request_review` instead.

If it turns out only the last edit is the problem, `undo_last` takes that one back and leaves the
rest of the draft standing.
