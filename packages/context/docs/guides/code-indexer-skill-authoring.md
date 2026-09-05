# Code Indexer Skill authoring

This guide defines the release checklist for a Code Indexer Provider Skill.
It does not reproduce Context's internal Agent Graph lifecycle. The Provider
receives validated requirements, scopes, worksets and evidence views and
returns only its declared structured Results/fragments.

## Minimal package

Use one `context-indexer.yaml` with protocol
`context.indexer.provider/v1`. Give the Skill a SemVer version and publish the
complete Bundle with a reproducible integrity digest. Instructions, templates,
fixtures and portable program entries live below the Skill root. Do not invent
source-specific manifest names or a second schema tree.

Programs use a structured `runtime: node`, portable `entry` and literal `args`.
They never use a free-form command. A detector only reports activation signals;
an inspector only returns bounded evidence/enrichment. Neither is a hard-gate
authority. CLI profile contracts and verified data-only overlays own mechanical
rules, metric operators and thresholds.

## Author contract checklist

1. **Responsibility.** Classify supported code modules and produce evidence-
   bound partitions, logical units, Artifact Bundles and Results. Do not own
   source authorization, requirement approval, final review, CLI metrics or
   package publication.
2. **Manifest.** Use the sole `context-indexer.yaml` field tree. Bind domains,
   profiles, operations/fragments, resources, source roles, logical units,
   customization support and composition without duplicate aliases.
3. **Resource composition.** Combine only declared programs, profile-bound
   instructions, templates and optional detector/inspector resources. Omitted
   capabilities remain unsupported; natural language cannot add them.
4. **Activation and profiles.** Declare strong/supporting/negative signals.
   Dependency names are candidates, not runtime proof. One module may combine
   one primary profile with supporting/extensions and selected composers.
5. **Sources and Artifacts.** Write for a reader outside the indexed module:
   make responsibility, stable interfaces/entrypoints, handoffs and the core
   state, failure, operation and source-of-truth facts needed for correct use
   and attribution discoverable. Declare source roles and logical-unit intent;
   select only CLI-registered Artifact kinds/policy variants. Keep logical unit
   identity separate from physical Artifact count, and measure useful coverage
   by answered profile questions rather than symbol or path counts.
6. **Inventory protocols.** Close every input member with an explicit
   disposition. Use stable aggregation, full-path example identity and
   structured chain decisions; do not substitute page prose for inventory.
7. **Metrics.** Reference registered metric ids as reader-quality guidance.
   The CLI may report advisory observations, but a Provider cannot return a
   pass, threshold, retry count, or risk-acceptance decision.
8. **Revision boundary.** Hard contract or source failures block at their
   owner. Reader-quality feedback reopens the same Author or Composer through
   `context revise`; it does not create a metric retry ledger or risk Gate.
9. **Reader questions.** Declare reusable question templates with stable refs,
   target domains and allowed evidence contracts. Do not make a question id
   globally unique to one SubjectKey group.
10. **Inspector safety.** Accept only the versioned stdin request and bounded
    authorized evidence view; emit strict JSON within limits. Never read the
    repository, environment or network implicitly, and never expose raw
    config values, secrets or unbounded stderr/stdout.
11. **Base gates.** Do not reduce source scope integrity, identity, evidence,
    requirement, disposition, reference-only or provenance gates. Provider
    integrity identifies content; it does not grant pass authority.
12. **Anonymous fixtures.** Cover at least a component library, Web app, API
    service, SDK/library and runtime/worker with neutral paths and identifiers.
13. **Release tests.** Validate the manifest/resource ledger, run positive and
    negative fixtures, forward-test the complete Skill, pack it, reinstall the
    exact artifact and compare Bundle bytes/digest.
14. **Content ownership.** Public technology belongs in the community Skill;
    company-wide infrastructure belongs in a separate namespaced Provider;
    repository, service, team and business mappings belong in business/project
    Providers. Community fixtures remain anonymous.
15. **Marketplace layout.** Archives keep one top-level Skill directory with
    `SKILL.md`, the manifest and referenced runtime resources. Exclude tests,
    caches, credentials, local paths and Host-specific temporary manifests.
16. **Material gaps.** Return a canonical question disposition in the same
    main Result when required evidence is missing. Never render a gap as an
    empty page or speculative prose. Registered Markdown or tool material may
    enrich the same main indexing batch before Candidate generation; do not
    create a separate answer operation, Candidate, checkpoint or Review. The
    CLI projects allowed enrichment material into that same Authorized
    Workset View; Providers must not reopen registered sources themselves.
17. **Backend profiles.** Test neutral RPC/HTTP, Gateway, Event/function,
    Cron/worker, sync/reconciliation, stateful service/storage and library
    shapes. Local facts remain baseline when optional remote metadata is absent.
18. **Versioning.** Use Skill/Provider SemVer, exact Provider pins and Bundle
    integrity. Fixed dependencies require exact versions and resolved
    integrity. `@context-indexer-origin` is optional on local customizations
    only and grants no authority.
19. **Trust boundary.** Skill/manifest describes capabilities; the verified
    Bundle supplies bytes; workspace customization supplies project deltas;
    CLI contracts supply hard rules. Keep these four authorities distinct.
20. **Requirement direction.** `IndexRequirementSet` constrains registry,
    extractor and Result in one direction. Apply requirement/registry changes
    through staged, digest-bound proposals and transactional apply; do not edit
    a live registry around the Route.
21. **Program and remote authority.** Programs must pass static policy and the
    applicable trusted/sandbox authorization. Optional remote tools use a
    versioned Host Action, exact source-bound request and readable receipt;
    they never expand scope or perform writes.
22. **End-to-end recovery.** Test discovery, exact Provider resolution,
    content-addressed staging, controlled execution, Artifact/Evidence Result
    validation and crash recovery. A resumed run reuses only complete accepted
    records and never infers success from a partial receipt.
23. **Customization ladder.** Preserve this order: Provider only → config →
    instructions append → one template override → program extension →
    restricted replace. Document the proof and exit condition at every step;
    see [Provider selection and customization](./indexer-provider-and-customization.md).
24. **Batch neutrality.** Write instructions for one semantic task and accept
    that Context may transport several independent tasks in one Agent step.
    Never derive identity, ordering, ownership or evidence scope from a task
    key or batch position. Partition should decide consumer-facing ownership
    from public anchors and unresolved material; detailed supporting Facts are
    consumed in the bounded Author View rather than copied into every
    Partition decision.

For behavioral explanations, the Author View also supplies `source-text`
items with the authorized source lines. Each merged range links to existing
source-span dependency nodes through `source_span_refs`; use those nodes for
evidence bindings. These process-local snippets are reading material, not new
Facts or reader-page metadata. Do not reopen the repository or infer behavior
from a locator alone when the supplied lines do not establish it.

## Result and composition rules

Exactly one primary layer returns a complete partition/author Result for an
operation. Pre-author extensions return only declared fragments and cannot
change ownership, denominator or Subject identity. Post-author composers bind
one current `PrimaryResultView` and return only a derived proposal fragment;
an empty composer run still has a receipt. Composer selection is the
intersection of registry selection, manifest declaration and current profile
applicability, not array order.

Use canonical SubjectKey schemas and the Context NodeRef formula. Code and
Markdown Indexers must reuse the same Node when the SubjectKey is equal. An
enricher uses the supplied TargetResolutionView (`resolved`, `absent` or
`ambiguous`) and never guesses identity from a title or path resemblance.

Every Section uses the exact `document_kind`, `reader_goal` and
`artifact_kind` tuple from the current profile's unique layout mapping. The
Provider never returns a collection name; Context resolves the collection from
that tuple and rejects missing or ambiguous mappings.

## Publication gate

Do not publish until the exact packed artifact passes manifest/schema
validation, anonymous positive/negative fixtures, no-scope-expansion and
secret-leak tests, deterministic Bundle reconstruction, exact-version install,
controlled execution and forward tests. Publishing a new version does not make
existing workspace pins current; workspace selection must re-resolve it.
