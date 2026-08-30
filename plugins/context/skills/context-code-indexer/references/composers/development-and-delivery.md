---
id: context.code-indexer.composer.development-and-delivery
kind: procedure
media-type: text/markdown
---

# Development and delivery composer

Run only for an effective `development-and-delivery` workset. It supplements
the primary target and cannot own repository scope, release authority, or the
final Indexer Result.

Require an evidenced `development-entry` fact and primary `content` Artifact.
Propose derived `content` only for module-owned setup, build, test, packaging,
deployment, release, rollback, or recovery behavior that answers a stable
reader question. Distinguish local commands from CI orchestration and record
configuration inputs without copying secret-like values.

Use the existing Node, `standard` policy, and view evidence. Workspace-wide
processes belong on a container target, not every module. If the required input
is absent or the view contains no module-owned development/delivery contract,
return `fragments: []` in the ordinary structured result.
