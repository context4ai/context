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
a Review ledger. Only after every batch is publishable may the Agent run the
single managed atomic approval command. Do not generate, open, or parse the
ordinary HTML report. If any page needs repair, do not approve any batch;
reopen the owning Author or Composer through the current repair route. The
authority exists only in the current conversation. It does not bypass source
permission, validation, close, or verify, and it is not proof that the files
were read.

After apply, re-evaluate. Do not infer that close or package output is current.
Do not persist a duplicate review-report ledger in the workspace.

The Review UI names the internal `rejected` decision **Omit** because it is a
durable content decision, not a request to rewrite the page. When a page needs
changes, leave the whole batch unapplied and use `context revise` so the owning
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
