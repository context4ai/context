# Markdown Indexer Skill authoring

Use the shared [planning and writing guidance](./indexer-provider-and-customization.md).
Document Skills help interpret captured articles; notes and sessions have their
own guidance but can support the same reader topic. No unique primary owner,
version lock or per-document disposition ledger is required.

## Captured sources

Start from authorized captured Markdown and its source identity. Capture proves
which bytes are available, not what they mean. Titles, headings and filenames are
navigation aids, not proof that the Agent has read the body.

Do not fetch new documents, follow external links or widen source authorization
implicitly. Request missing material through the current workflow. Keep the
distinction between a source being unavailable and its contents being irrelevant.

## Planning

Read the supplied titles, bounded introductions and complete H2/H3 outlines.
The Agent may read additional sections or the full document when needed, then
chooses article targets and writing batches. Do not require full-body reading of
every document or a separate planning submission for an already explicit target.

Consult code topics and existing article descriptions and references. Reuse a
topic when its reader question fits, or propose a clearer business topic instead
of forcing a document under a code directory. One document may support several
articles and several authorized documents may support one article.

The final work-start report follows the relevant source overview and plan, and
must wait for the user before bulk writing, including in managed mode.

## Writing and repairs

Read the actual passages needed for the article. Distinguish authoritative rules,
examples, decisions and proposals; a session suggestion is not an implemented
behavior. Write Markdown and references in the supplied temporary directory and
submit the short stage-relative manifest. Title and description belong to the
article, not an internal layout-mapping tuple.

Keep stable article and fragment identities when revising. Each fragment cites
at most three actual source regions. The CLI handles source digests and safety;
the Agent judges whether the evidence supports the explanation. For a local
failure, use the returned fragment identifier or position to repair the affected
part. Completed independent tasks can be submitted without the rest of the batch.

Do not inflate page counts, produce a page for every heading, or turn missing
evidence into speculative prose. A genuine material gap remains unfinished work;
an explicit exclusion uses the existing exclusion mechanism. Neither requires
a new reconciliation ledger or additional content-review stage.

## Useful fixtures

Cover an ordinary one-to-one article, multi-document synthesis, reuse of an
existing topic, fragment repair, source line changes, links and images, and
missing material for the document forms the Skill supports. Verify both source
fidelity and the final page. Keep examples anonymous and check packaged links.
Drafts and scheduling details remain temporary; deleting `.tmp` starts fresh
production from formal knowledge and available sources, not a workflow migration.
