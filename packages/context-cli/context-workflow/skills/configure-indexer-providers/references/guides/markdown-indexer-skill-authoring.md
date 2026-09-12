# Markdown Indexer Skill authoring

Markdown Providers use the same `context.indexer.provider/v1` manifest,
versioning, Bundle, requirement, trust, Result and customization contracts as
Code Providers. Read the shared
[Code Indexer author checklist](./code-indexer-skill-authoring.md) and
[Provider selection/customization guide](./indexer-provider-and-customization.md)
first. This page defines the boundary for captured file/Lark documents.
Saved notes and conversation summaries use their dedicated Note/Sessions
Providers, or an explicitly selected business replacement, on the same protocol.
They reuse Markdown reading without a second capture phase. A Markdown page may
still consume either as authorized supporting material; specialized extension
guidance does not transfer primary ownership.

## Capture before semantics

Capture owns source authorization, retrieval, revision identity, complete bytes,
Markdown/MDX parsing and evidence spans. A Markdown Indexer starts only from a
current captured source report and authorized evidence view. URLs, titles,
filenames, headings and capture success are activation candidates, not semantic
classification or proof that the whole document was read.

The Provider cannot fetch the document again, follow new links, rewrite source
revisions or widen capture scope. Missing/unsupported capture capability is an
explicit unsupported result, never a prose fallback.

## Activation and source roles

Declare document activation signals and map evidence-backed sources to declared
roles such as authoritative, explanatory, operational, decision or example
material. Keep role selection separate from collection placement. One document
may support multiple reader questions, but every consumed span retains its
source/revision identity and cannot be promoted to a stronger authority by an
instruction.

## Section projection and collection mapping

Author Results propose logical Sections and their intent; they do not write
`knowledge/` paths. Each Section binds:

- the selected article and reader purpose;
- its reader-question refs and actual source regions;
- an Artifact kind and Section key stable across content-only changes;
- a projection intent describing purpose, not a physical filename;
- authored content, without an article-side facts or evidence ledger.

Context owns the closed mapping from profile/Section intent to collection and
path. The layout resolver reuses an existing Artifact by stable identity,
detects add/remove/rename/split/merge/move changes. Ordinary production reviews
the proposed new structure before Author, including new topics in an update.
Protected changes to an approved layout have their own human-only Gate; this
is distinct from ordinary structure review and its managed delegation. A Provider cannot
avoid that Gate by emitting a path or relabeling the change.

## Reusing existing articles

Read the supplied approved article when a task updates existing knowledge.
Preserve its identity, applicable content and confirmed contributions. Code and
documents can inform the same page without a shared Node or SubjectKey.
Production does not build or resolve graph targets; title similarity alone
does not justify merging articles.

## Artifact and Section planning

One logical unit may produce an Artifact Bundle with multiple meaningful
Sections or semantic split Artifacts. Do not use fixed-count, ordinal or
alphabetic batches. Do not create one page per heading/member or inflate page
count to satisfy a metric. The CLI owns Artifact-policy eligibility, physical
fan-out audit, layout actualization and the final Candidate compile.

The first actual Section of each reader Artifact begins with one concise,
source-backed level-one heading. Context uses that heading as the outline and
Candidate Review display title. It never changes stable article identity
or ownership, and later Sections in the same Artifact do not repeat it.

Each output fragment records at most three actual source locations. Context
hashes those regions and uses changes, missing regions or ambiguous relocation
to identify articles needing review. Changes outside cited regions can still
introduce new topics; unchanged references do not prove the whole article current.

## Editorial policy

Editorial instructions may guide clarity, consolidation, ordering and
reader-facing terminology. They cannot alter facts, evidence, source role,
requirement scope, protected values, revision identity or collection authority.
Deterministic blocks render only registered facts; semantic prose cites consumed
evidence. The Agent or user assesses missing explanations, speculation and
unfilled placeholders in the existing content Review. Context does not scan
words, braces, comments or headings to reject content, and an editorial hint
does not create another gate or require a signal-clearing receipt.

## Missing material

When current material cannot answer a required canonical question, return the
exact material-question disposition for the supplied owner cell, question
contract and selected scope. Do not invent a new question contract or landing.
Context reports the unresolved set in current reconciliation state; it does not
create a second checkpoint ledger or published gap artifact.

Capture the missing Markdown or other source normally, then rerun `main-index`.
The new Result updates the same knowledge Candidate and enters the same final
content Review. There is no answer-only operation or evidence-specific Review.
A blocking gap closes only through current source or an explicit non-delegable
requirement change.

## Bounded execution

Each captured document remains an independently recoverable Partition input,
but Context may transport several documents in one bounded Agent step. Return
one result for every supplied task key. Group material by useful reader topics;
do not assume that shared wording automatically merges articles. Batch order,
filename order and heading order never create article identity. Author and Review use the same
bounded transport rule without adding intermediate user approvals.

## Markdown author fixture checklist

Release fixtures should cover:

- complete Markdown and MDX capture plus unsupported parser/capture paths;
- authoritative reference, guide, runbook, FAQ, decision, incident, policy,
  test and release/migration document shapes using anonymous content;
- per-Section projection into every supported collection intent;
- existing article revision, new reader topics and material gaps;
- content-only reuse plus add/remove/rename/split/merge/collection/path/Section
  move in both directions;
- protected values, links, images/assets and source-span fidelity;
- editorial positives and placeholder/speculation/unsupported negatives;
- material-gap runtime recovery, main-index retry and no-output-leak;
- region changes, line drift, missing or ambiguous regions and unaffected
  fragment reuse.

Source authorization, capture revision safety, canonical question/collection
contracts, layout confirmation, review and build remain Context authority and
cannot be replaced by the Skill.
