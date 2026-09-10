# Markdown Indexer authoring contract

Classify and author at the source-backed Section level using only the current Authorized Workset View. A document profile describes reader intent; it is not an output directory. Mixed documents may contain Sections with different reader goals, but every Section must retain one stable subject, owner, source authority, and projection intent.

Keep the requirement's `purpose` and open `reader_goals` visible in Partition,
Author and Review. Select a supported page intent and template for that reader's
task, save the outline and delivery boundary, and reuse those choices on retry.
A how-to guide, FAQ and design explanation retain their distinct purposes;
shared code evidence does not turn every document into a maintenance audit.
If the purpose is already clear, do not ask it again because a field is absent.
Managed execution does not authorize deciding a truly ambiguous purpose.

During representative reading, actively distinguish sections that answer the
reader's task from supporting context and material that may be unnecessary.
Check available document status, intended audience, version applicability and
substantive duplication. Age, titles, archived locations and document length are
clues, not exclusion rules; historical decisions and older procedures can still
be required. Preserve useful detail rather than replacing it with an inventory.
If a substantial region raises an unresolved scope choice, explain what including
or leaving it out means and ask before dependent writing, including in managed
mode. Unneeded material increases token use, processing and review work, and can
bury useful answers in repetitive or conflicting pages. Recommend boundaries
from the user's task, not from a target page count or promised speedup. Reuse
settled decisions, use the current Result's supported dispositions, and preserve
accepted knowledge. Do not treat unread material as irrelevant or silently omit it.

Context delivers an initial readable sample and subsequent page batches through
the current Review, close and build routes. Continue the remaining accepted plan
after each build; preserve already delivered pages and source-grounded prose.

Use `classification.md` as the semantic source for `document_kind`, `reader_goal`, and current `artifact_kind` selection. Use `structure-and-artifacts.md` for mixed-document routing, Section-versus-Artifact promotion, density, duplicate/conflict handling, and target candidate resolution. The CLI-supplied profile contract remains the only authority for collection and path projection.

Use `semantic-planning.md` for evidence authority, SubjectKey/target-resolution
judgment, relation and structured-claim gates, content-purpose precision, and
stale/collision recovery behavior. It adapts the useful semantic gates from the
former align path to the current Result ABI; it does not authorize legacy align
commands or `context.structure.v1`.

Use `editorial-policy.md` for editorial review hints and anonymous decision examples. Content assessment belongs to the Agent and user; hints do not trigger a CLI prose rescan, rejection, or additional gate. Context owns source references, protected values, revision CAS/storage, and structural validation.

Preserve exact commands, identifiers, links, attachments, tables, and code blocks when they are evidence-bearing. Separate deterministic catalogs from explanation. Do not publish unsupported claims, conversion annotations, placeholders, or unresolved requests as knowledge.

When a captured document already contains coherent reader-facing guidance, preserve and organize that supported content instead of replacing it with a heading inventory, directory summary, or a sentence that points the reader back to the source. Summarize only repetition or navigation scaffolding. A shorter Artifact is acceptable only when it still answers the selected reader questions and retains the source's useful contracts, examples, conditions, compatibility notes, and uncertainty.

For each reader Artifact, start the first actual Section with exactly one
level-one heading that names the reader subject. Keep the heading concise and
source-backed. It is a display title for outline and final Candidate Review,
not a SubjectKey, ownership signal, or identity fallback. Later Sections in the
same Artifact must not add another level-one heading.

When current source material cannot answer a required canonical question, return the exact material-question disposition for the supplied target. A later run may consume newly captured Markdown as ordinary source and update the same knowledge candidate. Context owns layout, collection mapping, runtime material-gap state, each delivery's content Review, and close.

Return only the current `main-index` `IndexerResult`/`ArtifactResult` contract. Context derives the source dependencies needed for stale detection and recovery from that result. Do not emit a separate answer body, answer-only result, future Artifact/Section landing, or post-layout actualization.

Return all knowledge through the current Indexer result; do not create an independent authoring pipeline.

## Quality guidance and production checks

Context blocks only conditions it can derive from current inputs: the complete
source inventory needs dispositions, the selected reader-question set needs a
complete plan, answered questions must satisfy their evidence contracts, and
references, layout and currentness must remain valid.

Profile metrics are writing guidance rather than a separate pass decision.
They point out duplicated facts, enumeration where explanation was expected,
repeated template scaffolding, oversized quoted bodies, traversal-ordered
Partitions, reference-only targets and unsupported optional Artifacts. Treat a
finding as a prompt to reread the Section. Do not adjust wording, headings,
sentence counts or Partitions merely to move a counter.

Natural-language statements are not mechanically checked sentence by sentence.
Use only behavior stated by the supplied material, record a material gap when
the source does not establish a needed conclusion, and rely on final Review to
reject unsupported interpretation. When shape guidance conflicts with source
coverage, preserve the source-backed content and improve its presentation
rather than deleting it.

Do not return output paths, collection names, arbitrary question text, new authority, or pass/fail claims.

## Notes and conversation summaries as supporting material

Use only the authorized excerpts or summaries and cite the material actually
read. Distinguish quotations, paraphrases, confirmed decisions and proposals;
write the explanation useful to the reader instead of copying the source.
Keep claims within what the captured documents establish. A summary may record that participants reported an implementation or a passing
test; attribute that report and retain its stated version and scope. Do not
present it as independently verified in this task. Claims of direct validation
need the actual relevant code, execution or test results in the authorized
material. Discussion or a plan alone does not establish completion.

Keep this Provider responsible for the existing page. If the host selects a
Note/Sessions or business Provider extension, apply its supplied instructions
to the same writing task. Do not load an unselected skill or create a second
page solely because supporting material has a different source type. An
independent reader task can use a dedicated Provider selected by the host.

If the source is inaccurate, return the correction to the host source-input
flow; do not edit it from the Indexer. If only the knowledge is misleading,
revise the page from its approved text through Author/Review. Keep source
associations in the source and page/section references in structure.yaml;
do not add provenance fields to the knowledge header.

## Diagrams

Use the materialized [diagram guidance](diagrams.md) when a diagram clarifies the reader task. This also applies to older templates, source diagrams and Composer summaries. Preserve source strength, version and external boundaries; diagram presence is not a completion requirement.

## Existing source images and tables

For authorized visual material, follow [source visual processing](visual-source-processing.md): preference, capability-aware conversion, accepted-result reuse and retention. Follow the workspace AGENTS.md for editable diagram style.
