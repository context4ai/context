# Markdown Indexer authoring contract

Classify and author at the source-backed Section level. A document profile describes reader intent; it is not an output directory. Mixed documents may contain Sections with different reader goals, but every Section must retain one stable subject, owner, source authority, and projection intent.

Use `classification.md` as the semantic source for `document_kind`, `reader_goal`, and current `artifact_kind` selection. Use `structure-and-artifacts.md` for mixed-document routing, Section-versus-Artifact promotion, density, duplicate/conflict handling, and target candidate resolution. The CLI-supplied profile contract remains the only authority for collection and path projection.

Use `semantic-planning.md` for evidence authority, SubjectKey/target-resolution
judgment, relation and structured-claim gates, content-purpose precision, and
stale/collision recovery behavior. It adapts the useful semantic gates from the
former align path to the current Result ABI; it does not authorize legacy align
commands or `context.structure.v1`.

Use `editorial-policy.md` for scenario editorial signals, recommended outcomes, Section-specific assessments, omission eligibility, and anonymous decision examples. Context still owns signal spans, protected values, revision CAS/storage, rescans, and final validation.

Preserve exact commands, identifiers, links, attachments, tables, and code blocks when they are evidence-bearing. Separate deterministic catalogs from explanation. Do not publish unsupported claims, conversion annotations, placeholders, or unresolved requests as knowledge.

When current source material cannot answer a required canonical question, return the exact material-question disposition for the supplied target. Answers may use only authorized evidence kinds and spans. Context owns review, layout, collection mapping, material-gap persistence, quality thresholds, and final close.

Follow the operation in the supplied run request. For `main-index`, return only the current `IndexerResult`/`ArtifactResult` contract; Context derives the exact source-span, selected-fact, logical-unit, Artifact, and negative group-input dependencies from that result. For `material-answer`, return only `context.indexer.material-answer-result/v1`. Each binding must echo one eligible `question_key`, its exact `question_revision_digest`, and canonical evidence claims containing only `kind`, authorized `source_ref`, normalized `source_spans`, and the current content `evidence_digest`. Do not return reader prose, an answer body, source-origin/input identities, an `EvidenceItemRef`, a future Artifact/Section identity, or an actualization. Context canonicalizes evidence, performs the limited Review, derives a body-free planned answer from the approved binding, and maps its supplied answer landing after layout.

Never create a legacy `MarkdownCollectionSlice` or invoke the independent `alignProse` phase. Never mix `main-index` and `material-answer` output.

Do not return output paths, collection names, arbitrary question text, new authority, or pass/fail claims.
