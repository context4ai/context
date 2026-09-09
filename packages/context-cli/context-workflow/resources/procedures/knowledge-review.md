---
id: procedure.knowledge-review
kind: procedure
mediaType: text/markdown
---

# Knowledge Review

Review is the authority boundary between candidates and approved knowledge.
Open one report for the complete current candidate set and apply only a payload
that matches its collection scope and candidate-set digest.

Before Review, Context checks both sides of approved page identity: whether a
candidate path is already owned by another `view_ref` / `node_ref`, and whether
the candidate `view_ref` is already approved at another path. Either conflict
blocks Review. Follow the returned identity-coordination route: the default
mechanical repair preserves the approved identity and approved path, then
recompiles only the affected source. It keeps the candidate batch intact while
replacing affected candidates in place. Changing an approved identity or moving
an approved path is a migration and must never run without a separate, explicit
authorization.

Without explicit session-managed authority:

- open the report returned by the route;
- let the user publish or durably omit candidates;
- apply the exact copied review code through the returned review apply command; and
- retain the exact report reference and reviewed scope in this conversation for
  the final completion summary.

The ordinary Route also carries a revision-bound force-approval resolution
Action as an escape path. Do not advertise it when first presenting Review.
Use it only after the user cannot use the report and explicitly replies with
the exact phrase `强制批准` in the current conversation. It approves the complete
current scope atomically; no candidate-specific decisions are inferred.

With explicit session-managed authority, materialize the required
`context.review-current` Markdown Resource once. Read its index and every
reader-facing batch file listed there. Each Candidate appears in exactly one
bounded batch; keep the decisions in the current Agent context and do not write
a Review ledger. Use the current scope template in that index with the Route's
atomic apply command. Add explicit decisions only for reviewed pages; leave
repair or undecided pages out of decisions and do not set a default. For a fully
reviewed acceptable set, default approval remains available. Do not generate,
open, or parse the ordinary HTML report. Reopen repair pages through their
current repair command; unrelated approvals remain valid. The
authority exists only in the current conversation. It does not bypass source
permission, validation, close, or verify, and it is not proof that the files
were read.

After apply, re-evaluate. Do not infer that close or package output is current.
Do not persist a duplicate review-report ledger in the workspace.

The Review UI names the internal `rejected` decision **Omit** because it is a
durable content decision, not a request to rewrite the page. When a page needs
changes, leave that page pending and use `context revise` so the owning
Author or Composer produces a new Candidate through the same lifecycle.

Use the affected page's `Repair` command in the review material, replacing only
the correction instruction. Current candidates are repaired within this batch;
`--timing priority` is not needed and does not queue them behind delivery.
`--regenerate` schedules program regeneration for approved pages. If supplied
for a current candidate, follow the CLI's returned repair command instead.
After the repair, read the new Route and review the changed material before
approving the batch. Pending maintenance requests for other pages remain queued.

For a repaired generated table, inspect the new Candidate's affected rows, not
only its Repair ID or accepted Author/Composer outcome. Check the reported error
against the available source version and facts. A missing value is not always a
missing source: the source may be present but unsupported by the parser, or the
correct fact may have been lost during rendering. Describe which case the
available material establishes. An explicit limitation may be acceptable for the
reader's task; a known false value must be repaired. If the same error remains
after regeneration, preserve the batch and report the affected page, field and
source/fact comparison. Repeating the same repair without new material or a tool
fix is not progress. Do not approve, omit, or hand-edit a block to hide the error.

## Interpreting generated API output

Check fields, types, requiredness and supported defaults against the selected
source version. A table can completely express a simple declaration; omitting
that duplicate folded declaration is intentional. Complex relationships or
constraints not represented in rows remain in a named declaration. Program
`declaration_status`, when present, distinguishes `table-complete`,
`component-wrapper`, `retained` and `not-provided`; its `fact_ref` and `source_ref`
locate the input. Missing folds alone do not establish a parser failure.

If the user explicitly requires a different presentation, explain the difference
and resolve that choice before accepting it. Do not rerun unchanged Repair to
force a format the program deliberately omits. Check the actual resulting page;
accepted tasks or an empty Composer result alone do not demonstrate a correction.

## Delivering approved pages while others need repair

A partial decision keeps remaining pages in Review. It does not build after each
approval. When the user asks to see approved results now, use
`context run --deliver --format json` and follow its new Route through close and
build. The CLI checks that the approved pages do not depend on unresolved pages;
if they do, finish the linked pages first. No draft is approved or omitted by
this request. Remaining drafts, accepted work and source baselines stay in place,
and the Route returns to their Review/repair after the selected output builds.

## Check usefulness as well as factual accuracy

Use the current requirements and agreed scope to check whether a reader can
complete the promised task with these pages. Source citations and a valid API
table alone do not establish that. Compare representative pages with their
actual definitions: keep defaults and members attached to the correct callable
or type; inspect inherited members and static entry points when needed for the
reader's task. Do not infer that an unexpanded type has no options or callbacks.

Look for promised integration steps, examples or troubleshooting answers that
may be missing across the relevant pages. Check neighboring pages before
requesting additions. Repeated prose is a reason to inspect the actual content,
not an automatic rejection rule. If the source is insufficient, identify what
is unavailable and its effect on the reader instead of inventing content or
forcing another identical regeneration. Keep correct pages eligible for the
partial approval and delivery path above.
