---
id: procedure.source-boundary
kind: procedure
mediaType: text/markdown
---

# Source boundary

A source boundary is a user decision about which repositories, modules, or
documents may become approved knowledge. It affects extraction scope,
provenance, output paths, and freshness checks.

Do not infer this boundary by using the current directory, monorepo layout,
package names, or Git remotes to select additional sources. Once the user has named a concrete local module
or path, resolving its unique local directory and reading that checkout's Git
root, `origin`, and current commit are mechanical identity resolution, not a
new source-boundary decision. Paths in the registration payload are resolved
from the Context project root; after initializing a child `context/` directory,
recompute sibling paths from that root instead of reusing the caller's relative
path. As a final CLI safeguard, an omitted `local` may resolve only to one Git
directory named by the confirmed module at the project root or its parent; zero
or multiple matches do not authorize a guess.

Explain the decision in the user's language, obtain the specific paths or
documents, then use the Context source schema and conditional registration
command selected by the route. If the current user request already names the
exact modules or documents, that decision is already present; do not ask for
their remote URLs when a confirmed local Git checkout can supply them. The
command names a file below `.tmp/agent-payloads/`; after the current
conversation contains the required confirmation, write one JSON payload
matching the selected schema to that exact path. Do not run the command before confirmation and do not replace
it with a command remembered from another route.

Context source identity has two parts:

- a calendar date identifies one capture batch and directory;
- a module identifies one concrete repository, local document boundary, or
  remote document inside that batch.

Several modules may share one date. Do not invent date suffixes to separate
them. A date-only inspection addresses the batch; `<date>/<module>` addresses
one source. Register a confirmed multi-source request as one serial batch
mutation instead of running registry writes in parallel.

To retire a registered source, first run `context source remove <source-id>
--format json`. This is a read-only preview that lists every project, candidate,
or approved-knowledge reference. Only after those references are intentionally
resolved may the route use `--yes`; the CLI never silently deletes referenced
knowledge or another source's materialized files. Execute the exact
digest-bound command returned by the preview. For a shared document batch, the
manifest entry is the ownership boundary: removal deletes only that entry and
its explicitly listed files/assets. An uncaptured module has no manifest entry,
so removal is registry-only; the shared date directory is never inferred as
module-owned.

Repository readiness checks are mechanical and may run after the boundary is
registered. Clone, fetch, checkout, install, build, test, and other external
repository operations need separate authority. File and remote-document
registration records metadata only; reading their bodies requires source-read
permission for the exact pending modules.
