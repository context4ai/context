---
id: procedure.production-requirements
kind: procedure
mediaType: text/markdown
---

# Long-term production requirements

Use the reader purpose and source boundaries already confirmed by the user.
Ask for missing decisions before writing; registering a source does not authorize
unrelated modules. This is not the work-start report: that report follows the
lightweight investigation and uses `context.gate.work_start_scope` for its
confirmation decision.

Write `src/indexers.yaml` with this minimal shape, replacing the example values
with the user's actual purpose and registered source reference:

```yaml
requirements:
  - id: service-readers
    purpose: Explain the service responsibilities and supported usage
    target_scope:
      targets:
        - source_ref: repo:service
```

Optional long-term decisions are `reader_goals` and `questions` (text lists),
`coverage_domains` (domain to `required`, `optional` or `out-of-scope`), and
`evidence_source_scope` with the same `targets` shape for authorized supporting
sources. Existing `module_refs` are reading focus, not a module-to-path permission
map. Use an ordinary task brief for relevant directories; no additional module
mapping or scope receipt is required.

An explicit exclusion belongs inside its requirement:

```yaml
exclusions:
  - scope:
      targets:
        - source_ref: repo:service
    paths: [generated]
    reason: Generated outputs are outside the requested reader purpose
```

`paths` contains exact source-relative files or directories, not glob patterns;
omit it only for a confirmed exclusion of the whole selected source scope.
Do not automatically exclude something merely because it is large or costly.

Do not add Provider selections, versions, hashes, run identifiers, candidate
receipts or task assignments. Those are not long-term requirements. Skills and
writing batches are declared in the temporary investigation plan.

After editing, run `context status --format json` and consume its current Route.

Read `context action prepare-current --schema --format json` for the complete
known-task input contract before creating a stage; no workspace or revision is required.

When article targets and source grouping are already clear, put the existing
plan fields (`capabilities`, `articles`, optional `indexer_usage`) in a file under
`.tmp/agent-work/`, omitting only `stage`, which does not exist yet. Each article
contains `path`, `question`, `sources` and `batch`, with optional `brief` and
`after`. Add `--input <that-file>` to the returned `action prepare-current`
command to prepare those tasks without a separate investigation-plan submission.
This does not approve the report or permit writing before its applicable scope
decision.
When targets are unclear, repeat `--source <source-ref>` on the preparation command
for the sources selected by this request. Without a selection, only a sole
configured target is inferred; multiple targets require the Agent to select
from the user's request, not to ask the user to understand CLI source IDs.
The CLI prepares only this scope. A source in `evidence_source_scope` remains
available without becoming an investigation assignment. A later article plan
can select it in `articles[].sources`; the CLI validates and prepares that
actual dependency before allowing writing. Missing required evidence still
blocks the dependent article.

Long-term configuration additions do not restart an unchanged stage. Plans and
refreshes track this request's selected investigation and actual article inputs.
Preserve genuinely unfinished work when extending a multi-stage request; do not
turn an incremental addition into a whole-workspace refresh.
