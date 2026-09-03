# Markdown Indexer Skill authoring

Markdown Providers use the same `context.indexer.provider/v1` manifest,
versioning, Bundle, requirement, trust, Result and customization contracts as
Code Providers. Read the shared
[Code Indexer author checklist](./code-indexer-skill-authoring.md) and
[Provider selection/customization guide](./indexer-provider-and-customization.md)
first. This page defines the Markdown-specific boundary.

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

- the canonical SubjectKey/Node target or an explicit independent target;
- its reader-question refs and exact evidence spans;
- an Artifact kind and Section key stable across content-only changes;
- a projection intent describing purpose, not a physical filename;
- structured content layers and their digests.

Context owns the closed mapping from profile/Section intent to collection and
path. The layout resolver reuses an existing Artifact by stable identity,
detects add/remove/rename/split/merge/move changes and requests a human Gate
only for destructive or ambiguous existing-layout changes. A Provider cannot
avoid that Gate by emitting a path or relabeling the change.

## Reusing Code Nodes

Use the supplied subject catalog and TargetResolutionView. Equal SubjectKeys use
the same NodeRef across Code and Markdown. `resolved` enriches the existing
Node; `absent` may create an explicitly independent subject or a material gap;
`ambiguous` fails before authoring. Titles, heading similarity and filenames
are never identity fallback. Unrelated catalog changes must not make a workset
stale.

## Artifact and Section planning

One logical unit may produce an Artifact Bundle with multiple meaningful
Sections or semantic split Artifacts. Do not use fixed-count, ordinal or
alphabetic batches. Do not create one page per heading/member or inflate page
count to satisfy a metric. The CLI owns Artifact-policy eligibility, physical
fan-out audit, layout actualization and the final Candidate compile.

The first actual Section of each reader Artifact begins with one concise,
source-backed level-one heading. Context uses that heading as the outline and
Candidate Review display title. It never participates in SubjectKey derivation
or ownership, and later Sections in the same Artifact do not repeat it.

Each Section carries exact positive and negative dependency refs. Incremental
impact is Section/Artifact-local: a source membership, question denominator,
candidate pool, evidence span or run-envelope change invalidates only the
dependent scope. A Provider must not replace this with source-wide or
collection-wide recomputation.

## Editorial policy

Editorial instructions may guide clarity, consolidation, ordering and
reader-facing terminology. They cannot alter facts, evidence, source role,
requirement scope, protected values, revision identity, collection authority or
hard metrics. Deterministic blocks render only registered facts; semantic prose
must cite consumed evidence. Placeholders, speculation, fabricated transitions
and “content unavailable” pages are invalid even when the structure looks rich.

## Missing material

When current material cannot answer a required canonical question, return the
exact material-question disposition for the supplied owner cell, question
contract and Subject target. Do not invent a new question contract or landing.
Context retains the unresolved set only as local runtime recovery state.

Capture the missing Markdown or other source normally, then rerun `main-index`.
The new Result updates the same knowledge Candidate and enters the same final
content Review. There is no answer-only operation or evidence-specific Review.
A blocking gap closes only through current source or an explicit non-delegable
requirement change.

## Markdown author fixture checklist

Release fixtures should cover:

- complete Markdown and MDX capture plus unsupported parser/capture paths;
- authoritative reference, guide, runbook, FAQ, decision, incident, policy,
  test and release/migration document shapes using anonymous content;
- per-Section projection into every supported collection intent;
- existing Code Node reuse, independent subject, ambiguity and material gap;
- content-only reuse plus add/remove/rename/split/merge/collection/path/Section
  move in both directions;
- protected values, links, images/assets and source-span fidelity;
- editorial positives and placeholder/speculation/unsupported negatives;
- material-gap runtime recovery, main-index retry and no-output-leak;
- Section-local incremental invalidation, new membership/denominator/candidate
  pool changes and unaffected Section reuse.

Source authorization, capture revision safety, canonical question/collection
contracts, layout confirmation, review and build remain Context authority and
cannot be replaced by the Skill.
