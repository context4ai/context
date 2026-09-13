# Code Indexer Skill authoring

An Indexer exposes the source skeleton and guides source-grounded writing.
Read [planning and writing guidance](./indexer-provider-and-customization.md)
for the current workflow. Do not recreate routing inside a Skill.

## Skill responsibilities

Describe the supported technology, activation signals, useful reader questions,
and how to investigate an authorized module. A module may use several Skills for
different concerns. There is no exclusive primary owner, version pin, integrity
receipt or production registration prerequisite. Skill names and optional usage
configuration are temporary planning guidance, not article metadata.

Keep `SKILL.md` focused on discovery and decisions. Put optional detailed writing
guidance and reusable scripts beside it, with relative links and clear triggers.
Distribution metadata does not impose workspace version validation.

## Skeleton first

During planning, prefer directories, manifests, registration points and bounded
search. Either let the Agent inspect these directly or offer a fast helper suited
to the stack. Report matching names, known counts and file locations. Do not
require complete symbol extraction, call graphs or reading every implementation
before proposing articles.

Distinguish file-list counts from syntax-derived feature counts. A helper with a
budget must identify inspected and uninspected scope, return a continuation when
available, and label partial counts. Never present a stopped scan as a full total.
Representative deeper reading is optional when it clarifies a topic boundary.

Signals suggest topics; they do not prove semantics. A route registration can
suggest an API topic, but not its error behavior or business meaning. Prefer
reader questions to a mechanical page for each directory, symbol or heading.
Keep module directories explicit in task guidance when needed, without adding
a separate persisted boundary protocol or a new validation gate.

## Writing and evidence

Once the current report is confirmed, read the source needed for each assigned
article. Describe contracts, state changes, failure behavior and integration
points where relevant. Optional parsing can help locate declarations; it is not
proof of runtime behavior. Preserve expressions without executing project code,
distinguish declaration defaults from implementation defaults, and state unknowns.

Use the current stage's Markdown and reference-file schemas. Each fragment cites
at most three actual source locations; the CLI computes regional digests. Split
an explanation when it needs separate evidence, not to fill a fixed template.
Reuse stable article and fragment identities when revising. Supporting documents,
notes or sessions may contribute to the same article without becoming code facts.

The Agent plans batches and chooses reading order within the work released by
the CLI. If supported, workers write assigned drafts and the coordinator submits
completed subsets. Do not require every batch to finish before submission.
Use the existing missing-material and repair outputs, not a per-member ledger,
another content audit or a Skill-specific retry protocol.

## Optional scripts

Scripts serve a concrete repeated task; they are not mandatory for every stack.
Take explicit authorized paths and bounded options, keep source files read-only,
and return concise output or a file in the supplied temporary area. Do not execute
repository code, read credentials, traverse unrelated directories or contact
external services implicitly. Full parsing belongs to selected writing tasks.
Report unsupported syntax and incomplete traversal separately from zero matches.

## Validation and distribution

Test supported technology with anonymous fixtures: feature discovery, bounded
stopping, unsupported input, repeated names in different paths, and final article
references. For generated API explanations, verify defaults, shared types and
unresolved cross-file links in the final page as well as the parser output.
Use relevant fixtures, not a mandatory matrix for unrelated technologies.

Verify packaged relative links and executable helpers. Keep community examples
free of company-specific services; organization and project knowledge belongs in
their own Skills. Publishing or installing a Skill requires the appropriate
authorization and does not add a hash or version check to knowledge production.
