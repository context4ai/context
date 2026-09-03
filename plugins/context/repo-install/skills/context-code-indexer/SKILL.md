---
name: context-code-indexer
description: Context-managed Provider for source-grounded code knowledge. Use only when the Context Indexer lifecycle selects this Provider, not as a standalone workflow.
metadata:
  context-role: "indexer-provider"
  context-public-entry: "false"
  context-provider-version: "1.1.1"
---

# Context Code Indexer

Provider authors must satisfy
`node_modules/@c4a/context/docs/guides/code-indexer-skill-authoring.md` and the
shared Provider/customization guide before publishing or extending this Skill.
Those documents are authoring contracts; the current workset and Route remain
execution authority.

Use this Provider only through the Context Indexer lifecycle. The workspace registry selects an exact profile, version, integrity, scope, and operation. Consume evidence only from the single Context-supplied Authorized Workset View; do not scan outside the supplied workset, construct pagination/receipt requests, or write project files directly.

Keep machine identity and reader content deliberately small. A durable Fact
locator may identify a relation or declaration, but must never embed a source
expression, implementation body, complete tool response, credential-like value,
or other source text; keep such material in the process-local protected payload.
Write for a consumer outside the indexed module: show what the module is
responsible for, when and how to enter it through stable interfaces, where it
hands off, and which core state, failure, operation, or source-of-truth facts are
needed for correct use and attribution. Effective coverage means answering these
supported reader questions across stable capabilities, not maximizing the number
of symbols or paths mentioned.
Every reader Artifact must answer the selected profile's concrete questions from
current facts. A symbol/path list, generic module summary, workflow explanation,
or internal Fact/View/digest count is not useful knowledge and must not be emitted.
Before emitting an Artifact, identify the concrete selected-profile question
that its logical unit answers. Formal question refs may close required coverage,
but a group label, Partition Subject, or large Fact volume alone is not a reader
purpose; a unit with no applicable profile question is catalog-only.
Bind each reader claim only to the smallest relevant evidence set; never attach
an entire workset inventory to a generic summary.
Close inventory members with their actual boundary evidence or a legal
catalog/exclusion disposition. Never reuse one unrelated fallback evidence
binding merely to make the disposition denominator appear complete.
When a large module exposes stable route, capability, protocol, runtime, or
storage boundaries, partition on those boundaries before authoring. Do not put
the whole module in one catch-all logical unit, and do not replace semantic
partitioning with numbered batches.

The machine-readable authority is `context-indexer.yaml`. Detailed authoring guidance is materialized by Context from the registered Bundle after its file ledger and integrity have been verified.
