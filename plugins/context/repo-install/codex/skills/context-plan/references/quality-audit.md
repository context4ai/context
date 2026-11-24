# Audit the accuracy and freshness of existing knowledge

Use during research on an existing knowledge collection, and on existing
workspace articles that the project will revise. The audit gives evidence for
the integration approach; it does not correct anything during research.

## Sample claims that code can confirm

For each collection, pick about ten concrete claims that the pinned code can
confirm or refute: service or module names, table and field names, interfaces,
states and transitions, configuration keys, thresholds and time limits, and
code paths. Spread the sample across the collection's main areas; prefer claims
readers would act on.

Check each claim against code at a fixed revision. Use already registered or
locally available repositories first; record repositories you could not read
instead of cloning unrelated ones. Classify each result:

| Result | Meaning |
| --- | --- |
| Consistent | The code supports the claim |
| Partly consistent | The core holds but a detail differs or is incomplete |
| Inconsistent | The code contradicts the claim |
| Unverifiable | The claim depends on configuration, data or code that was not available |

Record for each claim: the statement, where it appears, the code location, the
result and, for inconsistencies, what the code actually does.

## Check freshness

Note how the collection records currency: update dates, verified revisions,
status labels. Compare them with the upstream's actual changes, for example
commits to the cited code since the verified revision, or newer document
revisions. Flag pages that claim to be current but have not been reviewed
since material changes.

## Classify the problems

Group the inconsistencies and stale items into two kinds:

- **Written wrong**: inconsistent with code when written — often names, paths,
  formats or omitted branches. Citing specific code lines while writing and
  reviewing exposes these.
- **Went stale**: correct once, but the code or rules changed and the page did
  not follow. Comparing cited source regions on scheduled updates exposes these.

Include problems found in the existing workspace articles too; the comparison
is about the method, not about whose content is better.

## Decide how much code evidence each collection needs

- Mirrors and summaries of documents: regenerate from the originals and code;
  do not cite the summaries as evidence.
- Code-curated collections: anchor to current code so drift is detected.
- Maintained first-hand collections with their own checks: code evidence may be
  limited to flagging changes when they are kept unchanged.

## Report

Show the totals per collection, a handful of concrete examples with their
classification and consequence for readers, and which step of the production
process would catch each kind of problem. State the cost of that process —
source registration, review and running scheduled updates — next to its benefit.
