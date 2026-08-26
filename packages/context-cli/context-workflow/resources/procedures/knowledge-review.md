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
- let the user approve or reject candidates;
- apply the exact returned decision payload; and
- retain the exact report reference and reviewed scope in this conversation for
  the final completion summary.

The ordinary Route also carries a revision-bound force-approval resolution
Action as an escape path. Do not advertise it when first presenting Review.
Use it only after the user cannot use the report and explicitly replies with
the exact phrase `强制批准` in the current conversation. It approves the complete
current scope atomically; no candidate-specific decisions are inferred.

With explicit session-managed authority, Context may approve the complete
current batch atomically. The authority exists only in the current
conversation. It does not bypass source permission, validation, close, or
verify.

After apply, re-evaluate. Do not infer that close or package output is current.
Do not persist a duplicate review-report ledger in the workspace.
