# Write the research report and discuss it

Use when stakeholders must choose between approaches or the research covers
existing knowledge collections. The report is a communication document for
people; the PLAN remains the working record. Keep both consistent.

## Structure: conclusions first

1. **Conclusions and recommendation**: a one-screen summary of the current
   state, the recommendation per collection and the benefit next to the cost;
   then the reasons, next steps and a short reading guide.
2. **Approaches and their trade-offs**: a neutral description of the
   production process and where each candidate approach attaches to it, ending
   with the cross-collection score matrix and each approach's trade-offs.
3. **Recommended plan**: target shape including how readers and agents reach
   the packages (installation, query services, repository agent instructions),
   packages, stages, maintenance ownership, a table comparing the current state
   with the recommendation by dimension (coverage, accuracy, freshness,
   maintenance burden, content kept unchanged) together with the cost, decisions
   needed and risks.
4. **Impact on the knowledge structure**: an overview tree of navigation
   changes, then per-collection detail. When a constraint or decision changes the
   placement, show the alternatives side by side.
5. **Packages and their articles**: each package's articles listed individually
   with navigation location and status.
6. **Comparison with existing knowledge**: how each collection is organized,
   overlap, conflicts and upstream registration status.
7. **Quality**: audit totals, concrete examples and what would catch them,
   with one example traced over time to show how scheduled source comparison
   would have caught a stale statement.
8. **Background**: meeting decisions and action items, proposals, method.
9. **Appendices**: one per collection, each opening with a one-picture summary
   (composition, overlap, audit result, approach scores, conclusion).

Open each chapter with its own conclusion in one or two sentences.

## Writing rules

- Plain language for people new to the subject; define approach names once and
  use them consistently.
- Objective tone: describe what each collection and team already provides; do
  not present the recommended process as self-evidently superior.
- Pair every benefit with its execution cost.
- Name documents by title and repositories by name instead of pasting long
  addresses; long file paths may be shortened in display while keeping the full
  path available to copy.
- State how numbers were obtained and label estimates.

## Figures

Prefer figures over long tables where they help:

| Figure | Shows |
| --- | --- |
| Collection map | Collections placed by knowledge origin and maintenance activity |
| Composition | Original copies versus distilled content per collection |
| Overlap | Share of duplicated, complementary and new content |
| Upstream registration | Registered versus unregistered upstreams |
| Audit results | Consistent, partial, inconsistent and unverifiable claims |
| Approach scores | Each collection scored on each approach, recommendation marked |
| Production process | Where each approach attaches (as a tree or table) |
| Navigation impact | Pruned tree marking added, revised, new sections and unchanged content |

## Build and share

Write chapters as Markdown files and build a single-page HTML report with
[the report template](../templates/research-report/README.md): chapter list on the
left, one chapter at a time in the middle, the chapter's outline on the right.
Keep chapter sources and figure data under `.tmp/context-plans/<slug>/research/`.
Share through a channel that keeps the report access-controlled; do not upload
it to publicly readable storage. Uploading creates an external copy, so confirm
with the user before publishing it.

## Discuss and record decisions

Expect several rounds. After each round, update the report and record each
decision in the PLAN with its date and who made it; keep open questions visible.
When an answer is ambiguous, state the interpretation you applied and invite
correction. A decision on the approach is not approval of the PLAN or of
production; follow the review policy in the Skill.
