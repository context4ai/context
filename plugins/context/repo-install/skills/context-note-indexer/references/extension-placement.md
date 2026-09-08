# Where note material belongs in a base profile's page

A `note/…` profile is an extension. It does not own a page and does not open a
parallel one. The module stays on its base profile and selected page plan,
including an applicable project template override. Contribute to the relevant
sections; the attachment examples below are guidance, not a heading whitelist.

Do not restate a base section the note has nothing to add to, and do not
introduce a "notes" section to hold everything a note said.

## What a note can establish that the base sources cannot

Read the base profile's Chapter blueprint and notice which sections its own
evidence can settle. Structure settles from code and contracts: entry points,
signatures, registrations, schemas, dependency edges. Several sections in every
base blueprint ask for something else — why a limit was chosen, what a timeout
means for a caller, which combination is unsupported, what breaks on upgrade,
which behavior is deliberate. Those are the sections a saved note is for.

This is the useful division. If a note repeats a signature the code already
establishes, it adds nothing and risks contradicting the authoritative source. If
it carries a constraint, a known pitfall or an applicability boundary, it belongs
in the section that asks for exactly that.

## Attachment points by family

| Family | Base profiles | Sections a note usually reaches |
| --- | --- | --- |
| Applications and containers | `monorepo-container`, `web-application` | `Dependency and layering constraints`, `Shared configuration and tooling`, `Configuration and environment selection`, `Known exclusions and source-of-truth links` |
| Reusable capabilities | `component-library`, `sdk-library`, `cli-tool`, `plugin-extension` | `Compatibility and release constraints`, `Behavior, lifecycle, and errors`, `Recovery and rollback boundaries`, `Configuration, permissions, and isolation`, `Compatibility, failure, diagnostics, and recovery` |
| Services and gateways | `api-service`, `gateway-facade`, `domain-service` | `Error, timeout, and compatibility behavior`, `Timeout, retry, compatibility, and failure translation`, `State, transaction, and idempotency behavior`, `Failure and recovery behavior`, `Configuration, observability, and release` |
| Runtimes and data flow | `background-runtime`, `event-consumer`, `data-sync-reconciliation`, `storage-repository` | `Concurrency, ordering, retry, and idempotency`, `Idempotency, retry, checkpoint, and failure destination`, `Authentication, failure, retry, and fallback`, `Transaction, consistency, cache, and locking behavior`, `Failure recovery and observability` |
| Boundaries and contracts | `adapter-integration`, `contract-source`, `derived-generated-source` | `Error, retry, fallback, and compatibility behavior`, `Versioning, compatibility, and deprecation`, `Generated versus maintained behavior`, `Compatibility and regeneration` |
| Document profiles | `domain-reference`, `product-requirements`, `technical-guide`, `user-and-developer-guide`, `public-api-reference`, `runbook`, `faq-support`, `standard-policy`, `decision-record`, `incident-review`, `test-validation`, `release-migration-guide`, `documentation-site` | The base document blueprint keeps its shape; a note adds applicability, an exception, a correction or a missing definition |

Read the section names from the actual base template the Route delivered. The
table lists the sections these families most often need and is not the complete
set; a base profile may declare a better-fitting section than the one named here.

## How the material reads once placed

Attribute it. A base page's other sections are backed by code or contracts, so a
sentence sourced from a note has to carry its own strength or a reader will
assume the whole page is equally authoritative. "Recorded in an operations note:
the retry limit was set to three to stay under the downstream quota" is placeable.
"The retry limit is three" is not, unless the code establishes it — and if the
code establishes it, the base section already owns that line.

A note may report one occurrence or document an explicitly confirmed rule.
Retain that distinction and its attribution. Qualify missing dates or versions
where they affect the base section's meaning; do not generalize a single case
or demote a confirmed rule merely because either was saved as a note.

When a note contradicts what the code establishes, do not silently pick one. The
code establishes current behavior; the note may record an intention, an older
state or a mistake. Say which, in the section where a reader would otherwise be
misled.
