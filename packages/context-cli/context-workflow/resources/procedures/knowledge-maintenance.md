---
id: procedure.knowledge-maintenance
kind: procedure
mediaType: text/markdown
---

# Maintain knowledge while production continues

Use `context task maintain --input <file|-> --format json` to register multiple
approved pages or an approved-output rebuild. The machine-readable input is
[maintenance input](../../schemas/knowledge-maintenance-input.schema.json). This accepts a request; it does
not discard the current task or immediately rewrite a page.

```yaml
id: clarify-existing-guides
operation: revise
timing: after-batch
targets:
  - path: knowledge/guides/overview.md
    instruction: Clarify the selected explanation using its existing sources.
```

Reuse the same id and input when retrying a registration. A changed request uses
a new id; cancel a pending request with `context task cancel-maintenance <id>
--format json` before replacing it. Do not manufacture repeated requests from
the same user feedback.

`operation` selects `revise`, `regenerate`, or `rebuild`. Rebuild has no targets;
it packages approved content without completing the production task. It cannot
repair a table stored in an existing page. To publish newly accepted Author
results earlier, use the current Route’s `delivery.request.command`
(`context run --deliver --format json`) instead of a rebuild request. Finish
the current Author batch and follow composition, Review, close and build, then
resume production. Regenerate prepares the currently
supported programmatic API blocks from the selected registered code material,
even when its source version is unchanged. Follow the resulting Author Route,
select relevant program tokens and retain unrelated prose. This is not a
universal rerun of every business Composer. If a required program/material is
not available, report the exact gap; do not hand-write generated rows.

Ordinary revisions need no source reacquisition or parsing. New factual notes
and conversation summaries still use the normal source preparation and scope
adjustment procedures. A regenerated table does not advance a whole-source
processed baseline. A changed upstream version still requires source impact
assessment, including other affected approved pages and new topics.

`after-batch` waits for the current delivery boundary. Use `priority` when the
user asks to handle the correction first: the Graph requests early delivery
of complete pages, retaining ordinary Review gates. Never interrupt a running
submission, silently approve its drafts, or start parallel workspace writers.
Inspect `maintenance` in status for the active request, pending targets and
the actual waiting condition. Continue the original task only within the user's
existing authorization; registration is not new authority to publish it.

The transition command is supplied by the current Route. Do not invoke it with
a remembered revision. On a preparation failure the request remains visible;
repair the named materials and retry the current Route, or cancel that request
before it creates a draft. Active drafts use the current revision/Review path;
queue cancellation does not silently roll them back. To explicitly discard its
unfinished drafts, first read `context task maintenance-status --format json`,
then use `cancel-maintenance <id> --discard-revision <returned revision> --format
json`. Already approved pages are retained and rebuilt; this is not a rollback
of delivered knowledge. Shared-source adjustments wait until this maintenance
batch is finished or cancelled, then use the production task's source adjustment
route. If status says `target-still-in-production`, the original task still owns
an unfinished page of that subject: let that writer settle before revising its
latest approved text. After completion, read the
new Route to resume production. Never resubmit an accepted old batch.
