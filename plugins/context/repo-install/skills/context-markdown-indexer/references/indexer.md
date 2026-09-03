# Markdown Indexer authoring contract

Classify and author at the source-backed Section level using only the current Authorized Workset View. A document profile describes reader intent; it is not an output directory. Mixed documents may contain Sections with different reader goals, but every Section must retain one stable subject, owner, source authority, and projection intent.

Use `classification.md` as the semantic source for `document_kind`, `reader_goal`, and current `artifact_kind` selection. Use `structure-and-artifacts.md` for mixed-document routing, Section-versus-Artifact promotion, density, duplicate/conflict handling, and target candidate resolution. The CLI-supplied profile contract remains the only authority for collection and path projection.

Use `semantic-planning.md` for evidence authority, SubjectKey/target-resolution
judgment, relation and structured-claim gates, content-purpose precision, and
stale/collision recovery behavior. It adapts the useful semantic gates from the
former align path to the current Result ABI; it does not authorize legacy align
commands or `context.structure.v1`.

Use `editorial-policy.md` for scenario editorial signals, recommended outcomes, Section-specific assessments, omission eligibility, and anonymous decision examples. Context still owns signal spans, protected values, revision CAS/storage, rescans, and final validation.

Preserve exact commands, identifiers, links, attachments, tables, and code blocks when they are evidence-bearing. Separate deterministic catalogs from explanation. Do not publish unsupported claims, conversion annotations, placeholders, or unresolved requests as knowledge.

When a captured document already contains coherent reader-facing guidance, preserve and organize that supported content instead of replacing it with a heading inventory, directory summary, or a sentence that points the reader back to the source. Summarize only repetition or navigation scaffolding. A shorter Artifact is acceptable only when it still answers the selected reader questions and retains the source's useful contracts, examples, conditions, compatibility notes, and uncertainty.

For each reader Artifact, start the first actual Section with exactly one
level-one heading that names the reader subject. Keep the heading concise and
source-backed. It is a display title for outline and final Candidate Review,
not a SubjectKey, ownership signal, or identity fallback. Later Sections in the
same Artifact must not add another level-one heading.

When current source material cannot answer a required canonical question, return the exact material-question disposition for the supplied target. A later run may consume newly captured Markdown as ordinary source and update the same knowledge candidate. Context owns layout, collection mapping, runtime material-gap state, quality thresholds, the single final content Review, and close.

Return only the current `main-index` `IndexerResult`/`ArtifactResult` contract. Context derives the source dependencies needed for stale detection and recovery from that result. Do not emit a separate answer body, answer-only result, future Artifact/Section landing, or post-layout actualization.

Return all knowledge through the current Indexer result; do not create an independent authoring pipeline.

Do not return output paths, collection names, arbitrary question text, new authority, or pass/fail claims.
