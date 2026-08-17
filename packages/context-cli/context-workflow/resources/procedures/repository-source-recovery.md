---
id: procedure.repository-source-recovery
kind: procedure
mediaType: text/markdown
---

# Repository source recovery

Repository checkout contents and materialized module links are local runtime
inputs. Git stores their recovery recipe in `sources/repo/index.yaml`; it does
not store the checkout, local aliases, or `sources/repo/<date>/<module>` links.

Run the route's inspection action first. It groups logical modules by registered
remote and pinned commit, so one physical checkout can restore every module in
that group. Do not create one clone per module. Groups already marked `ready`
need no decision; when every group is ready, the plan has no recovery action.

For each missing physical checkout, ask the user to choose one option:

1. provide an existing local Git checkout;
2. name a bounded directory that the Agent may scan, then choose one of the
   matching checkouts shown by the Agent; or
3. explicitly allow Context to clone the registered repository into the
   suggested `.tmp/repo/` target.

Scanning and clone access are separate external authorities. Never scan an
unspecified disk root. Never infer or substitute another remote, branch, tag,
or nearby repository. A recovery clone uses the registered pinned commit so
the existing knowledge state is reproducible. Updating knowledge to a newer
upstream version is a later, explicit source update decision.

After the user decides, submit one payload matching the route-selected recovery
schema to the exact resolution command. Local mode validates origin, the pinned
commit, and every required subpath without changing the supplied checkout.
Clone mode performs a shallow partial checkout where supported, falls back to a
shallow checkout, and uses sparse checkout only when every registered source is
bounded to a subpath. Context then restores declared local aliases and
materializes module links.

Repository sources are ready only when every selected module resolves to the
registered remote and pinned commit, every registered subpath exists, no local
path was overwritten, Context materialization succeeds, and the current route
no longer reports `route.source.repository-not-ready`.
