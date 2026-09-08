# Where sessions material belongs in a base profile's page

A `sessions/…` profile is an extension. It does not own a page and does not open a
parallel one. The module stays on its base profile and selected page plan,
including an applicable project template override. Contribute to the relevant
sections; the attachment examples below are guidance, not a heading whitelist.

Do not restate a base section the summary has nothing to add to, and do not
introduce a "discussion" section to hold everything that was said.

## What a summary can establish that the base sources cannot

Read the base profile's Chapter blueprint and notice which sections its own
evidence can settle. Structure settles from code and contracts: entry points,
signatures, registrations, schemas, dependency edges. Several sections in every
base blueprint ask for something else — why a limit was chosen, what a timeout
means for a caller, which combination is unsupported, what breaks on upgrade,
which behavior is deliberate rather than accidental. Those are the sections a
development discussion is for, and they are usually the ones a reader most wants.

This is the useful division. A summary that repeats a signature adds nothing and
risks contradicting the authoritative source. A summary that carries the reason
behind a value, the case that was deliberately excluded, or the failure mode
someone already hit belongs in the section that asks for exactly that.

## Attachment points by family

| Family | Base profiles | Sections a summary usually reaches |
| --- | --- | --- |
| Applications and containers | `monorepo-container`, `web-application` | `Dependency and layering constraints`, `Shared configuration and tooling`, `Configuration and environment selection`, `Known exclusions and source-of-truth links` |
| Reusable capabilities | `component-library`, `sdk-library`, `cli-tool`, `plugin-extension` | `Compatibility and release constraints`, `Behavior, lifecycle, and errors`, `Recovery and rollback boundaries`, `Configuration, permissions, and isolation`, `Compatibility, failure, diagnostics, and recovery` |
| Services and gateways | `api-service`, `gateway-facade`, `domain-service` | `Error, timeout, and compatibility behavior`, `Timeout, retry, compatibility, and failure translation`, `State, transaction, and idempotency behavior`, `Failure and recovery behavior`, `Configuration, observability, and release` |
| Runtimes and data flow | `background-runtime`, `event-consumer`, `data-sync-reconciliation`, `storage-repository` | `Concurrency, ordering, retry, and idempotency`, `Idempotency, retry, checkpoint, and failure destination`, `Authentication, failure, retry, and fallback`, `Transaction, consistency, cache, and locking behavior`, `Failure recovery and observability` |
| Boundaries and contracts | `adapter-integration`, `contract-source`, `derived-generated-source` | `Error, retry, fallback, and compatibility behavior`, `Versioning, compatibility, and deprecation`, `Generated versus maintained behavior`, `Compatibility and regeneration` |
| Document profiles | `domain-reference`, `product-requirements`, `technical-guide`, `user-and-developer-guide`, `public-api-reference`, `runbook`, `faq-support`, `standard-policy`, `decision-record`, `incident-review`, `test-validation`, `release-migration-guide`, `documentation-site` | The base document blueprint keeps its shape; a summary adds a decision, an exception, an applicability boundary or a correction |

Read the section names from the actual base template the Route delivered. The
table lists the sections these families most often need and is not the complete
set; a base profile may declare a better-fitting section than the one named here.

## How the material reads once placed

Attribute it, and keep its state. A base page's other sections are backed by code
or contracts, so a sentence sourced from a discussion has to carry its own
strength. Distinguish what was proposed, what was agreed, what is implemented and
what has been verified — a placed sentence that loses this distinction is worse
here than on a standalone page, because the surrounding sections are
authoritative and the reader will not question this one.

"Agreed in a design discussion: the retry limit stays at three to stay under the
downstream quota" is placeable next to a code-established limit. "The retry limit
is three" is the base section's line, not the extension's.

An optional `changes` association on the source names what the discussion was
about. It does not establish that the change merged, deployed or passed tests, so
it can never be what makes a statement `implemented`. When the base page's reader
would want to open the change, name it in the prose of the section it belongs to;
never in the page frontmatter.

When a summary contradicts what the code establishes, do not silently pick one.
The code establishes current behavior; the discussion may record an intention, a
state since changed, or a decision not yet carried out. Say which, in the section
where a reader would otherwise be misled.
