# Write source-grounded document knowledge

Read the relevant full source, not only the planning outline. Keep the
confirmed reader purpose visible: a how-to guide, FAQ and design explanation
serve different needs even when they cite the same code.

Preserve or synthesize the useful guidance in the source: actual steps,
contracts, conditions, examples, compatibility limits, images and uncertainty.
An inventory of headings, a generic summary or a link back to the source does
not replace an article that answers the reader. Preserve exact commands,
identifiers, numbers and destinations where they matter; do not reproduce
secrets or incidental conversion metadata. For an entry-first request, identify
the relevant source section and concrete next step; for an operational guide,
retain what lets the reader execute it. Do not replace available instructions
with a generic suggestion to consult the original document.

Use [editorial guidance](editorial-policy.md) for a concrete presentation
problem. It is advice for the Agent and user, not a signal-clearing protocol or
a CLI prose-quality score. Legitimate code, templates and historical details
must not be removed merely because they resemble a placeholder.

## File submission and references

Write a complete new article using the current stage's Markdown and reference
file schema. For an existing article, use its supplied base and submit only
needed section edits when appropriate. Stable section markers and title and
description follow that schema; there is no ArtifactResult, subject identity
or profile-owned output mapping to assemble.

For each output fragment, cite the actual source regions used, at most three
locations. Use source_ref and an inclusive file/line locator; the CLI computes
content digests. Do not attach an entire corpus to a generic paragraph or
combine unrelated locations into a fabricated continuous span. Split genuinely
distinct explanations when they need distinct references.

Place drafts and manifests in the Agent's designated temporary directory.
Submit completed tasks or a finished subset using the returned action. Do not
pass long article bodies in shell arguments, write approved knowledge directly,
or store skills, process receipts or separate provenance lists in article
frontmatter. Acceptance saves this run's candidate; Review and formal delivery
remain separate.

## Supporting notes and sessions

Use only authorized saved material and cite what was actually read. Separate
quotations, paraphrases, proposals, confirmations and reported test results.
A discussion can explain rationale but does not independently establish that
a change merged, deployed or passed tests. Several selected skills may help
the same article; no primary/extension ownership is required.

Correct misleading knowledge through a revision. Correct an inaccurate source
through its authorized import flow, not by editing evidence from this skill.
When merging or shortening existing articles, retain still-valid steps, examples
and constraints in the article or a linked topic, not just their source links.
Keep real gaps visible; material not yet obtained is not a permanent exclusion.

## Visual material

Use [diagram guidance](diagrams.md) when it clarifies an important relationship.
For actual source images or tables, read [visual processing](visual-source-processing.md).
Preserve source strength and external boundaries; diagrams are not a completion
requirement. Follow the workspace's visual conventions.

## Source provenance and article prose

Keep capture baselines, repository commit hashes, inspected branch revisions and
verification timestamps in structured source references or citation destinations,
not in article headings, introductions, tables or standalone evidence paragraphs.
Do not add sentences such as “the backend baseline is repository@commit” merely
to describe how the article was researched. Preserve exact source links and
reference metadata; removing this prose must not weaken traceability.

Retain business or API versions, compatibility constraints, migration differences
and performance comparison baselines when they explain behavior or reader actions.
A commit belongs in the prose only when the requested topic is that specific
change, regression or reproduction and its identity is necessary. Apply editorial
cleanup only to the current authorized writing or revision scope; do not scan or
rewrite unrelated approved articles. This is writing guidance, not a keyword-based
CLI rejection rule.
